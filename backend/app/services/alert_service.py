"""Fraud Alert & Investigation Center logic.

Alert statuses are ANALYST DECISIONS. "confirmed" means an analyst believes
the alert is fraud; it does not change the transaction's ground-truth label
and is never fed back into model training automatically.
"""
from __future__ import annotations

from sqlalchemy import case, desc, func, select
from sqlalchemy.orm import Session, joinedload

from ..models import Alert, utcnow
from .transaction_service import serialize_pred, serialize_tx

STATUSES = ["pending", "investigating", "confirmed", "dismissed"]
SEVERITY_ORDER = case({"critical": 4, "high": 3, "medium": 2, "low": 1}, value=Alert.severity)


def serialize_alert(a: Alert) -> dict:
    return {
        "id": a.id, "status": a.status, "severity": a.severity, "analyst_note": a.analyst_note,
        "created_at": a.created_at.isoformat(), "updated_at": a.updated_at.isoformat(),
        "transaction": serialize_tx(a.transaction), "prediction": serialize_pred(a.prediction),
    }


def list_alerts(db: Session, status: str | None = None, severity: str | None = None,
                source: str | None = None, sort: str = "newest", page: int = 1, page_size: int = 20) -> dict:
    stmt = select(Alert).options(joinedload(Alert.transaction), joinedload(Alert.prediction))
    count_stmt = select(func.count(Alert.id))
    if status:
        stmt = stmt.where(Alert.status == status); count_stmt = count_stmt.where(Alert.status == status)
    if severity:
        stmt = stmt.where(Alert.severity == severity); count_stmt = count_stmt.where(Alert.severity == severity)
    if source:
        from ..models import Transaction
        stmt = stmt.join(Alert.transaction).where(Transaction.source == source)
        count_stmt = count_stmt.join(Alert.transaction).where(Transaction.source == source)
    order = {
        "newest": [desc(Alert.created_at), desc(Alert.id)],
        "severity": [desc(SEVERITY_ORDER), desc(Alert.created_at)],
        "updated": [desc(Alert.updated_at)],
    }.get(sort, [desc(Alert.created_at)])
    total = db.scalar(count_stmt)
    items = db.scalars(stmt.order_by(*order).offset((page - 1) * page_size).limit(page_size)).unique().all()
    return {"total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size)),
            "items": [serialize_alert(a) for a in items]}


def summary(db: Session) -> dict:
    by_status = dict(db.execute(select(Alert.status, func.count()).group_by(Alert.status)).all())
    by_sev = dict(db.execute(select(Alert.severity, func.count()).group_by(Alert.severity)).all())
    return {"total": sum(by_status.values()),
            "by_status": {s: int(by_status.get(s, 0)) for s in STATUSES},
            "by_severity": {s: int(by_sev.get(s, 0)) for s in ["critical", "high", "medium", "low"]}}


def update_alert(db: Session, alert: Alert, status: str | None, note: str | None) -> Alert:
    if status:
        alert.status = status
    if note is not None:
        alert.analyst_note = note.strip() or None
    alert.updated_at = utcnow()
    db.commit()
    db.refresh(alert)
    return alert
