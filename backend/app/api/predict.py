"""Transaction Fraud Scanner endpoints (single, batch JSON, CSV upload)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..schemas import BatchPredictRequest, PredictRequest
from ..services.prediction_service import CSVValidationError, parse_upload, predict_batch, predict_single
from .deps import check_model, require_models

router = APIRouter(prefix="/predict", tags=["prediction"], dependencies=[Depends(require_models)])


@router.post("")
def predict(body: PredictRequest, db: Session = Depends(get_db)):
    """Score ONE transaction. Returns probability, label, risk level and SHAP explanation."""
    return predict_single(db, body.features, body.model, body.threshold, body.persist, body.explain,
                          body.metadata.model_dump() if body.metadata else None)


@router.post("/batch")
def predict_batch_json(body: BatchPredictRequest, db: Session = Depends(get_db)):
    from ml.config import FEATURE_COLUMNS
    for i, row in enumerate(body.transactions):
        missing = [c for c in FEATURE_COLUMNS if c not in row]
        if missing:
            raise HTTPException(422, f"Row {i}: missing features {missing}")
    return predict_batch(db, body.transactions, body.model, body.threshold, body.persist)


@router.post("/upload")
async def predict_upload(
    file: UploadFile = File(..., description="CSV with columns Time, V1..V28, Amount"),
    model: str | None = Form(None),
    threshold: float | None = Form(None),
    persist: bool = Form(False),
    db: Session = Depends(get_db),
):
    """Batch prediction from an uploaded CSV, with per-row validation errors."""
    check_model(model or None)
    if threshold is not None and not 0.01 <= threshold <= 0.99:
        raise HTTPException(422, "threshold must be between 0.01 and 0.99")
    if file.filename and not file.filename.lower().endswith(".csv"):
        raise HTTPException(415, "Please upload a .csv file")
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 25 MB)")
    try:
        rows, errors, info = parse_upload(content, settings.max_upload_rows)
    except CSVValidationError as e:
        raise HTTPException(422, str(e)) from e
    if not rows:
        raise HTTPException(422, {"message": "No valid rows in file", "errors": errors[:50], "info": info})
    out = predict_batch(db, rows, model or None, threshold, persist)
    out["validation"] = {**info, "errors": errors[:100]}
    return out


@router.get("/template.csv")
def csv_template(samples: int = 0, db: Session = Depends(get_db)):
    """CSV template for batch scans. samples>0 adds that many REAL held-out Kaggle records
    (half fraud-labelled, half legitimate) including their known `Class` label, which
    the scanner ignores for prediction."""
    import csv
    import io

    from fastapi import Query  # noqa: F401
    from fastapi.responses import Response
    from sqlalchemy import func, select

    from ml.config import FEATURE_COLUMNS

    from ..models import Transaction

    samples = max(0, min(int(samples), 50))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(FEATURE_COLUMNS + (["Class"] if samples else []))
    if samples:
        rows = []
        for label, n in ((1, samples // 2), (0, samples - samples // 2)):
            rows += db.scalars(select(Transaction).where(Transaction.source == "kaggle", Transaction.ground_truth == label)
                               .order_by(func.random()).limit(n)).all()
        for tx in rows:
            w.writerow([tx.features[c] for c in FEATURE_COLUMNS] + [tx.ground_truth])
    name = "tranziq_sample_transactions.csv" if samples else "tranziq_batch_template.csv"
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})
