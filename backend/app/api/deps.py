"""Shared router helpers."""
from __future__ import annotations

from fastapi import HTTPException

from ml import config

from ..services.model_registry import ModelsNotTrainedError, registry


def require_models() -> None:
    if not registry.artifacts_present():
        raise HTTPException(status_code=503, detail=str(ModelsNotTrainedError()))


def check_model(name: str | None) -> str | None:
    if name is not None and name not in config.MODEL_NAMES:
        raise HTTPException(status_code=422, detail=f"Unknown model '{name}'. Choose one of {config.MODEL_NAMES}")
    return name
