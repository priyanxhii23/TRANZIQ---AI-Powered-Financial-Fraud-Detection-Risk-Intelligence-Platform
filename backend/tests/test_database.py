import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import Alert, AppSetting, Prediction, Transaction, utcnow


def _tx(ext):
    return Transaction(external_id=ext, source="user", event_time=utcnow(), amount=1.0, features={"Amount": 1.0})


def test_insert_and_cascade_delete(client):
    with SessionLocal() as db:
        tx = _tx("TEST-CASCADE")
        db.add(tx); db.flush()
        p = Prediction(transaction_id=tx.id, model_name="xgboost", model_version="t", probability=0.9,
                       threshold=0.5, predicted_label=1, risk_level="critical")
        db.add(p); db.flush()
        db.add(Alert(transaction_id=tx.id, prediction_id=p.id, severity="critical"))
        db.commit()
        tx_id = tx.id
        db.delete(tx); db.commit()
        assert db.scalar(select(Prediction).where(Prediction.transaction_id == tx_id)) is None
        assert db.scalar(select(Alert).where(Alert.transaction_id == tx_id)) is None


def test_external_id_is_unique(client):
    with SessionLocal() as db:
        db.add(_tx("TEST-UNIQUE")); db.commit()
        db.add(_tx("TEST-UNIQUE"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_alert_defaults_to_pending(client):
    with SessionLocal() as db:
        tx = _tx("TEST-ALERT"); db.add(tx); db.flush()
        p = Prediction(transaction_id=tx.id, model_name="xgboost", model_version="t", probability=0.7,
                       threshold=0.5, predicted_label=1, risk_level="high")
        db.add(p); db.flush()
        a = Alert(transaction_id=tx.id, prediction_id=p.id, severity="high")
        db.add(a); db.commit()
        assert a.status == "pending" and a.created_at is not None


def test_settings_roundtrip(client):
    from app.services.settings_service import get_setting, set_setting
    with SessionLocal() as db:
        set_setting(db, "risk_bands", {"medium": 0.2, "high": 0.4, "critical": 0.9})
        assert get_setting(db, "risk_bands")["critical"] == 0.9
        set_setting(db, "risk_bands", {"medium": 0.25, "high": 0.5, "critical": 0.8})
        assert db.get(AppSetting, "risk_bands") is not None
