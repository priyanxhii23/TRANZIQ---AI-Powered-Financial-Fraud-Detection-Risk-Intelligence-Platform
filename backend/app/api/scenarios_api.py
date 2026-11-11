"""Fraud Scenario Lab endpoints - model stress testing with real predictions."""
from __future__ import annotations

import uuid
from datetime import timedelta

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ml import config
from ml import scenarios as sc

from ..database import get_db
from ..models import Transaction, utcnow
from ..schemas import ScenarioRequest
from ..services import risk
from ..services.model_registry import registry
from ..services.prediction_service import store_transactions
from ..services.settings_service import active_model, decision_threshold, risk_bands
from .deps import require_models

router = APIRouter(prefix="/scenarios", tags=["scenario lab"], dependencies=[Depends(require_models)])

NOTE = ("Scenario transactions are synthetic: complete feature vectors derived from real training records with a "
        "documented perturbation. They have no ground-truth label and are never used to train or evaluate models.")


@router.get("/catalog")
def catalog():
    return {"scenarios": [{"id": k, **v} for k, v in sc.CATALOG.items()], "note": NOTE}


@router.post("/run")
def run_scenario(body: ScenarioRequest, db: Session = Depends(get_db)):
    model = body.model or active_model(db)
    thr = body.threshold if body.threshold is not None else decision_threshold(db, model)
    bands = risk_bands(db)
    pool = registry.test_split()["pool"]

    base_vec, base_ref = None, None
    if body.base_transaction_id is not None:
        tx = db.get(Transaction, body.base_transaction_id)
        if not tx:
            raise HTTPException(404, f"Transaction {body.base_transaction_id} not found")
        base_vec = np.array([tx.features[c] for c in config.FEATURE_COLUMNS], dtype=float)
        base_ref = {"id": tx.id, "external_id": tx.external_id, "ground_truth": tx.ground_truth}

    try:
        out = sc.run(pool, body.scenario, body.count, body.intensity, body.amount, body.interval_seconds,
                     body.base_profile, base_vec, body.seed)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

    X = pd.DataFrame(out["X"], columns=config.FEATURE_COLUMNS)
    proba = registry.predict_proba(model, X)
    # Reference point: how the model scored the UNPERTURBED starting record(s)
    if out["base"] is not None:
        ref = float(registry.predict_proba(model, pd.DataFrame([out["base"]], columns=config.FEATURE_COLUMNS))[0])
        ref_label = "Unmodified base record"
    else:
        ref = float(registry.predict_proba(model, pd.DataFrame(out["seeds"], columns=config.FEATURE_COLUMNS)).mean())
        ref_label = "Mean of unperturbed seed records"

    levels = [risk.classify(float(p), bands) for p in proba]
    items = [{"i": i, "amount": float(X.iloc[i]["Amount"]), "time": float(X.iloc[i]["Time"]), "probability": float(p),
              "predicted_label": int(p >= thr), "risk_level": lvl} for i, (p, lvl) in enumerate(zip(proba, levels))]

    persisted = 0
    if body.persist:
        now = utcnow()
        recs = [{
            "external_id": f"SCN-{uuid.uuid4().hex[:12].upper()}", "source": "synthetic",
            "event_time": now - timedelta(seconds=float(body.interval_seconds) * (len(items) - k)),
            "amount": it["amount"], "channel": "Scenario Lab", "status": "Simulated",
            "generation_profile": f"scenario:{body.scenario}",
            "features": {c: float(X.iloc[k][c]) for c in config.FEATURE_COLUMNS},
        } for k, it in enumerate(items)]
        persisted = len(store_transactions(db, recs))

    return {
        "scenario": body.scenario, "title": sc.CATALOG[body.scenario]["title"], "method": sc.CATALOG[body.scenario]["method"],
        "model": model, "model_label": config.MODEL_LABELS[model], "threshold": thr, "bands": bands,
        "params": body.model_dump(exclude={"persist"}),
        "base": base_ref, "reference_probability": ref, "reference_label": ref_label,
        "summary": {
            "count": len(items), "mean_probability": float(np.mean(proba)), "max_probability": float(np.max(proba)),
            "min_probability": float(np.min(proba)), "predicted_fraud": int(sum(i["predicted_label"] for i in items)),
            "risk_levels": {lvl: levels.count(lvl) for lvl in risk.LEVELS},
        },
        "items": items, "persisted": persisted, "note": NOTE,
    }
