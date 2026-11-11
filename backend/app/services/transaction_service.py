"""Querying transactions for the Explorer (search, filters, sort, paging)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Select, and_, asc, desc, func, or_, select
from sqlalchemy.orm import Session, aliased

from ..models import Alert, Prediction, Transaction

SORTABLE = {"event_time", "amount", "probability", "id", "external_id"}


def latest_prediction_subquery(model: str):
    """Most recent prediction id per transaction for a given model."""
    return (
        select(Prediction.transaction_id, func.max(Prediction.id).label("pid"))
        .where(Prediction.model_name == model)
        .group_by(Prediction.transaction_id)
        .subquery()
    )


def build_query(model: str, q: str | None = None, source: str | None = None,
                min_amount: float | None = None, max_amount: float | None = None,
                min_prob: float | None = None, max_prob: float | None = None,
                risk_level: str | None = None, predicted_label: int | None = None,
                ground_truth: int | None = None,
                date_from: datetime | None = None, date_to: datetime | None = None) -> tuple[Select, object]:
    latest = latest_prediction_subquery(model)
    P = aliased(Prediction)
    stmt = (select(Transaction, P)
            .outerjoin(latest, latest.c.transaction_id == Transaction.id)
            .outerjoin(P, P.id == latest.c.pid))
    conds = []
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(Transaction.external_id.ilike(like), Transaction.customer_id.ilike(like),
                         Transaction.merchant.ilike(like), Transaction.city.ilike(like),
                         Transaction.country.ilike(like)))
    if source:
        conds.append(Transaction.source == source)
    if min_amount is not None:
        conds.append(Transaction.amount >= min_amount)
    if max_amount is not None:
        conds.append(Transaction.amount <= max_amount)
    if min_prob is not None:
        conds.append(P.probability >= min_prob)
    if max_prob is not None:
        conds.append(P.probability <= max_prob)
    if risk_level:
        conds.append(P.risk_level == risk_level)
    if predicted_label is not None:
        conds.append(P.predicted_label == predicted_label)
    if ground_truth is not None:
        conds.append(Transaction.ground_truth == ground_truth)
    if date_from:
        conds.append(Transaction.event_time >= date_from)
    if date_to:
        conds.append(Transaction.event_time <= date_to)
    if conds:
        stmt = stmt.where(and_(*conds))
    return stmt, P


def list_transactions(db: Session, model: str, sort_by: str = "event_time", sort_dir: str = "desc",
                      page: int = 1, page_size: int = 25, **filters) -> dict:
    stmt, P = build_query(model, **filters)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    col = P.probability if sort_by == "probability" else getattr(Transaction, sort_by)
    order = desc(col) if sort_dir == "desc" else asc(col)
    rows = db.execute(stmt.order_by(order, desc(Transaction.id))
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"total": total, "page": page, "page_size": page_size,
            "pages": max(1, -(-total // page_size)),
            "items": [serialize_row(tx, pred) for tx, pred in rows]}


def serialize_tx(tx: Transaction) -> dict:
    return {
        "id": tx.id, "external_id": tx.external_id, "source": tx.source,
        "event_time": tx.event_time.isoformat(), "amount": tx.amount,
        "customer_id": tx.customer_id, "merchant": tx.merchant, "merchant_category": tx.merchant_category,
        "country": tx.country, "city": tx.city, "channel": tx.channel, "device": tx.device,
        "status": tx.status, "generation_profile": tx.generation_profile,
        "ground_truth": tx.ground_truth, "created_at": tx.created_at.isoformat(),
    }


def serialize_pred(p: Prediction | None) -> dict | None:
    if p is None:
        return None
    return {"id": p.id, "model_name": p.model_name, "model_version": p.model_version,
            "probability": p.probability, "threshold": p.threshold, "predicted_label": p.predicted_label,
            "risk_level": p.risk_level, "created_at": p.created_at.isoformat()}


def serialize_row(tx: Transaction, pred: Prediction | None) -> dict:
    return {**serialize_tx(tx), "prediction": serialize_pred(pred)}


def transaction_detail(db: Session, tx: Transaction) -> dict:
    preds = db.scalars(select(Prediction).where(Prediction.transaction_id == tx.id)
                       .order_by(desc(Prediction.id))).all()
    latest: dict[str, Prediction] = {}
    for p in preds:
        latest.setdefault(p.model_name, p)
    alerts = db.scalars(select(Alert).where(Alert.transaction_id == tx.id)).all()
    return {
        **serialize_tx(tx),
        "features": tx.features,
        "predictions": [serialize_pred(p) for p in latest.values()],
        "prediction_history_count": len(preds),
        "alerts": [{"id": a.id, "status": a.status, "severity": a.severity,
                    "created_at": a.created_at.isoformat()} for a in alerts],
    }
