"""Exploratory Data Analysis.

Produces (1) a JSON file the web UI turns into interactive charts and
(2) static PNG figures (Matplotlib/Seaborn) used in the docs and reports.
All numbers are computed from the real dataset - nothing is hard-coded.
"""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")  # headless backend - no window needed
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

from . import config
from .data_loader import dataset_statistics

PALETTE = {"legit": "#22D3EE", "fraud": "#FF5C6C", "ink": "#E6E8F2", "bg": "#0B0F1F"}


def _amount_histogram(df: pd.DataFrame) -> list[dict]:
    # log-spaced bins because Amount spans 0 .. ~25,000
    edges = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, float("inf")]
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (df["Amount"] >= lo) & (df["Amount"] < hi)
        label = f"{int(lo)}+" if hi == float("inf") else f"{int(lo)}-{int(hi)}"
        legit = int((m & (df["Class"] == 0)).sum())
        fraud = int((m & (df["Class"] == 1)).sum())
        out.append({
            "bucket": label, "legitimate": legit, "fraud": fraud,
            "fraud_rate_pct": round(100 * fraud / (legit + fraud), 3) if legit + fraud else 0,
        })
    return out


def _time_histogram(df: pd.DataFrame) -> list[dict]:
    hours = (df["Time"] // 3600).astype(int)  # hours since first transaction (0-47)
    g = df.groupby([hours, "Class"]).size().unstack(fill_value=0)
    return [
        {"hour": int(h), "legitimate": int(row.get(0, 0)), "fraud": int(row.get(1, 0))}
        for h, row in g.iterrows()
    ]


def _feature_comparison(df: pd.DataFrame) -> list[dict]:
    """Mean / std of each feature for fraud vs legitimate, plus correlation with Class."""
    rows = []
    corr_with_class = df[config.FEATURE_COLUMNS].corrwith(df["Class"])
    for col in config.FEATURE_COLUMNS:
        legit = df.loc[df["Class"] == 0, col]
        fraud = df.loc[df["Class"] == 1, col]
        rows.append({
            "feature": col,
            "legit_mean": round(float(legit.mean()), 4),
            "fraud_mean": round(float(fraud.mean()), 4),
            "legit_std": round(float(legit.std()), 4),
            "fraud_std": round(float(fraud.std()), 4),
            "corr_with_class": round(float(corr_with_class[col]), 4),
        })
    return rows


def compute_eda(df: pd.DataFrame, cleaning_report: dict, splits_summary: dict) -> dict:
    corr = df[config.EXPECTED_COLUMNS].corr().round(3)
    return {
        "source": "Kaggle - Credit Card Fraud Detection (mlg-ulb), real data",
        "statistics": dataset_statistics(df),
        "cleaning": cleaning_report,
        "missing_values_total": int(sum(cleaning_report.get("missing_values", {}).values())),
        "splits": splits_summary,
        "amount_histogram": _amount_histogram(df),
        "time_histogram": _time_histogram(df),
        "feature_comparison": _feature_comparison(df),
        "correlation": {"columns": list(corr.columns), "matrix": corr.values.tolist()},
    }


def save_eda_plots(df: pd.DataFrame) -> list[str]:
    """Write static figures to artifacts/plots and return their file names."""
    config.PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="darkgrid")
    files = []

    fig, ax = plt.subplots(figsize=(6, 4))
    counts = df["Class"].value_counts().sort_index()
    ax.bar(["Legitimate (0)", "Fraud (1)"], counts.values, color=[PALETTE["legit"], PALETTE["fraud"]])
    ax.set_yscale("log")
    ax.set_title("Class distribution (log scale)")
    for i, v in enumerate(counts.values):
        ax.text(i, v, f"{v:,}", ha="center", va="bottom")
    fig.tight_layout(); fig.savefig(config.PLOTS_DIR / "class_distribution.png", dpi=120); plt.close(fig)
    files.append("class_distribution.png")

    fig, ax = plt.subplots(figsize=(7, 4))
    for cls, color, label in [(0, PALETTE["legit"], "Legitimate"), (1, PALETTE["fraud"], "Fraud")]:
        sns.histplot(np.log1p(df.loc[df["Class"] == cls, "Amount"]), bins=60, stat="density",
                     color=color, label=label, ax=ax, alpha=0.55)
    ax.set_xlabel("log(1 + Amount)"); ax.set_title("Transaction amount distribution"); ax.legend()
    fig.tight_layout(); fig.savefig(config.PLOTS_DIR / "amount_distribution.png", dpi=120); plt.close(fig)
    files.append("amount_distribution.png")

    fig, ax = plt.subplots(figsize=(7, 4))
    for cls, color, label in [(0, PALETTE["legit"], "Legitimate"), (1, PALETTE["fraud"], "Fraud")]:
        sns.histplot(df.loc[df["Class"] == cls, "Time"] / 3600, bins=48, stat="density",
                     color=color, label=label, ax=ax, alpha=0.55)
    ax.set_xlabel("Hours since first transaction"); ax.set_title("Transaction time distribution"); ax.legend()
    fig.tight_layout(); fig.savefig(config.PLOTS_DIR / "time_distribution.png", dpi=120); plt.close(fig)
    files.append("time_distribution.png")

    fig, ax = plt.subplots(figsize=(11, 9))
    sns.heatmap(df[config.EXPECTED_COLUMNS].corr(), cmap="coolwarm", center=0, ax=ax, cbar_kws={"shrink": 0.7})
    ax.set_title("Feature correlation heatmap")
    fig.tight_layout(); fig.savefig(config.PLOTS_DIR / "correlation_heatmap.png", dpi=110); plt.close(fig)
    files.append("correlation_heatmap.png")
    return files


def write_eda(eda: dict) -> None:
    config.EDA_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.EDA_PATH.write_text(json.dumps(eda, indent=2))
