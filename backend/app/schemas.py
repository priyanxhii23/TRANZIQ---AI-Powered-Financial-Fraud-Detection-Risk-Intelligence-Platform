"""Pydantic request/response models - FastAPI uses these for validation
and for the interactive API docs at /docs."""
from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ml.config import FEATURE_COLUMNS

ModelName = Literal["logistic_regression", "random_forest", "xgboost"]
AlertStatus = Literal["pending", "investigating", "confirmed", "dismissed"]
RiskLevel = Literal["low", "medium", "high", "critical"]


class TransactionMetadata(BaseModel):
    """Optional descriptive metadata - NOT used by the models."""
    customer_id: str | None = Field(None, max_length=32)
    merchant: str | None = Field(None, max_length=80)
    country: str | None = Field(None, max_length=60)
    city: str | None = Field(None, max_length=60)
    channel: str | None = Field(None, max_length=40)
    device: str | None = Field(None, max_length=40)


class PredictRequest(BaseModel):
    features: dict[str, float] = Field(..., description="All 30 features: Time, V1..V28, Amount")
    model: ModelName | None = Field(None, description="Defaults to the active model")
    threshold: float | None = Field(None, ge=0.01, le=0.99, description="Defaults to the model's recommended threshold")
    persist: bool = Field(True, description="Store as a 'user' transaction")
    explain: bool = True
    metadata: TransactionMetadata | None = None

    @field_validator("features")
    @classmethod
    def check_features(cls, v: dict[str, float]) -> dict[str, float]:
        missing = [c for c in FEATURE_COLUMNS if c not in v]
        if missing:
            raise ValueError(f"missing features: {missing}")
        extra = [k for k in v if k not in FEATURE_COLUMNS]
        if extra:
            raise ValueError(f"unknown features: {extra}")
        bad = [k for k, x in v.items() if x is None or not math.isfinite(x)]
        if bad:
            raise ValueError(f"features must be finite numbers: {bad}")
        if v["Amount"] < 0:
            raise ValueError("Amount must be >= 0")
        if v["Time"] < 0:
            raise ValueError("Time must be >= 0")
        return v


class BatchPredictRequest(BaseModel):
    transactions: list[dict[str, float]] = Field(..., min_length=1, max_length=5000)
    model: ModelName | None = None
    threshold: float | None = Field(None, ge=0.01, le=0.99)
    persist: bool = False


class SyntheticRequest(BaseModel):
    count: int = Field(100, ge=1, le=1000)
    fraud_profile_ratio: float = Field(0.05, ge=0, le=1, description="Share of seeds drawn from fraud-labelled training rows")
    noise_level: float = Field(0.15, ge=0, le=1, description="Perturbation strength (x feature std)")
    days_back: int = Field(14, ge=1, le=90)
    seed: int | None = Field(None, description="Random seed for reproducible batches")
    persist: bool = True


class AlertUpdate(BaseModel):
    status: AlertStatus | None = None
    analyst_note: str | None = Field(None, max_length=2000)


class RiskBands(BaseModel):
    medium: float = Field(..., ge=0.01, le=0.99)
    high: float = Field(..., ge=0.01, le=0.99)
    critical: float = Field(..., ge=0.01, le=0.99)


class SettingsUpdate(BaseModel):
    active_model: ModelName | None = None
    risk_bands: RiskBands | None = None
    threshold_overrides: dict[str, float | None] | None = None


class RiskReapplyRequest(BaseModel):
    bands: RiskBands | None = Field(None, description="New bands to save first; omit to re-apply the saved bands")


class ScenarioRequest(BaseModel):
    scenario: Literal["unusual_spending", "rapid_activity", "fraud_patterns", "legit_patterns", "custom"]
    count: int = Field(40, ge=1, le=500)
    intensity: float = Field(0.5, ge=0, le=1, description="Perturbation strength 0-1")
    amount: float | None = Field(None, ge=0, le=100000, description="Fixed amount (custom / unusual spending)")
    interval_seconds: float = Field(30, ge=1, le=86400, description="Gap between transactions (rapid activity / custom)")
    base_profile: Literal["legit", "fraud"] = "legit"
    base_transaction_id: int | None = Field(None, description="Stored Kaggle record to start from")
    model: ModelName | None = None
    threshold: float | None = Field(None, ge=0.01, le=0.99)
    seed: int | None = None
    persist: bool = False


class RiskAssessRequest(BaseModel):
    probability: float = Field(..., ge=0, le=1)
    threshold: float | None = Field(None, ge=0.01, le=0.99)


class PredictionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    model_name: str
    model_version: str
    probability: float
    threshold: float
    predicted_label: int
    risk_level: str
    created_at: datetime
