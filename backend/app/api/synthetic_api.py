"""Synthetic Transaction Generator endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Alert, Prediction, Transaction
from ..schemas import SyntheticRequest
from ..services import risk
from ..services.model_registry import registry
from ..services.prediction_service import store_transactions
from ..services.seed_service import synthetic_records
from ..services.settings_service import active_model, decision_threshold, risk_bands
from .deps import require_models

router = APIRouter(prefix="/synthetic", tags=["synthetic"], dependencies=[Depends(require_models)])

DISCLAIMER = ("Synthetic demonstration records: features are perturbations of real training records; "
              "metadata is randomly generated. They have NO ground-truth label and are not real fraud cases.")


@router.post("/generate")
def generate(body: SyntheticRequest, db: Session = Depends(get_db)):
    recs = synthetic_records(body.count, body.fraud_profile_ratio, body.noise_level, body.days_back, body.seed)
    model = active_model(db)
    if body.persist:
        txs = store_transactions(db, recs)
        ids = [t.id for t in txs]
        preds = {p.transaction_id: p for p in db.scalars(
            select(Prediction).where(Prediction.transaction_id.in_(ids), Prediction.model_name == model))}
        alerts = db.scalar(select(func.count(Alert.id)).where(Alert.transaction_id.in_(ids)))
        items = [{"id": t.id, "external_id": t.external_id, "event_time": t.event_time.isoformat(),
                  "amount": t.amount, "customer_id": t.customer_id, "merchant": t.merchant, "city": t.city,
                  "country": t.country, "channel": t.channel, "device": t.device, "status": t.status,
                  "generation_profile": t.generation_profile, "probability": preds[t.id].probability,
                  "predicted_label": preds[t.id].predicted_label, "risk_level": preds[t.id].risk_level}
                 for t in txs]
    else:
        import pandas as pd
        X = pd.DataFrame([r["features"] for r in recs])
        proba = registry.predict_proba(model, X)
        thr, bands = decision_threshold(db, model), risk_bands(db)
        alerts = 0
        items = [{"id": None, "external_id": r["external_id"], "event_time": r["event_time"].isoformat(),
                  "amount": r["amount"], "customer_id": r["customer_id"], "merchant": r["merchant"],
                  "city": r["city"], "country": r["country"], "channel": r["channel"], "device": r["device"],
                  "status": r["status"], "generation_profile": r["generation_profile"], "probability": float(p),
                  "predicted_label": int(p >= thr), "risk_level": risk.classify(float(p), bands)}
                 for r, p in zip(recs, proba)]
    flagged = sum(i["predicted_label"] for i in items)
    return {"disclaimer": DISCLAIMER, "model": model, "persisted": body.persist, "count": len(items),
            "predicted_fraud": flagged, "alerts_created": int(alerts or 0),
            "risk_levels": {lvl: sum(1 for i in items if i["risk_level"] == lvl) for lvl in risk.LEVELS},
            "items": items}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    n = db.scalar(select(func.count(Transaction.id)).where(Transaction.source == "synthetic"))
    last = db.scalar(select(func.max(Transaction.created_at)).where(Transaction.source == "synthetic"))
    return {"synthetic_transactions": n, "last_generated": last.isoformat() if last else None,
            "disclaimer": DISCLAIMER}


@router.delete("")
def reset(db: Session = Depends(get_db)):
    """Delete ALL synthetic transactions (and their predictions/alerts). Real data is untouched."""
    ids = select(Transaction.id).where(Transaction.source == "synthetic")
    a = db.execute(delete(Alert).where(Alert.transaction_id.in_(ids))).rowcount
    p = db.execute(delete(Prediction).where(Prediction.transaction_id.in_(ids))).rowcount
    t = db.execute(delete(Transaction).where(Transaction.source == "synthetic")).rowcount
    db.commit()
    return {"deleted_transactions": t, "deleted_predictions": p, "deleted_alerts": a}
