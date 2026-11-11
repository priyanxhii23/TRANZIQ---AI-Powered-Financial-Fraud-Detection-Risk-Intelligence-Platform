"""Command Center + analytics endpoints."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Alert, Transaction
from ..services import analytics_service
from ..services.alert_service import serialize_alert, summary as alert_summary
from ..services.settings_service import active_model, decision_threshold
from ..services.transaction_service import list_transactions
from .deps import check_model

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/summary")
def dashboard_summary(model: str | None = None, db: Session = Depends(get_db)):
    model = check_model(model) or active_model(db)
    data = analytics_service.dashboard(db, model)
    recent_alerts = db.scalars(select(Alert).options(joinedload(Alert.transaction), joinedload(Alert.prediction))
                               .order_by(desc(Alert.created_at), desc(Alert.id)).limit(6)).unique().all()
    data["recent_alerts"] = [serialize_alert(a) for a in recent_alerts]
    data["alerts"] = alert_summary(db)
    data["decision_threshold"] = decision_threshold(db, model)
    data["recent_transactions"] = list_transactions(db, model, sort_by="event_time", page_size=14)["items"]
    data["latest_ingested"] = list_transactions(db, model, sort_by="id", page_size=8)["items"]
    data["active_model"] = active_model(db)
    return data


@router.get("/analytics/trends")
def analytics_trends(model: str | None = None,
                     source: Literal["kaggle", "synthetic", "user"] | None = None,
                     granularity: Literal["day", "hour"] = Query("day"),
                     db: Session = Depends(get_db)):
    model = check_model(model) or active_model(db)
    return analytics_service.trends(db, model, source, granularity)


@router.get("/analytics/sources")
def analytics_sources(db: Session = Depends(get_db)):
    from sqlalchemy import func
    rows = db.execute(select(Transaction.source, func.count(), func.avg(Transaction.amount))
                      .group_by(Transaction.source)).all()
    return [{"source": s, "count": int(c), "mean_amount": float(a or 0)} for s, c, a in rows]
