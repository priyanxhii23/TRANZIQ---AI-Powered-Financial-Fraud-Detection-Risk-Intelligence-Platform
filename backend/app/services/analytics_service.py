"""Aggregations for the Command Center and Fraud Trends pages.

All numbers are computed live from the database using the ACTIVE model's
latest prediction for each transaction.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ml import config

from ..models import Prediction, Transaction
from .transaction_service import latest_prediction_subquery

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def frame(db: Session, model: str) -> pd.DataFrame:
    latest = latest_prediction_subquery(model)
    stmt = (select(Transaction.id, Transaction.source, Transaction.event_time, Transaction.amount,
                   Transaction.ground_truth, Prediction.probability, Prediction.predicted_label,
                   Prediction.risk_level)
            .join(latest, latest.c.transaction_id == Transaction.id)
            .join(Prediction, Prediction.id == latest.c.pid))
    df = pd.DataFrame(db.execute(stmt).all(),
                      columns=["id", "source", "event_time", "amount", "ground_truth", "probability",
                               "predicted_label", "risk_level"])
    if not df.empty:
        df["event_time"] = pd.to_datetime(df["event_time"])
    return df


def trends(db: Session, model: str, source: str | None = None, granularity: str = "day") -> dict:
    df = frame(db, model)
    if source:
        df = df[df["source"] == source]
    if df.empty:
        return {"model": model, "empty": True}

    freq = "h" if granularity == "hour" else "D"
    df["bucket"] = df["event_time"].dt.floor(freq)
    vol = df.groupby(["bucket", "source"]).size().unstack(fill_value=0)
    flagged = df.groupby("bucket")["predicted_label"].sum()
    mean_p = df.groupby("bucket")["probability"].mean()
    timeline = []
    for b in vol.index:
        row = {"bucket": b.isoformat(), "total": int(vol.loc[b].sum()),
               "predicted_fraud": int(flagged.get(b, 0)), "mean_probability": round(float(mean_p.get(b, 0)), 4)}
        for s in ("kaggle", "synthetic", "user"):
            row[s] = int(vol.loc[b].get(s, 0)) if s in vol.columns else 0
        timeline.append(row)

    edges = [i / 20 for i in range(21)]
    cut = pd.cut(df["probability"], bins=edges, include_lowest=True, right=False)
    prob_hist = df.groupby([cut, "source"], observed=False).size().unstack(fill_value=0)
    prob_dist = [{"bin": f"{iv.left:.2f}", **{s: int(prob_hist.loc[iv].get(s, 0)) for s in prob_hist.columns}}
                 for iv in prob_hist.index]

    amt_edges = [0, 10, 50, 100, 250, 500, 1000, 2500, float("inf")]
    labels = ["0-10", "10-50", "50-100", "100-250", "250-500", "500-1k", "1k-2.5k", "2.5k+"]
    df["amt_bucket"] = pd.cut(df["amount"], bins=amt_edges, labels=labels, right=False, include_lowest=True)
    amt = df.groupby("amt_bucket", observed=False).agg(count=("id", "size"), flagged=("predicted_label", "sum"),
                                                       mean_probability=("probability", "mean"))
    amount_analysis = [{"bucket": str(k), "count": int(r["count"]), "predicted_fraud": int(r["flagged"]),
                        "flag_rate_pct": round(100 * r["flagged"] / r["count"], 2) if r["count"] else 0,
                        "mean_probability": round(float(r["mean_probability"]), 4) if r["count"] else 0}
                       for k, r in amt.iterrows()]

    hourly = df.groupby(df["event_time"].dt.hour).agg(count=("id", "size"), flagged=("predicted_label", "sum"),
                                                     mean_probability=("probability", "mean"))
    hourly_activity = [{"hour": h, "count": int(hourly.loc[h, "count"]) if h in hourly.index else 0,
                        "predicted_fraud": int(hourly.loc[h, "flagged"]) if h in hourly.index else 0,
                        "mean_probability": round(float(hourly.loc[h, "mean_probability"]), 4) if h in hourly.index else 0}
                       for h in range(24)]

    daily = df.groupby(df["event_time"].dt.dayofweek).agg(count=("id", "size"), flagged=("predicted_label", "sum"))
    daily_pattern = [{"day": DOW[d], "count": int(daily.loc[d, "count"]) if d in daily.index else 0,
                      "predicted_fraud": int(daily.loc[d, "flagged"]) if d in daily.index else 0} for d in range(7)]

    comparison = []
    for s, g in df.groupby("source"):
        comparison.append({
            "source": s, "count": int(len(g)), "mean_amount": round(float(g["amount"].mean()), 2),
            "median_amount": round(float(g["amount"].median()), 2),
            "mean_probability": round(float(g["probability"].mean()), 4),
            "predicted_fraud": int(g["predicted_label"].sum()),
            "flag_rate_pct": round(100 * float(g["predicted_label"].mean()), 2),
            "high_or_critical": int(g["risk_level"].isin(["high", "critical"]).sum()),
        })

    return {"model": model, "model_label": config.MODEL_LABELS[model], "granularity": granularity,
            "empty": False, "timeline": timeline, "probability_distribution": prob_dist,
            "amount_analysis": amount_analysis, "hourly_activity": hourly_activity,
            "daily_pattern": daily_pattern, "source_comparison": comparison}


def dashboard(db: Session, model: str) -> dict:
    df = frame(db, model)
    total = int(len(df))
    if total == 0:
        return {"model": model, "total_transactions": 0, "empty": True}
    fraud = int(df["predicted_label"].sum())
    risk_counts = df["risk_level"].value_counts().to_dict()
    labelled = df.dropna(subset=["ground_truth"])
    # Live agreement on real Kaggle rows that have a known label (out-of-sample test rows).
    agreement = None
    if len(labelled):
        gt = labelled["ground_truth"].astype(int)
        pl = labelled["predicted_label"].astype(int)
        tp = int(((gt == 1) & (pl == 1)).sum()); fp = int(((gt == 0) & (pl == 1)).sum())
        fn = int(((gt == 1) & (pl == 0)).sum())
        agreement = {"labelled_rows": int(len(labelled)), "tp": tp, "fp": fp, "fn": fn,
                     "precision": tp / (tp + fp) if tp + fp else 0.0, "recall": tp / (tp + fn) if tp + fn else 0.0}
    last24 = df[df["event_time"] >= df["event_time"].max() - pd.Timedelta(hours=24)]
    spark = last24.groupby(last24["event_time"].dt.floor("h")).agg(count=("id", "size"),
                                                                  flagged=("predicted_label", "sum"))
    return {
        "model": model, "model_label": config.MODEL_LABELS[model], "empty": False,
        "total_transactions": total,
        "predicted_fraud": fraud,
        "predicted_legitimate": total - fraud,
        "fraud_prediction_rate": fraud / total,
        "average_amount": float(df["amount"].mean()),
        "total_amount": float(df["amount"].sum()),
        "flagged_amount": float(df.loc[df["predicted_label"] == 1, "amount"].sum()),
        "high_risk": int(risk_counts.get("high", 0) + risk_counts.get("critical", 0)),
        "risk_distribution": {lvl: int(risk_counts.get(lvl, 0)) for lvl in ["low", "medium", "high", "critical"]},
        "sources": {k: int(v) for k, v in df["source"].value_counts().items()},
        "known_label_agreement": agreement,
        "last_24h": [{"hour": k.isoformat(), "count": int(r["count"]), "predicted_fraud": int(r["flagged"])}
                     for k, r in spark.iterrows()],
    }
