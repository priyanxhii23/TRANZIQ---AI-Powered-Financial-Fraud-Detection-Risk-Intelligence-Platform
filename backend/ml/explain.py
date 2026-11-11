"""SHAP explanations.

SHAP (SHapley Additive exPlanations) splits a single prediction into
per-feature contributions: ``base value + sum(contributions) = model output``.
Positive contributions push the transaction towards *fraud*, negative ones
towards *legitimate*.

Important: V1-V28 are anonymised PCA components published by the dataset
authors. We can say *which component* drove a prediction, but nobody outside
the original bank knows what real-world attribute it represents - so we never
invent a meaning for them.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import shap

from . import config

FEATURE_NOTES = {
    "Time": "Seconds elapsed since the first transaction in the dataset (not a clock time).",
    "Amount": "Transaction amount (original currency units, not scaled by the bank).",
}
ANONYMISED_NOTE = (
    "Anonymised principal component published by the dataset authors. "
    "Its real-world meaning is confidential and is not interpreted by TRANZIQ."
)


def feature_note(name: str) -> str:
    return FEATURE_NOTES.get(name, ANONYMISED_NOTE)


def make_explainer(bundle: dict):
    """Create the right SHAP explainer for the model type.

    * Tree models (Random Forest, XGBoost) -> TreeExplainer (exact & fast).
    * Logistic Regression -> LinearExplainer with a small background sample.
    """
    model = bundle["pipeline"].named_steps["model"]
    if bundle["name"] == "logistic_regression":
        return shap.LinearExplainer(model, shap.maskers.Independent(bundle["background"], max_samples=len(bundle["background"])))
    return shap.TreeExplainer(model)


def output_units(name: str) -> str:
    # TreeExplainer on sklearn RF explains probabilities; XGB and LR explain log-odds.
    return "probability" if name == "random_forest" else "log-odds"


def shap_values(bundle: dict, explainer, X_raw: pd.DataFrame) -> tuple[np.ndarray, float]:
    """Return (n_rows x 30 SHAP matrix for the fraud class, base value)."""
    X_t = bundle["pipeline"].named_steps["preprocess"].transform(X_raw[config.FEATURE_COLUMNS])
    values = explainer.shap_values(X_t)
    base = explainer.expected_value
    if isinstance(values, list):          # older shap: list per class
        values = values[1]
    values = np.asarray(values)
    if values.ndim == 3:                   # (rows, features, classes)
        values = values[:, :, 1]
    base = np.asarray(base).ravel()
    base_value = float(base[1] if base.size > 1 else base[0])
    return values, base_value


def explain_row(bundle: dict, explainer, row: pd.DataFrame, top_k: int = 30) -> dict:
    values, base = shap_values(bundle, explainer, row)
    contribs = []
    raw = row[config.FEATURE_COLUMNS].iloc[0]
    for i, feat in enumerate(config.FEATURE_COLUMNS):
        contribs.append({
            "feature": feat,
            "value": float(raw[feat]),
            "shap_value": float(values[0, i]),
            "direction": "towards_fraud" if values[0, i] > 0 else "towards_legitimate",
            "note": feature_note(feat),
        })
    contribs.sort(key=lambda c: abs(c["shap_value"]), reverse=True)
    return {
        "base_value": base,
        "output_units": output_units(bundle["name"]),
        "model_output": float(base + values[0].sum()),
        "contributions": contribs[:top_k],
    }


def global_importance(bundle: dict, X_sample: pd.DataFrame) -> dict:
    explainer = make_explainer(bundle)
    values, base = shap_values(bundle, explainer, X_sample)
    mean_abs = np.abs(values).mean(axis=0)
    order = np.argsort(-mean_abs)
    X_t = bundle["pipeline"].named_steps["preprocess"].transform(X_sample[config.FEATURE_COLUMNS])
    # For a beeswarm-style chart in the UI we send a capped sample of points per top feature.
    rng = np.random.default_rng(config.RANDOM_SEED)
    pts_idx = rng.choice(len(X_sample), size=min(150, len(X_sample)), replace=False)
    features = []
    for i in order:
        col = X_t[pts_idx, i]
        lo, hi = np.percentile(col, 2), np.percentile(col, 98)
        norm = np.clip((col - lo) / (hi - lo + 1e-9), 0, 1)
        features.append({
            "feature": config.FEATURE_COLUMNS[i],
            "mean_abs_shap": float(mean_abs[i]),
            "mean_shap": float(values[:, i].mean()),
            "note": feature_note(config.FEATURE_COLUMNS[i]),
            "points": [{"shap": round(float(values[j, i]), 5), "value_norm": round(float(v), 3)}
                       for j, v in zip(pts_idx, norm)],
        })
    return {"base_value": base, "output_units": output_units(bundle["name"]),
            "sample_size": int(len(X_sample)), "features": features, "values": values, "X_t": X_t}


def save_summary_plot(name: str, values: np.ndarray, X_t: np.ndarray, path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.figure()
    shap.summary_plot(values, X_t, feature_names=config.FEATURE_COLUMNS, show=False, max_display=15,
                      rng=np.random.default_rng(config.RANDOM_SEED))
    plt.title(f"SHAP summary - {config.MODEL_LABELS[name]}")
    plt.tight_layout()
    plt.savefig(path, dpi=110)
    plt.close("all")
