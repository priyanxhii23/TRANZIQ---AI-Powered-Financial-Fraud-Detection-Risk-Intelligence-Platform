"""Scoring transactions and persisting predictions + alerts.

Every stored transaction is scored by ALL available models (cheap, and it
lets the Explorer filter/compare by model). Alerts are raised only from the
*active* model's prediction, so one transaction cannot raise three alerts.
"""
from __future__ import annotations

import io
import math
import uuid
from datetime import datetime

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from ml import config

from ..models import Alert, Prediction, Transaction, utcnow
from . import risk
from .model_registry import registry
from .settings_service import active_model, decision_threshold, risk_bands

ALERT_LEVELS = {"high", "critical"}


def should_alert(pred_label: int, level: str) -> bool:
    """Alert when the model flags fraud OR the probability is in a high band."""
    return pred_label == 1 or level in ALERT_LEVELS


def score_features(db: Session, features: pd.DataFrame, model: str | None = None,
                   threshold: float | None = None) -> dict:
    """Return probabilities, labels and risk levels for one model (no DB writes)."""
    model = model or active_model(db)
    thr = threshold if threshold is not None else decision_threshold(db, model)
    bands = risk_bands(db)
    proba = registry.predict_proba(model, features)
    return {
        "model": model, "threshold": thr, "probability": proba,
        "label": (proba >= thr).astype(int),
        "risk": [risk.classify(float(p), bands) for p in proba],
    }


def store_transactions(db: Session, records: list[dict], threshold_override: dict[str, float] | None = None,
                       create_alerts: bool = True) -> list[Transaction]:
    """Insert transactions, score them with every model and create alerts.

    ``records`` are dicts with Transaction column values + a ``features`` dict.
    """
    if not records:
        return []
    act = active_model(db)
    bands = risk_bands(db)
    X = pd.DataFrame([r["features"] for r in records])[config.FEATURE_COLUMNS].astype(float)
    models = registry.available_models()
    scores = {m: registry.predict_proba(m, X) for m in models}
    thresholds = {m: (threshold_override or {}).get(m, decision_threshold(db, m)) for m in models}

    txs = []
    for r in records:
        tx = Transaction(**{k: v for k, v in r.items()})
        db.add(tx)
        txs.append(tx)
    db.flush()  # assigns ids

    alert_preds = []
    for i, tx in enumerate(txs):
        for m in models:
            p = float(scores[m][i])
            lbl = int(p >= thresholds[m])
            level = risk.classify(p, bands)
            pred = Prediction(transaction_id=tx.id, model_name=m, model_version=registry.get(m)["version"],
                              probability=p, threshold=thresholds[m], predicted_label=lbl, risk_level=level)
            db.add(pred)
            if create_alerts and m == act and should_alert(lbl, level):
                alert_preds.append((tx, pred, level))
    db.flush()
    for tx, pred, level in alert_preds:
        db.add(Alert(transaction_id=tx.id, prediction_id=pred.id, severity=level, status="pending",
                     created_at=utcnow()))
    db.commit()
    return txs


def user_record(features: dict, metadata: dict | None = None) -> dict:
    md = metadata or {}
    return {
        "external_id": f"USR-{uuid.uuid4().hex[:12].upper()}",
        "source": "user",
        "event_time": utcnow(),
        "amount": float(features["Amount"]),
        "features": {c: float(features[c]) for c in config.FEATURE_COLUMNS},
        **{k: v for k, v in md.items() if v},
    }


def predict_single(db: Session, features: dict, model: str | None, threshold: float | None,
                   persist: bool, explain: bool, metadata: dict | None = None) -> dict:
    model = model or active_model(db)
    X = pd.DataFrame([features])[config.FEATURE_COLUMNS].astype(float)
    s = score_features(db, X, model, threshold)
    p = float(s["probability"][0])
    out = {
        "model": model,
        "model_label": config.MODEL_LABELS[model],
        "model_version": registry.get(model)["version"],
        "probability": p,
        "threshold": s["threshold"],
        "predicted_label": int(s["label"][0]),
        "prediction": "fraud" if s["label"][0] else "legitimate",
        "risk": risk.explain_level(p, risk_bands(db), s["threshold"]),
        "transaction_id": None,
        "explanation": registry.explain(model, X, top_k=12) if explain else None,
    }
    if persist:
        override = {model: s["threshold"]} if threshold is not None else None
        tx = store_transactions(db, [user_record(features, metadata)], threshold_override=override)[0]
        out["transaction_id"] = tx.id
        out["external_id"] = tx.external_id
    return out


def predict_batch(db: Session, rows: list[dict], model: str | None, threshold: float | None,
                  persist: bool) -> dict:
    model = model or active_model(db)
    X = pd.DataFrame(rows)[config.FEATURE_COLUMNS].astype(float)
    s = score_features(db, X, model, threshold)
    results = [{
        "row": i, "probability": float(p), "predicted_label": int(lbl),
        "prediction": "fraud" if lbl else "legitimate", "risk_level": lvl,
        "amount": float(X.iloc[i]["Amount"]),
    } for i, (p, lbl, lvl) in enumerate(zip(s["probability"], s["label"], s["risk"]))]
    if persist:
        override = {model: s["threshold"]} if threshold is not None else None
        txs = store_transactions(db, [user_record(r) for r in rows], threshold_override=override)
        for r, tx in zip(results, txs):
            r["transaction_id"] = tx.id
    lv = pd.Series(s["risk"]).value_counts().to_dict()
    return {
        "model": model, "model_label": config.MODEL_LABELS[model], "threshold": s["threshold"],
        "summary": {
            "rows": len(results),
            "predicted_fraud": int(s["label"].sum()),
            "predicted_legitimate": int(len(results) - s["label"].sum()),
            "mean_probability": float(np.mean(s["probability"])) if len(results) else 0.0,
            "risk_levels": {k: int(lv.get(k, 0)) for k in risk.LEVELS},
        },
        "results": results,
    }


# ---- CSV upload validation ---------------------------------------------------------
class CSVValidationError(ValueError):
    pass


def parse_upload(content: bytes, max_rows: int) -> tuple[list[dict], list[dict], dict]:
    """Validate an uploaded CSV. Returns (valid_rows, row_errors, info).

    * File must be UTF-8 CSV containing all 30 feature columns
      (extra columns such as ``Class`` are ignored for prediction).
    * Rows with missing / non-numeric / negative Amount/Time values are
      reported individually and skipped instead of failing the whole file.
    """
    if not content.strip():
        raise CSVValidationError("The uploaded file is empty.")
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise CSVValidationError(f"Could not read CSV: {exc}") from exc
    missing = [c for c in config.FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise CSVValidationError(f"Missing required columns: {', '.join(missing)}")
    if len(df) == 0:
        raise CSVValidationError("The CSV has a header but no rows.")
    if len(df) > max_rows:
        raise CSVValidationError(f"Too many rows ({len(df)}). Maximum is {max_rows}.")

    feats = df[config.FEATURE_COLUMNS].apply(pd.to_numeric, errors="coerce")
    valid, errors = [], []
    for i, row in feats.iterrows():
        bad = [c for c in config.FEATURE_COLUMNS if not math.isfinite(row[c])]  # NaN/inf -> invalid
        if bad:
            errors.append({"row": int(i) + 2, "error": f"invalid/missing values in {', '.join(bad[:5])}"})
        elif row["Amount"] < 0 or row["Time"] < 0:
            errors.append({"row": int(i) + 2, "error": "Amount and Time must be >= 0"})
        else:
            valid.append({c: float(row[c]) for c in config.FEATURE_COLUMNS})
    info = {"rows_in_file": int(len(df)), "valid_rows": len(valid), "invalid_rows": len(errors),
            "has_class_column": "Class" in df.columns,
            "ignored_columns": [c for c in df.columns if c not in config.FEATURE_COLUMNS]}
    return valid, errors, info


def now_naive() -> datetime:
    return utcnow()
