"""Database tables (SQLAlchemy ORM).

transactions ─┬─< predictions ─── alerts
              └─< alerts
model_metadata, app_settings are standalone.

* ``transactions.source`` tells you where a record came from:
  ``kaggle`` (real, has a ground-truth label), ``synthetic`` (generated demo
  data, no ground truth) or ``user`` (entered / uploaded in the Scanner).
* ``predictions`` store what a *model* said - they are never ground truth.
* ``alerts.status`` is an *analyst decision* (pending / investigating /
  confirmed / dismissed), not a verified label.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(16), index=True)  # kaggle | synthetic | user
    event_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    amount: Mapped[float] = mapped_column(Float, index=True)
    # Descriptive metadata (synthetic / user records only; Kaggle has none)
    customer_id: Mapped[str | None] = mapped_column(String(32), index=True)
    merchant: Mapped[str | None] = mapped_column(String(80))
    merchant_category: Mapped[str | None] = mapped_column(String(40))
    country: Mapped[str | None] = mapped_column(String(60))
    city: Mapped[str | None] = mapped_column(String(60))
    channel: Mapped[str | None] = mapped_column(String(40))
    device: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str | None] = mapped_column(String(20))
    generation_profile: Mapped[str | None] = mapped_column(String(40))
    # Known label - ONLY for real Kaggle rows. NULL for synthetic/user data.
    ground_truth: Mapped[int | None] = mapped_column(Integer)
    features: Mapped[dict] = mapped_column(JSON)  # the 30 model inputs
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    predictions: Mapped[list[Prediction]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan", passive_deletes=True
    )
    alerts: Mapped[list[Alert]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan", passive_deletes=True
    )


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (Index("ix_pred_model_tx", "model_name", "transaction_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), index=True)
    model_name: Mapped[str] = mapped_column(String(40), index=True)
    model_version: Mapped[str] = mapped_column(String(40))
    probability: Mapped[float] = mapped_column(Float, index=True)
    threshold: Mapped[float] = mapped_column(Float)
    predicted_label: Mapped[int] = mapped_column(Integer, index=True)
    risk_level: Mapped[str] = mapped_column(String(16), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    transaction: Mapped[Transaction] = relationship(back_populates="predictions")


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (UniqueConstraint("prediction_id", name="uq_alert_prediction"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), index=True)
    prediction_id: Mapped[int] = mapped_column(ForeignKey("predictions.id", ondelete="CASCADE"))
    severity: Mapped[str] = mapped_column(String(16), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    analyst_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    transaction: Mapped[Transaction] = relationship(back_populates="alerts")
    prediction: Mapped[Prediction] = relationship()


class ModelMetadata(Base):
    __tablename__ = "model_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)
    label: Mapped[str] = mapped_column(String(60))
    version: Mapped[str] = mapped_column(String(40))
    strategy: Mapped[str] = mapped_column(String(20))
    threshold: Mapped[float] = mapped_column(Float)
    rank: Mapped[int | None] = mapped_column(Integer)
    trained_at: Mapped[str] = mapped_column(String(40))
    artifact_path: Mapped[str] = mapped_column(String(200))
    summary_metrics: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text)  # JSON-encoded
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    def decoded(self):
        return json.loads(self.value)
