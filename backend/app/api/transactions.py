"""Transaction Intelligence Explorer endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ml import config

from ..database import get_db
from ..models import Transaction
from ..services.settings_service import active_model
from ..services.transaction_service import list_transactions, transaction_detail
from .deps import check_model, require_models

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("")
def get_transactions(
    q: str | None = Query(None, max_length=80, description="Search id, customer, merchant, city, country"),
    source: Literal["kaggle", "synthetic", "user"] | None = None,
    model: str | None = None,
    min_amount: float | None = Query(None, ge=0), max_amount: float | None = Query(None, ge=0),
    min_prob: float | None = Query(None, ge=0, le=1), max_prob: float | None = Query(None, ge=0, le=1),
    risk_level: Literal["low", "medium", "high", "critical"] | None = None,
    predicted_label: int | None = Query(None, ge=0, le=1),
    ground_truth: int | None = Query(None, ge=0, le=1),
    date_from: datetime | None = None, date_to: datetime | None = None,
    sort_by: Literal["event_time", "amount", "probability", "id", "external_id"] = "event_time",
    sort_dir: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
):
    model = check_model(model) or active_model(db)
    data = list_transactions(db, model, sort_by, sort_dir, page, page_size, q=q, source=source,
                             min_amount=min_amount, max_amount=max_amount, min_prob=min_prob, max_prob=max_prob,
                             risk_level=risk_level, predicted_label=predicted_label, ground_truth=ground_truth,
                             date_from=date_from, date_to=date_to)
    data["model"] = model
    return data


@router.get("/bounds")
def bounds(db: Session = Depends(get_db)):
    """Min/max amount and date - used to initialise Explorer filters."""
    r = db.execute(select(func.min(Transaction.amount), func.max(Transaction.amount),
                          func.min(Transaction.event_time), func.max(Transaction.event_time),
                          func.count(Transaction.id))).one()
    return {"min_amount": r[0], "max_amount": r[1], "min_date": r[2].isoformat() if r[2] else None,
            "max_date": r[3].isoformat() if r[3] else None, "count": r[4]}


@router.get("/sample")
def sample_transaction(label: Literal["fraud", "legitimate", "any"] = "any", db: Session = Depends(get_db)):
    """A random REAL Kaggle test record (with its known label) to pre-fill the Scanner."""
    stmt = select(Transaction).where(Transaction.source == "kaggle")
    if label != "any":
        stmt = stmt.where(Transaction.ground_truth == (1 if label == "fraud" else 0))
    tx = db.scalars(stmt.order_by(func.random()).limit(1)).first()
    if not tx:
        raise HTTPException(404, "No Kaggle records in the database yet.")
    return {"id": tx.id, "external_id": tx.external_id, "ground_truth": tx.ground_truth,
            "features": {c: tx.features[c] for c in config.FEATURE_COLUMNS}}


@router.get("/{tx_id}")
def get_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404, f"Transaction {tx_id} not found")
    return transaction_detail(db, tx)


@router.post("/{tx_id}/rescore", dependencies=[Depends(require_models)])
def rescore(tx_id: int, db: Session = Depends(get_db)):
    """Score an existing transaction again with all models (new prediction rows, no new alerts)."""
    from ..models import Prediction
    from ..services import risk
    from ..services.model_registry import registry
    from ..services.settings_service import decision_threshold, risk_bands
    import pandas as pd

    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404, f"Transaction {tx_id} not found")
    X = pd.DataFrame([tx.features])
    bands = risk_bands(db)
    for m in registry.available_models():
        p = float(registry.predict_proba(m, X)[0]); thr = decision_threshold(db, m)
        db.add(Prediction(transaction_id=tx.id, model_name=m, model_version=registry.get(m)["version"],
                          probability=p, threshold=thr, predicted_label=int(p >= thr),
                          risk_level=risk.classify(p, bands)))
    db.commit()
    return transaction_detail(db, tx)

