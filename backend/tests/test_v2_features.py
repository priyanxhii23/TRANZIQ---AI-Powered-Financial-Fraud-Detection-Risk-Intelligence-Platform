"""Tests for the V2 features: bulk risk re-apply, Scenario Lab, PDF report, CSV templates."""
import numpy as np
import pytest

from ml import config
from ml import scenarios as sc
from tests.conftest import make_dataset

FEATURES = config.FEATURE_COLUMNS


# ---------------- risk re-apply ----------------
def test_reapply_updates_stored_predictions_and_alert_severity(client):
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Alert, Prediction

    # Make every alert-raising prediction 'critical' with very low bands, then check alerts follow.
    r = client.post("/api/risk/reapply", json={"bands": {"medium": 0.02, "high": 0.03, "critical": 0.04}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_predictions"] == sum(body["distribution_after"].values())
    with SessionLocal() as db:
        for p in db.scalars(select(Prediction)).all():
            expected = "critical" if p.probability >= 0.04 else "high" if p.probability >= 0.03 else "medium" if p.probability >= 0.02 else "low"
            assert p.risk_level == expected
        for a in db.scalars(select(Alert)).all():
            assert a.severity == db.get(Prediction, a.prediction_id).risk_level
    assert client.get("/api/settings").json()["risk_bands"]["critical"] == 0.04

    # Restoring the defaults changes predictions back; dashboard reflects the persisted levels.
    r2 = client.post("/api/risk/reapply", json={"bands": {"medium": 0.25, "high": 0.5, "critical": 0.8}})
    assert r2.json()["updated_predictions"] > 0
    dist = client.get("/api/dashboard/summary").json()["risk_distribution"]
    levels = {x["level"]: x["count"] for x in client.get("/api/risk/levels").json()["levels"]}
    assert dist == levels


def test_reapply_rejects_misordered_bands(client):
    before = client.get("/api/settings").json()["risk_bands"]
    r = client.post("/api/risk/reapply", json={"bands": {"medium": 0.6, "high": 0.5, "critical": 0.8}})
    assert r.status_code == 422
    assert client.get("/api/settings").json()["risk_bands"] == before  # nothing saved


def test_reapply_without_body_uses_saved_bands(client):
    r = client.post("/api/risk/reapply")
    assert r.status_code == 200 and r.json()["updated_predictions"] == 0


# ---------------- scenario engine (unit) ----------------
@pytest.fixture(scope="module")
def pool():
    from ml.synthetic import build_pool
    df = make_dataset(1500)
    return build_pool(df[FEATURES], df["Class"], legit_size=400)


@pytest.mark.parametrize("name", list(sc.CATALOG))
def test_every_scenario_produces_model_compatible_vectors(pool, name):
    out = sc.run(pool, name, 25, intensity=0.6, amount=300 if name == "custom" else None, seed=3)
    X = out["X"]
    assert X.shape == (25, 30) and np.isfinite(X).all()
    assert (X[:, FEATURES.index("Amount")] >= 0).all()
    assert (X[:, FEATURES.index("Time")] <= sc.MAX_TIME).all()


def test_unusual_spending_inflates_amount_only(pool):
    base = pool["legit"][0].copy()
    out = sc.run(pool, "unusual_spending", 50, intensity=1.0, base=base, seed=1)
    a = FEATURES.index("Amount")
    assert (out["X"][:, a] >= max(base[a], 1.0) - 1e-6).all()
    assert out["X"][:, a].max() > 5 * max(base[a], 1.0)
    v = [FEATURES.index(f) for f in config.V_FEATURES]
    assert np.abs(out["X"][:, v] - base[v]).max() < 1.0  # V components nearly unchanged


def test_rapid_activity_spaces_time(pool):
    base = pool["legit"][1].copy()
    base[FEATURES.index("Time")] = 1000
    out = sc.run(pool, "rapid_activity", 10, interval=15, base=base, seed=2)
    t = out["X"][:, FEATURES.index("Time")]
    assert list(np.diff(t)) == [15.0] * 9


def test_scenarios_are_reproducible_and_validated(pool):
    a = sc.run(pool, "fraud_patterns", 10, seed=9)["X"]
    b = sc.run(pool, "fraud_patterns", 10, seed=9)["X"]
    assert np.array_equal(a, b)
    with pytest.raises(ValueError):
        sc.run(pool, "nope", 10)
    with pytest.raises(ValueError):
        sc.run(pool, "custom", 0)


# ---------------- scenario API ----------------
def test_scenario_api_returns_real_predictions_without_persisting(client):
    before = client.get("/api/synthetic/stats").json()["synthetic_transactions"]
    r = client.post("/api/scenarios/run", json={"scenario": "fraud_patterns", "count": 40, "seed": 4, "model": "random_forest", "threshold": 0.3})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["model"] == "random_forest" and b["threshold"] == 0.3
    assert len(b["items"]) == 40 and b["summary"]["count"] == 40
    assert b["summary"]["predicted_fraud"] == sum(i["probability"] >= 0.3 for i in b["items"])
    assert sum(b["summary"]["risk_levels"].values()) == 40
    assert "no ground-truth" in b["note"].lower()
    assert client.get("/api/synthetic/stats").json()["synthetic_transactions"] == before


def test_scenario_persist_marks_records_synthetic_without_labels(client):
    tx_id = client.get("/api/transactions", params={"source": "kaggle", "page_size": 1}).json()["items"][0]["id"]
    r = client.post("/api/scenarios/run", json={"scenario": "rapid_activity", "count": 5, "base_transaction_id": tx_id, "persist": True, "seed": 1})
    b = r.json()
    assert b["persisted"] == 5 and b["base"]["id"] == tx_id
    stored = client.get("/api/transactions", params={"source": "synthetic", "q": "SCN-", "page_size": 50}).json()["items"]
    assert len(stored) >= 5 and all(t["ground_truth"] is None for t in stored)
    assert all(t["generation_profile"] == "scenario:rapid_activity" for t in stored[:5])


def test_scenario_api_validation(client):
    assert client.post("/api/scenarios/run", json={"scenario": "fraud_patterns", "count": 0}).status_code == 422
    assert client.post("/api/scenarios/run", json={"scenario": "bogus"}).status_code == 422
    assert client.post("/api/scenarios/run", json={"scenario": "custom", "base_transaction_id": 999999}).status_code == 404
    assert len(client.get("/api/scenarios/catalog").json()["scenarios"]) == 5


# ---------------- PDF + templates ----------------
def test_pdf_report(client):
    r = client.get("/api/reports/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-")
    pages = r.content.count(b"/Type /Page") - r.content.count(b"/Type /Pages")
    assert pages == 5
    assert "attachment" in r.headers["content-disposition"]


def test_csv_templates(client):
    t = client.get("/api/predict/template.csv")
    assert t.status_code == 200 and t.text.strip() == ",".join(FEATURES)
    s = client.get("/api/predict/template.csv", params={"samples": 6})
    lines = s.text.strip().splitlines()
    assert lines[0].split(",") == FEATURES + ["Class"] and len(lines) == 7
    # the sample file round-trips through the CSV upload validator
    up = client.post("/api/predict/upload", files={"file": ("s.csv", s.content, "text/csv")})
    assert up.status_code == 200 and up.json()["summary"]["rows"] == 6
