"""Health, dataset information, settings and risk-engine endpoints."""
from __future__ import annotations

import time
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ml import config

from .. import __version__
from ..config import settings
from ..database import get_db
from ..models import Alert, Prediction, Transaction
from ..schemas import RiskAssessRequest, SettingsUpdate
from ..services import risk
from ..services.model_registry import registry
from ..services.settings_service import (
    active_model,
    all_settings,
    decision_threshold,
    get_setting,
    risk_bands,
    set_setting,
)

router = APIRouter(tags=["system"])
STARTED = time.time()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """Basic application health monitoring."""
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # pragma: no cover
        db_ok = False
    trained = registry.artifacts_present()
    return {
        "status": "ok" if db_ok and trained else "degraded",
        "app": "TRANZIQ", "version": __version__,
        "time": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": round(time.time() - STARTED, 1),
        "checks": {
            "database": db_ok,
            "models_trained": trained,
            "models_loaded": registry.loaded_models(),
            "dataset_present": config.RAW_DATA_PATH.exists(),
        },
        "message": None if trained else "Models not trained - run: python backend/scripts/train_models.py",
    }


@router.get("/dataset/info")
def dataset_info():
    """Real Kaggle dataset statistics (computed at training time)."""
    eda = registry.eda()
    return {
        "dataset_present": config.RAW_DATA_PATH.exists(),
        "expected_path": "data/raw/creditcard.csv",
        "source_url": config.DATASET_URL,
        "download_instructions": [
            "Option A: python backend/scripts/download_dataset.py",
            f"Option B: download creditcard.csv from {config.DATASET_URL} and place it in data/raw/",
        ],
        "statistics": eda["statistics"] if eda else None,
        "cleaning": eda["cleaning"] if eda else None,
        "splits": eda["splits"] if eda else None,
        "message": None if eda else "Dataset statistics unavailable - train the models first.",
    }


@router.get("/dataset/eda")
def dataset_eda():
    eda = registry.eda()
    if not eda:
        raise HTTPException(404, "EDA not generated yet - run the training script.")
    return eda


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return all_settings(db)


@router.put("/settings")
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    if body.active_model:
        if body.active_model not in registry.available_models():
            raise HTTPException(409, f"Model '{body.active_model}' is not trained.")
        set_setting(db, "active_model", body.active_model)
    if body.risk_bands:
        bands = body.risk_bands.model_dump()
        try:
            risk.validate_bands(bands)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        set_setting(db, "risk_bands", bands)
    if body.threshold_overrides is not None:
        cur = get_setting(db, "threshold_overrides")
        for k, v in body.threshold_overrides.items():
            if k not in config.MODEL_NAMES:
                raise HTTPException(422, f"Unknown model '{k}'")
            if v is not None and not 0.01 <= v <= 0.99:
                raise HTTPException(422, "Thresholds must be between 0.01 and 0.99")
            cur[k] = v
        set_setting(db, "threshold_overrides", cur)
    return all_settings(db)


@router.get("/risk/levels")
def risk_levels(db: Session = Depends(get_db)):
    """The four risk levels, their probability ranges and current counts (active model)."""
    model = active_model(db)
    bands = risk_bands(db)
    from ..services.transaction_service import latest_prediction_subquery
    latest = latest_prediction_subquery(model)
    counts = dict(db.execute(
        select(Prediction.risk_level, func.count()).join(latest, latest.c.pid == Prediction.id)
        .group_by(Prediction.risk_level)).all())
    return {"model": model, "bands": bands, "decision_threshold": decision_threshold(db, model),
            "levels": [{**lvl, "count": int(counts.get(lvl["level"], 0))} for lvl in risk.describe_bands(bands)]}


@router.post("/risk/assess")
def risk_assess(body: RiskAssessRequest, db: Session = Depends(get_db)):
    model = active_model(db)
    thr = body.threshold if body.threshold is not None else decision_threshold(db, model)
    return risk.explain_level(body.probability, risk_bands(db), thr)


@router.post("/risk/reclassify")
def risk_reclassify(db: Session = Depends(get_db)):
    """Re-apply the current risk bands to every stored prediction (after changing bands)."""
    bands = risk_bands(db)
    n = 0
    for p in db.scalars(select(Prediction)).yield_per(2000):
        lvl = risk.classify(p.probability, bands)
        if lvl != p.risk_level:
            p.risk_level = lvl; n += 1
    db.commit()
    return {"updated_predictions": n, "bands": bands}


@router.get("/monitoring")
def monitoring(db: Session = Depends(get_db)):
    """Model monitoring: prediction counts, versions, last activity, DB stats."""
    per_model = db.execute(select(Prediction.model_name, func.count(), func.max(Prediction.created_at),
                                  func.avg(Prediction.probability), func.sum(Prediction.predicted_label))
                           .group_by(Prediction.model_name)).all()
    exp = registry.experiments() if registry.artifacts_present() else None
    db_size = None
    if settings.database_url.startswith("sqlite:///"):
        db_file = Path(settings.database_url.replace("sqlite:///", ""))
        db_size = db_file.stat().st_size if db_file.exists() else None
    return {
        "active_model": active_model(db),
        "training": None if not exp else {
            "generated_at": exp["generated_at"], "total_training_seconds": exp["total_training_seconds"],
            "best_model": exp["best_model"], "selection_criterion": exp["selection_criterion"],
            "random_seed": exp["random_seed"], "quick_mode": exp.get("quick_mode", False),
        },
        "models": [{
            "name": n, "label": config.MODEL_LABELS[n],
            "version": exp["models"][n]["version"] if exp and n in exp["models"] else None,
            "trained_at": exp["models"][n]["trained_at"] if exp and n in exp["models"] else None,
            "loaded": n in registry.loaded_models(),
            "prediction_count": next((int(c) for m, c, *_ in per_model if m == n), 0),
            "last_prediction": next((t.isoformat() for m, _, t, *_ in per_model if m == n and t), None),
            "mean_probability": next((float(a) for m, _, _, a, _ in per_model if m == n and a is not None), None),
            "flagged": next((int(f or 0) for m, _, _, _, f in per_model if m == n), 0),
        } for n in config.MODEL_NAMES],
        "database": {
            "transactions": db.scalar(select(func.count(Transaction.id))),
            "predictions": db.scalar(select(func.count(Prediction.id))),
            "alerts": db.scalar(select(func.count(Alert.id))),
            "size_bytes": db_size,
        },
        "uptime_seconds": round(time.time() - STARTED, 1),
    }
