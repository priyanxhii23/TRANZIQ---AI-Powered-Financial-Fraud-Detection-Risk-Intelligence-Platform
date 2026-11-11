"""Initial database population.

The demo database is filled with:
1. **Real Kaggle records from the held-out TEST split** (never training data,
   so the stored model predictions are genuine out-of-sample predictions):
   every fraud-labelled test row + a random sample of legitimate test rows.
   NOTE: this deliberately over-represents fraud compared to the real 0.17%
   so the investigation workflow has something to show. The UI states this.
2. A batch of clearly-labelled synthetic transactions.

Kaggle ``Time`` is "seconds since the first transaction" - not a date. To
place real records on the monitoring timeline we *replay* them: timestamp =
replay start (2 days before seeding, midnight UTC) + Time offset.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ml import config
from ml.synthetic import generate

from ..config import settings
from ..models import ModelMetadata, Transaction, utcnow
from .model_registry import registry
from .prediction_service import store_transactions


def sync_model_metadata(db: Session) -> None:
    """Mirror artifacts/reports/experiments.json into the model_metadata table."""
    if not registry.artifacts_present():
        return
    exp = registry.experiments()
    for name, m in exp["models"].items():
        row = db.scalar(select(ModelMetadata).where(ModelMetadata.name == name))
        summary = {
            "pr_auc": m["test"]["pr_auc"], "roc_auc": m["test"]["roc_auc"],
            **{k: m["test"]["at_recommended"][k] for k in ("precision", "recall", "f1", "accuracy")},
        }
        values = dict(label=m["label"], version=m["version"], strategy=m["strategy"],
                      threshold=m["recommended_threshold"], rank=m.get("rank"), trained_at=m["trained_at"],
                      artifact_path=m["artifact"], summary_metrics=summary)
        if row:
            for k, v in values.items():
                setattr(row, k, v)
        else:
            db.add(ModelMetadata(name=name, **values))
    db.commit()


def replay_start(now: datetime | None = None) -> datetime:
    now = now or utcnow()
    return (now - timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)


def seed_kaggle(db: Session, legit_sample: int, seed: int = config.RANDOM_SEED) -> int:
    splits = registry.test_split()
    X, y = splits["X_test"], splits["y_test"]
    rng = np.random.default_rng(seed)
    fraud_idx = np.flatnonzero(y.values == 1)
    legit_idx = np.flatnonzero(y.values == 0)
    legit_idx = rng.choice(legit_idx, size=min(legit_sample, len(legit_idx)), replace=False)
    idx = np.sort(np.concatenate([fraud_idx, legit_idx]))
    start = replay_start()
    records = []
    for i in idx:
        row = X.iloc[i]
        records.append({
            "external_id": f"KGL-{int(i):06d}",
            "source": "kaggle",
            "event_time": start + timedelta(seconds=float(row["Time"])),
            "amount": float(row["Amount"]),
            "ground_truth": int(y.iloc[i]),
            "features": {c: float(row[c]) for c in config.FEATURE_COLUMNS},
        })
    for k in range(0, len(records), 1000):
        store_transactions(db, records[k:k + 1000])
    return len(records)


def synthetic_records(count: int, fraud_profile_ratio=0.05, noise_level=0.15, days_back=14, seed=None) -> list[dict]:
    pool = registry.test_split()["pool"]
    out = []
    for r in generate(pool, count, fraud_profile_ratio, noise_level, days_back, seed=seed):
        out.append({
            "external_id": r["external_id"], "source": "synthetic", "event_time": r["timestamp"],
            "amount": r["amount"], "customer_id": r["customer_id"], "merchant": r["merchant"],
            "merchant_category": r["merchant_category"], "country": r["country"], "city": r["city"],
            "channel": r["channel"], "device": r["device"], "status": r["status"],
            "generation_profile": r["generation_profile"], "features": r["features"],
        })
    return out


def seed_if_empty(db: Session, force: bool = False) -> dict:
    if not registry.artifacts_present():
        return {"seeded": False, "reason": "models not trained"}
    sync_model_metadata(db)
    count = db.scalar(select(func.count(Transaction.id)))
    if count and not force:
        return {"seeded": False, "reason": f"database already has {count} transactions"}
    n_real = seed_kaggle(db, settings.seed_legit_sample)
    n_syn = 0
    if settings.seed_synthetic_count:
        recs = synthetic_records(settings.seed_synthetic_count, seed=config.RANDOM_SEED)
        store_transactions(db, recs)
        n_syn = len(recs)
    return {"seeded": True, "kaggle": n_real, "synthetic": n_syn}
