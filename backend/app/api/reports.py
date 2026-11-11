"""Reports & exports: CSV transaction export, evaluation report downloads."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from ml import config

from ..database import get_db
from ..services.model_registry import registry
from ..services.settings_service import active_model
from ..services.transaction_service import build_query
from .deps import check_model, require_models

router = APIRouter(prefix="/reports", tags=["reports"])

TX_COLUMNS = ["external_id", "source", "event_time", "amount", "customer_id", "merchant", "country", "city",
              "channel", "device", "status", "generation_profile", "ground_truth", "model", "model_version",
              "fraud_probability", "decision_threshold", "predicted_label", "risk_level"]


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


@router.get("/transactions.csv")
def export_transactions(model: str | None = None,
                        source: Literal["kaggle", "synthetic", "user"] | None = None,
                        risk_level: Literal["low", "medium", "high", "critical"] | None = None,
                        predicted_label: int | None = Query(None, ge=0, le=1),
                        q: str | None = None,
                        min_prob: float | None = Query(None, ge=0, le=1),
                        include_features: bool = False,
                        db: Session = Depends(get_db)):
    """Stream matching transactions + the selected model's latest prediction as CSV."""
    model = check_model(model) or active_model(db)
    stmt, _ = build_query(model, q=q, source=source, risk_level=risk_level,
                          predicted_label=predicted_label, min_prob=min_prob)
    cols = TX_COLUMNS + (config.FEATURE_COLUMNS if include_features else [])

    def rows():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(cols); yield buf.getvalue(); buf.seek(0); buf.truncate()
        for tx, p in db.execute(stmt.order_by("event_time")).yield_per(1000):
            line = [tx.external_id, tx.source, tx.event_time.isoformat(), f"{tx.amount:.2f}", tx.customer_id,
                    tx.merchant, tx.country, tx.city, tx.channel, tx.device, tx.status, tx.generation_profile,
                    tx.ground_truth, model, p.model_version if p else None,
                    f"{p.probability:.6f}" if p else None, p.threshold if p else None,
                    p.predicted_label if p else None, p.risk_level if p else None]
            if include_features:
                line += [tx.features.get(c) for c in config.FEATURE_COLUMNS]
            w.writerow(line); yield buf.getvalue(); buf.seek(0); buf.truncate()

    return StreamingResponse(rows(), media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="tranziq_transactions_{model}_{_stamp()}.csv"'})


@router.get("/alerts.csv")
def export_alerts(db: Session = Depends(get_db)):
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload
    from ..models import Alert
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["alert_id", "status", "severity", "analyst_note", "created_at", "updated_at", "transaction",
                "source", "amount", "model", "fraud_probability"])
    for a in db.scalars(select(Alert).options(joinedload(Alert.transaction), joinedload(Alert.prediction))
                        .order_by(Alert.id)).unique():
        w.writerow([a.id, a.status, a.severity, a.analyst_note, a.created_at.isoformat(), a.updated_at.isoformat(),
                    a.transaction.external_id, a.transaction.source, f"{a.transaction.amount:.2f}",
                    a.prediction.model_name, f"{a.prediction.probability:.6f}"])
    return Response(buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="tranziq_alerts_{_stamp()}.csv"'})


@router.get("/evaluation", dependencies=[Depends(require_models)])
def evaluation_report(format: Literal["json", "csv", "md"] = "md"):
    """Downloadable model evaluation report built from the real training results."""
    exp = registry.experiments()
    if format == "json":
        import json
        return Response(json.dumps(exp, indent=2), media_type="application/json", headers={
            "Content-Disposition": f'attachment; filename="tranziq_evaluation_{_stamp()}.json"'})
    if format == "csv":
        buf = io.StringIO(); w = csv.writer(buf)
        w.writerow(["section", "model", "strategy", "split", "threshold", "pr_auc", "roc_auc", "precision", "recall",
                    "f1", "accuracy", "tp", "fp", "fn", "tn"])
        for e in exp["experiments"]:
            v = e["validation"]
            w.writerow(["imbalance_experiment", e["model"], e["strategy"], "validation", 0.5, v["pr_auc"],
                        v["roc_auc"], v["precision"], v["recall"], v["f1"], "", "", "", "", ""])
        for n, m in exp["models"].items():
            t = m["test"]
            for key in ("at_default", "at_recommended"):
                r = t[key]; cm = r["confusion_matrix"]
                w.writerow([f"final_{key}", n, m["strategy"], "test", r["threshold"], t["pr_auc"], t["roc_auc"],
                            r["precision"], r["recall"], r["f1"], r["accuracy"], cm["tp"], cm["fp"], cm["fn"], cm["tn"]])
        return Response(buf.getvalue(), media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="tranziq_evaluation_{_stamp()}.csv"'})
    return Response(markdown_report(exp), media_type="text/markdown", headers={
        "Content-Disposition": f'attachment; filename="tranziq_evaluation_{_stamp()}.md"'})


def markdown_report(exp: dict) -> str:
    d = exp["dataset"]
    lines = [
        "# TRANZIQ - Model Evaluation Report", "",
        "*Intelligence Behind Every Transaction.*", "",
        f"- Generated: {exp['generated_at']}",
        f"- Random seed: {exp['random_seed']}" + ("  \n- **QUICK MODE (subsampled data)**" if exp.get("quick_mode") else ""),
        f"- Rows after cleaning: {d['cleaning']['rows_after_cleaning']:,} "
        f"(duplicates removed: {d['cleaning']['duplicate_rows_dropped']:,})",
        f"- Split: {exp['settings']['split']}",
        f"- Selection criterion: {exp['selection_criterion']}",
        f"- **Best model: {config.MODEL_LABELS[exp['best_model']]}**", "",
        "## Final models - held-out test split (at recommended threshold)", "",
        "| Rank | Model | Strategy | Threshold | PR-AUC | ROC-AUC | Precision | Recall | F1 | TP | FP | FN |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for n in exp["ranking"]:
        m = exp["models"][n]; t = m["test"]; r = t["at_recommended"]; cm = r["confusion_matrix"]
        lines.append(f"| {m['rank']} | {m['label']} | {m['strategy']} | {m['recommended_threshold']:.2f} | "
                     f"{t['pr_auc']:.4f} | {t['roc_auc']:.4f} | {r['precision']:.4f} | {r['recall']:.4f} | "
                     f"{r['f1']:.4f} | {cm['tp']} | {cm['fp']} | {cm['fn']} |")
    lines += ["", "## Imbalance strategy experiment - validation split (threshold 0.5)", "",
              "| Model | Strategy | PR-AUC | ROC-AUC | Precision | Recall | F1 | Train s |",
              "|---|---|---|---|---|---|---|---|"]
    for e in exp["experiments"]:
        v = e["validation"]
        lines.append(f"| {config.MODEL_LABELS[e['model']]} | {e['strategy']} | {v['pr_auc']:.4f} | {v['roc_auc']:.4f} | "
                     f"{v['precision']:.4f} | {v['recall']:.4f} | {v['f1']:.4f} | {e['train_seconds']} |")
    lines += ["", "## Threshold trade-off (test split)", ""]
    for n in exp["ranking"]:
        m = exp["models"][n]
        lines += [f"### {m['label']}", "", "| Threshold | Precision | Recall | F1 | False positives | False negatives |",
                  "|---|---|---|---|---|---|"]
        for r in m["test"]["threshold_table"]:
            cm = r["confusion_matrix"]
            lines.append(f"| {r['threshold']:.2f} | {r['precision']:.4f} | {r['recall']:.4f} | {r['f1']:.4f} | {cm['fp']} | {cm['fn']} |")
        lines.append("")
    lines += ["---", "Accuracy is reported but NOT used for selection: with ~0.17% fraud, predicting "
              "'legitimate' for everything is already ~99.8% accurate."]
    return "\n".join(lines)


@router.get("/pdf")
def pdf_report(db: Session = Depends(get_db)):
    """Professional branded PDF report built from stored results + live database."""
    from sqlalchemy import func, select

    from ..models import Alert, Prediction, Transaction
    from ..services.pdf_report import build_pdf
    from ..services.settings_service import risk_bands
    from ..services.transaction_service import latest_prediction_subquery

    exp = registry.experiments() if registry.artifacts_present() else None
    eda = registry.eda()
    model = active_model(db)
    latest = latest_prediction_subquery(model)
    dist_rows = dict(db.execute(select(Prediction.risk_level, func.count()).join(latest, latest.c.pid == Prediction.id)
                                .group_by(Prediction.risk_level)).all())
    flagged = db.scalar(select(func.count()).select_from(Prediction).join(latest, latest.c.pid == Prediction.id)
                        .where(Prediction.predicted_label == 1)) or 0
    n_tx = db.scalar(select(func.count(Transaction.id))) or 0
    live = {
        "active_model": model, "model_label": config.MODEL_LABELS[model],
        "transactions": n_tx, "predictions": db.scalar(select(func.count(Prediction.id))) or 0,
        "alerts": db.scalar(select(func.count(Alert.id))) or 0,
        "risk_distribution": {k: int(dist_rows.get(k, 0)) for k in ("low", "medium", "high", "critical")},
        "alert_status": dict(db.execute(select(Alert.status, func.count()).group_by(Alert.status)).all()),
        "bands": risk_bands(db), "flag_rate": flagged / n_tx if n_tx else 0.0,
    }
    pdf = build_pdf(exp, eda, live)
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="tranziq_report_{_stamp()}.pdf"'})
