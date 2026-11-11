"""Explainable AI Studio endpoints (SHAP)."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ml import config

from ..database import get_db
from ..models import Transaction
from ..schemas import PredictRequest
from ..services import risk
from ..services.model_registry import registry
from ..services.settings_service import active_model, decision_threshold, risk_bands
from .deps import check_model, require_models

router = APIRouter(prefix="/explain", tags=["explainability"], dependencies=[Depends(require_models)])

NOTE = ("V1-V28 are anonymised PCA components released by the dataset authors. TRANZIQ shows how much each "
        "component contributed, but does not (and cannot) say what real-world attribute it represents.")


def _explain(db: Session, features: dict, model: str) -> dict:
    X = pd.DataFrame([features])[config.FEATURE_COLUMNS].astype(float)
    p = float(registry.predict_proba(model, X)[0])
    thr = decision_threshold(db, model)
    exp = registry.explain(model, X)
    return {"model": model, "model_label": config.MODEL_LABELS[model], "probability": p, "threshold": thr,
            "predicted_label": int(p >= thr), "risk": risk.explain_level(p, risk_bands(db), thr),
            **exp, "anonymised_feature_note": NOTE}


@router.get("/global")
def global_importance(model: str | None = None, db: Session = Depends(get_db)):
    model = check_model(model) or active_model(db)
    g = registry.shap_global()
    if not g or model not in g["models"]:
        raise HTTPException(404, "Global SHAP values not available - re-run training.")
    m = g["models"][model]
    return {"model": model, "model_label": config.MODEL_LABELS[model],
            "sample_description": g["sample_description"], **m,
            "plot_url": f"/static/plots/{m['plot']}" if m.get("plot") else None,
            "anonymised_feature_note": NOTE}


@router.post("")
def explain_features(body: PredictRequest, db: Session = Depends(get_db)):
    model = body.model or active_model(db)
    return _explain(db, body.features, model)


@router.get("/{transaction_id}")
def explain_transaction(transaction_id: int, model: str | None = None, db: Session = Depends(get_db)):
    model = check_model(model) or active_model(db)
    tx = db.get(Transaction, transaction_id)
    if not tx:
        raise HTTPException(404, f"Transaction {transaction_id} not found")
    out = _explain(db, tx.features, model)
    out["transaction"] = {"id": tx.id, "external_id": tx.external_id, "source": tx.source,
                          "amount": tx.amount, "ground_truth": tx.ground_truth}
    return out
