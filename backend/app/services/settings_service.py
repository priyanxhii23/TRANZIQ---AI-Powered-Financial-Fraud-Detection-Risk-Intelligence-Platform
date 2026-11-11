"""Persisted application settings (stored as JSON in ``app_settings``)."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ml import config

from ..models import AppSetting
from .model_registry import ModelsNotTrainedError, registry

# Default risk bands on fraud probability:
#   low < 0.25 <= medium < 0.50 <= high < 0.80 <= critical
DEFAULTS = {
    "risk_bands": {"medium": 0.25, "high": 0.50, "critical": 0.80},
    "threshold_overrides": {},   # model -> custom decision threshold (None = recommended)
    "active_model": None,         # None -> best model from training
}


def get_setting(db: Session, key: str):
    row = db.get(AppSetting, key)
    return row.decoded() if row else json.loads(json.dumps(DEFAULTS[key]))


def set_setting(db: Session, key: str, value) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = json.dumps(value)
    else:
        db.add(AppSetting(key=key, value=json.dumps(value)))
    db.commit()


def best_model() -> str:
    try:
        return registry.experiments()["best_model"]
    except ModelsNotTrainedError:
        return "xgboost"


def active_model(db: Session) -> str:
    m = get_setting(db, "active_model")
    return m if m in config.MODEL_NAMES else best_model()


def recommended_threshold(name: str) -> float:
    try:
        return float(registry.experiments()["models"][name]["recommended_threshold"])
    except (ModelsNotTrainedError, KeyError):
        return 0.5


def decision_threshold(db: Session, name: str) -> float:
    override = get_setting(db, "threshold_overrides").get(name)
    return float(override) if override is not None else recommended_threshold(name)


def risk_bands(db: Session) -> dict:
    return get_setting(db, "risk_bands")


def all_settings(db: Session) -> dict:
    act = active_model(db)
    return {
        "active_model": act,
        "best_model": best_model(),
        "risk_bands": risk_bands(db),
        "threshold_overrides": get_setting(db, "threshold_overrides"),
        "decision_thresholds": {n: decision_threshold(db, n) for n in config.MODEL_NAMES},
        "recommended_thresholds": {n: recommended_threshold(n) for n in config.MODEL_NAMES},
    }
