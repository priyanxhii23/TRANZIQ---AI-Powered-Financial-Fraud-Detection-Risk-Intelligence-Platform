"""End-to-end API tests (FastAPI TestClient + temporary SQLite DB)."""
import io

FEATURES = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]


# ---- system ---------------------------------------------------------------------
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["checks"]["models_trained"] and body["checks"]["database"]
    assert set(body["checks"]["models_loaded"]) == {"logistic_regression", "random_forest", "xgboost"}


def test_startup_seeded_real_and_synthetic(client):
    s = client.get("/api/dashboard/summary").json()
    assert s["sources"]["kaggle"] > 0 and s["sources"]["synthetic"] == 40
    assert s["total_transactions"] == s["predicted_fraud"] + s["predicted_legitimate"]
    assert set(s["risk_distribution"]) == {"low", "medium", "high", "critical"}


def test_dataset_info(client):
    d = client.get("/api/dataset/info").json()
    assert d["dataset_present"] and d["statistics"]["rows"] == 3000


# ---- prediction -----------------------------------------------------------------
def test_predict_single(client, feature_row):
    r = client.post("/api/predict", json={"features": feature_row, "model": "random_forest", "persist": True})
    assert r.status_code == 200, r.text
    b = r.json()
    assert 0 <= b["probability"] <= 1
    assert b["predicted_label"] == int(b["probability"] >= b["threshold"])
    assert b["risk"]["level"] in {"low", "medium", "high", "critical"}
    assert len(b["explanation"]["contributions"]) > 0
    tx = client.get(f"/api/transactions/{b['transaction_id']}").json()
    assert tx["source"] == "user" and tx["ground_truth"] is None
    assert {p["model_name"] for p in tx["predictions"]} == {"logistic_regression", "random_forest", "xgboost"}


def test_predict_custom_threshold(client, feature_row):
    lo = client.post("/api/predict", json={"features": feature_row, "threshold": 0.01, "persist": False, "explain": False}).json()
    hi = client.post("/api/predict", json={"features": feature_row, "threshold": 0.99, "persist": False, "explain": False}).json()
    assert lo["threshold"] == 0.01 and hi["threshold"] == 0.99
    assert lo["predicted_label"] >= hi["predicted_label"]


def test_predict_validation_errors(client, feature_row):
    missing = {k: v for k, v in feature_row.items() if k != "V3"}
    assert client.post("/api/predict", json={"features": missing}).status_code == 422
    assert client.post("/api/predict", json={"features": {**feature_row, "Amount": -1}}).status_code == 422
    assert client.post("/api/predict", json={"features": {**feature_row, "Bogus": 1}}).status_code == 422
    assert client.post("/api/predict", json={"features": feature_row, "model": "svm"}).status_code == 422
    assert client.post("/api/predict", json={"features": feature_row, "threshold": 1.5}).status_code == 422


def test_predict_batch(client, feature_row):
    r = client.post("/api/predict/batch", json={"transactions": [feature_row, feature_row], "model": "xgboost"})
    assert r.status_code == 200
    assert r.json()["summary"]["rows"] == 2
    bad = client.post("/api/predict/batch", json={"transactions": [{"Amount": 1}]})
    assert bad.status_code == 422


# ---- CSV upload -----------------------------------------------------------------
def _csv(rows):
    return io.BytesIO("\n".join(rows).encode())


def test_upload_csv_with_row_level_errors(client, feature_row):
    header = ",".join(FEATURES + ["Class"])
    good = ",".join(str(feature_row[c]) for c in FEATURES) + ",0"
    bad = "x," + ",".join(["1"] * 29) + ",0"
    r = client.post("/api/predict/upload", files={"file": ("t.csv", _csv([header, good, good, bad]), "text/csv")},
                    data={"model": "logistic_regression"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["summary"]["rows"] == 2
    assert b["validation"]["invalid_rows"] == 1 and b["validation"]["errors"][0]["row"] == 4
    assert b["validation"]["has_class_column"] is True


def test_upload_csv_missing_columns(client):
    r = client.post("/api/predict/upload", files={"file": ("t.csv", _csv(["Time,Amount", "1,2"]), "text/csv")})
    assert r.status_code == 422 and "Missing required columns" in r.json()["detail"]


def test_upload_empty_and_wrong_type(client):
    assert client.post("/api/predict/upload", files={"file": ("t.csv", _csv([""]), "text/csv")}).status_code == 422
    assert client.post("/api/predict/upload", files={"file": ("t.txt", _csv(["a"]), "text/plain")}).status_code == 415


# ---- transactions ---------------------------------------------------------------------
def test_transactions_filters_sort_pagination(client):
    r = client.get("/api/transactions", params={"source": "kaggle", "page_size": 5, "sort_by": "amount", "sort_dir": "desc"})
    b = r.json()
    assert r.status_code == 200 and len(b["items"]) == 5
    amounts = [t["amount"] for t in b["items"]]
    assert amounts == sorted(amounts, reverse=True)
    assert all(t["source"] == "kaggle" for t in b["items"])
    p2 = client.get("/api/transactions", params={"source": "kaggle", "page_size": 5, "page": 2, "sort_by": "amount", "sort_dir": "desc"}).json()
    assert {t["id"] for t in p2["items"]}.isdisjoint({t["id"] for t in b["items"]})
    hi = client.get("/api/transactions", params={"min_prob": 0.5, "model": "xgboost"}).json()
    assert all(t["prediction"]["probability"] >= 0.5 for t in hi["items"])
    amt = client.get("/api/transactions", params={"min_amount": 10, "max_amount": 50}).json()
    assert all(10 <= t["amount"] <= 50 for t in amt["items"])


def test_transaction_404_and_bad_params(client):
    assert client.get("/api/transactions/999999").status_code == 404
    assert client.get("/api/transactions", params={"source": "mars"}).status_code == 422


def test_sample_returns_real_record_with_label(client):
    s = client.get("/api/transactions/sample", params={"label": "fraud"}).json()
    assert s["ground_truth"] == 1 and set(s["features"]) == set(FEATURES)


# ---- models -----------------------------------------------------------------------
def test_models_endpoints(client):
    m = client.get("/api/models").json()
    assert len(m["models"]) == 3 and sum(x["is_best"] for x in m["models"]) == 1
    comp = client.get("/api/models/comparison").json()
    assert len(comp["imbalance_experiments"]) == 9
    metrics = client.get("/api/models/metrics").json()
    assert "pr_curve" in metrics["models"]["xgboost"]["test"]
    ta = client.get("/api/models/xgboost/threshold-analysis", params={"threshold": 0.3}).json()
    assert ta["threshold"] == 0.3 and ta["flagged"] == ta["confusion_matrix"]["tp"] + ta["confusion_matrix"]["fp"]
    assert client.get("/api/models/nope/threshold-analysis").status_code == 422


# ---- synthetic ------------------------------------------------------------------------
def test_synthetic_generate_and_reset(client):
    r = client.post("/api/synthetic/generate", json={"count": 25, "seed": 5})
    assert r.status_code == 200
    b = r.json()
    assert b["count"] == 25 and "no ground-truth" in b["disclaimer"].lower()
    assert client.get("/api/synthetic/stats").json()["synthetic_transactions"] >= 25
    preview = client.post("/api/synthetic/generate", json={"count": 10, "persist": False}).json()
    assert preview["persisted"] is False and all(i["id"] is None for i in preview["items"])
    assert client.post("/api/synthetic/generate", json={"count": 5000}).status_code == 422
    kaggle_before = client.get("/api/transactions", params={"source": "kaggle"}).json()["total"]
    d = client.delete("/api/synthetic").json()
    assert d["deleted_transactions"] >= 25
    assert client.get("/api/synthetic/stats").json()["synthetic_transactions"] == 0
    assert client.get("/api/transactions", params={"source": "kaggle"}).json()["total"] == kaggle_before


# ---- alerts ---------------------------------------------------------------------------
def test_alert_status_update_persists(client):
    client.post("/api/synthetic/generate", json={"count": 60, "fraud_profile_ratio": 1.0, "seed": 11})
    alerts = client.get("/api/alerts", params={"page_size": 5}).json()
    assert alerts["total"] > 0
    aid = alerts["items"][0]["id"]
    r = client.patch(f"/api/alerts/{aid}", json={"status": "confirmed", "analyst_note": "verified by analyst"})
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    again = client.get(f"/api/alerts/{aid}").json()
    assert again["status"] == "confirmed" and again["analyst_note"] == "verified by analyst"
    # analyst decision must not overwrite ground truth
    assert again["transaction"]["ground_truth"] in (None, 0, 1)
    assert client.get("/api/alerts", params={"status": "confirmed"}).json()["total"] >= 1


def test_alert_update_validation(client):
    aid = client.get("/api/alerts").json()["items"][0]["id"]
    assert client.patch(f"/api/alerts/{aid}", json={"status": "closed"}).status_code == 422
    assert client.patch(f"/api/alerts/{aid}", json={}).status_code == 422
    assert client.patch("/api/alerts/999999", json={"status": "dismissed"}).status_code == 404


# ---- explain / analytics / settings / reports -----------------------------------------
def test_explain_transaction_and_global(client):
    tx_id = client.get("/api/transactions", params={"page_size": 1}).json()["items"][0]["id"]
    e = client.get(f"/api/explain/{tx_id}", params={"model": "logistic_regression"}).json()
    assert len(e["contributions"]) == 30
    assert "anonymised" in e["anonymised_feature_note"].lower()
    g = client.get("/api/explain/global", params={"model": "random_forest"}).json()
    assert len(g["features"]) == 30
    assert client.get("/api/explain/999999").status_code == 404


def test_analytics_trends(client):
    t = client.get("/api/analytics/trends", params={"granularity": "hour"}).json()
    assert t["empty"] is False and len(t["hourly_activity"]) == 24 and len(t["daily_pattern"]) == 7


def test_settings_and_risk_bands(client):
    assert client.put("/api/settings", json={"risk_bands": {"medium": 0.7, "high": 0.5, "critical": 0.9}}).status_code == 422
    s = client.put("/api/settings", json={"active_model": "random_forest"}).json()
    assert s["active_model"] == "random_forest"
    client.put("/api/settings", json={"risk_bands": {"medium": 0.3, "high": 0.6, "critical": 0.9}})
    assert client.post("/api/risk/assess", json={"probability": 0.65}).json()["level"] == "high"
    assert client.post("/api/risk/reclassify").status_code == 200
    client.put("/api/settings", json={"risk_bands": {"medium": 0.25, "high": 0.5, "critical": 0.8}, "active_model": "xgboost"})


def test_reports(client):
    r = client.get("/api/reports/transactions.csv", params={"include_features": True})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    header = r.text.splitlines()[0].split(",")
    assert "fraud_probability" in header and "V28" in header
    md = client.get("/api/reports/evaluation", params={"format": "md"})
    assert "TRANZIQ - Model Evaluation Report" in md.text
    assert client.get("/api/reports/evaluation", params={"format": "csv"}).status_code == 200
    assert client.get("/api/reports/alerts.csv").status_code == 200
    assert client.get("/api/monitoring").json()["database"]["transactions"] > 0
