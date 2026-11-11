"""Fraud Alert & Investigation Center endpoints."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Alert
from ..schemas import AlertUpdate
from ..services import alert_service

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
def get_alerts(status: Literal["pending", "investigating", "confirmed", "dismissed"] | None = None,
               severity: Literal["low", "medium", "high", "critical"] | None = None,
               source: Literal["kaggle", "synthetic", "user"] | None = None,
               sort: Literal["newest", "severity", "updated"] = "newest",
               page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
               db: Session = Depends(get_db)):
    return alert_service.list_alerts(db, status, severity, source, sort, page, page_size)


@router.get("/summary")
def alerts_summary(db: Session = Depends(get_db)):
    return alert_service.summary(db)


@router.get("/{alert_id}")
def get_alert(alert_id: int, db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, f"Alert {alert_id} not found")
    return alert_service.serialize_alert(a)


@router.patch("/{alert_id}")
def patch_alert(alert_id: int, body: AlertUpdate, db: Session = Depends(get_db)):
    """Record an analyst decision. Does NOT change ground truth or retrain models."""
    if body.status is None and body.analyst_note is None:
        raise HTTPException(422, "Provide 'status' and/or 'analyst_note'")
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, f"Alert {alert_id} not found")
    return alert_service.serialize_alert(alert_service.update_alert(db, a, body.status, body.analyst_note))
