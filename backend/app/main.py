"""TRANZIQ API entry point.

Run (from the ``backend`` folder):
    uvicorn app.main:app --reload --port 8000
Interactive API docs: http://localhost:8000/docs
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ml import config as ml_config

from . import __version__
from .api import alerts, dashboard, explain_api, models_api, predict, reports, synthetic_api, system, transactions
from .config import settings
from .database import SessionLocal, init_db
from .services.model_registry import ModelsNotTrainedError, registry
from .services.seed_service import seed_if_empty, sync_model_metadata

log = logging.getLogger("tranziq")
logging.basicConfig(level=logging.INFO, format="[TRANZIQ] %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if registry.artifacts_present():
        loaded = registry.load_all()
        log.info("Loaded models: %s", loaded)
        with SessionLocal() as db:
            if settings.auto_seed:
                log.info("Seeding: %s", seed_if_empty(db))
            else:
                sync_model_metadata(db)
    else:
        log.warning("Models not trained yet. Run: python backend/scripts/train_models.py")
    yield


app = FastAPI(
    title="TRANZIQ API",
    description="AI-Powered Financial Fraud Detection & Transaction Risk Intelligence. "
                "*Intelligence Behind Every Transaction.*",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(ModelsNotTrainedError)
async def _not_trained(_: Request, exc: ModelsNotTrainedError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


for r in (system.router, dashboard.router, transactions.router, predict.router, models_api.router,
          synthetic_api.router, alerts.router, explain_api.router, reports.router):
    app.include_router(r, prefix="/api")

ml_config.PLOTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static/plots", StaticFiles(directory=ml_config.PLOTS_DIR), name="plots")


@app.get("/", include_in_schema=False)
def root():
    return {"app": "TRANZIQ", "tagline": settings.tagline, "docs": "/docs", "health": "/api/health"}
