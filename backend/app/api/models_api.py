"""Model Comparison Laboratory endpoints. Everything comes from the real
evaluation report written by training (artifacts/reports/experiments.json)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ml import config
from ml.evaluation import metrics_at_threshold

from ..database import get_db
from ..services.model_registry import registry
from ..services.settings_service import active_model, decision_threshold
from .deps import check_model, require_models

router = APIRouter(prefix="/models", tags=["models"], dependencies=[Depends(require_models)])

SUMMARY_KEYS = ("precision", "recall", "f1", "accuracy")


def _summary(m: dict) -> dict:
    t = m["test"]
    return {"pr_auc": t["pr_auc"], "roc_auc": t["roc_auc"],
            **{k: t["at_recommended"][k] for k in SUMMARY_KEYS},
            "confusion_matrix": t["at_recommended"]["confusion_matrix"]}


@router.get("")
def list_models(db: Session = Depends(get_db)):
    exp = registry.experiments()
    act = active_model(db)
    return {
        "active_model": act, "best_model": exp["best_model"], "selection_criterion": exp["selection_criterion"],
        "models": [{
            "name": n, "label": m["label"], "version": m["version"], "strategy": m["strategy"],
            "trained_at": m["trained_at"], "train_seconds": m["train_seconds"], "rank": m.get("rank"),
            "recommended_threshold": m["recommended_threshold"], "decision_threshold": decision_threshold(db, n),
            "hyperparameters": m["hyperparameters"], "artifact": m["artifact"],
            "is_active": n == act, "is_best": n == exp["best_model"], "loaded": n in registry.loaded_models(),
            "test_summary": _summary(m),
        } for n, m in exp["models"].items()],
    }


@router.get("/metrics")
def models_metrics():
    """Full test-set evaluation for every model (curves, confusion matrices, threshold tables)."""
    exp = registry.experiments()
    return {"dataset": exp["dataset"], "generated_at": exp["generated_at"],
            "models": {n: {"label": m["label"], "strategy": m["strategy"], "version": m["version"],
                           "recommended_threshold": m["recommended_threshold"],
                           "threshold_objective": m["threshold_objective"],
                           "validation": m["validation"], "test": m["test"]}
                       for n, m in exp["models"].items()}}


@router.get("/comparison")
def models_comparison():
    exp = registry.experiments()
    return {
        "ranking": [{"rank": i + 1, "name": n, "label": exp["models"][n]["label"],
                     "validation_pr_auc": exp["models"][n]["validation"]["pr_auc"],
                     "test": _summary(exp["models"][n])} for i, n in enumerate(exp["ranking"])],
        "best_model": exp["best_model"],
        "selection_criterion": exp["selection_criterion"],
        "imbalance_experiments": exp["experiments"],
        "settings": exp["settings"],
        "generated_at": exp["generated_at"],
        "quick_mode": exp.get("quick_mode", False),
    }


@router.get("/{name}/threshold-analysis")
def threshold_analysis(name: str, threshold: float = Query(0.5, ge=0.01, le=0.99)):
    """Evaluate ANY threshold on the held-out test split (interactive slider)."""
    check_model(name)
    y, p = registry.test_probabilities(name)
    m = metrics_at_threshold(y, p, threshold)
    cm = m["confusion_matrix"]
    return {"model": name, **m, "flagged": cm["tp"] + cm["fp"], "missed_fraud": cm["fn"],
            "false_alarms": cm["fp"], "test_rows": int(len(y)), "test_fraud": int(y.sum())}


@router.post("/reload")
def reload_models():
    """Reload artifacts from disk after re-training (no server restart needed)."""
    registry.reload()
    return {"loaded": registry.load_all()}


@router.get("/{name}")
def get_model(name: str, db: Session = Depends(get_db)):
    check_model(name)
    exp = registry.experiments()
    if name not in exp["models"]:
        raise HTTPException(404, f"Model {name} not trained")
    return {**exp["models"][name], "decision_threshold": decision_threshold(db, name),
            "experiments": [e for e in exp["experiments"] if e["model"] == name],
            "label": config.MODEL_LABELS[name]}
