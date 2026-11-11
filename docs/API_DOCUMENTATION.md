# TRANZIQ: API Documentation

Base URL: `http://localhost:8000`. Every endpoint is under `/api`.
Interactive documentation (try requests in the browser): **<http://localhost:8000/docs>**.

**Conventions**
- JSON in, JSON out (except CSV/Markdown downloads and the multipart CSV upload).
- `model` is one of `logistic_regression`, `random_forest`, `xgboost`. If you leave it out, the
  **active model** (Settings) is used.
- Timestamps are UTC ISO-8601 without an offset.

**Status codes**

| Code | Meaning |
|---|---|
| 200 | OK |
| 404 | Resource (transaction/alert) not found |
| 409 | Conflict (e.g. activating a model that isn't trained) |
| 413 | Uploaded file too large |
| 415 | Upload isn't a `.csv` |
| 422 | Validation error. `detail` says which field and why. |
| 503 | Models not trained yet. Run `python backend/scripts/train_models.py`. |

Example 422:
```json
{"detail":[{"type":"literal_error","loc":["body","status"],
  "msg":"Input should be 'pending', 'investigating', 'confirmed' or 'dismissed'","input":"bogus"}]}
```

---

## System

### `GET /api/health`
Liveness and readiness.
```json
{"status":"ok","app":"TRANZIQ","version":"1.0.0","uptime_seconds":12.3,
 "checks":{"database":true,"models_trained":true,
           "models_loaded":["logistic_regression","random_forest","xgboost"],"dataset_present":true},
 "message":null}
```
`status` is `"degraded"` when models are missing; `message` then explains how to fix it.

### `GET /api/dataset/info` · `GET /api/dataset/eda`
Real dataset statistics (rows, cleaning report, class distribution, splits) and full EDA data
(histograms, feature comparison, correlation matrix). `eda` returns 404 before training.

### `GET /api/settings` · `PUT /api/settings`
```json
PUT {"active_model":"random_forest",
     "risk_bands":{"medium":0.25,"high":0.5,"critical":0.8},
     "threshold_overrides":{"xgboost":0.4,"random_forest":null}}
```
All fields are optional. Bands must satisfy `0 < medium < high < critical < 1` (else 422). `null`
restores the validation-recommended threshold.

### `GET /api/risk/levels` · `POST /api/risk/assess` · `POST /api/risk/reclassify`
- `levels`: the four bands, their ranges, recommended actions and the current count per level.
- `assess` `{"probability":0.42}` returns the level, range and plain-English explanation.
- `reclassify` re-applies the saved bands to every stored prediction and returns `{"updated_predictions": n}`.

### `GET /api/monitoring`
Active model, last training run, per-model version / prediction count / last prediction time / flagged
count, and DB row counts.

---

## Command Center & analytics

### `GET /api/dashboard/summary?model=`
Totals, predicted fraud/legit, fraud prediction rate, average and flagged amount, high-risk count, risk
distribution, sources, last-24h series, recent alerts, latest transactions, alert counts, and a live
precision/recall check on stored Kaggle rows that have known labels.

### `GET /api/analytics/trends?model=&source=&granularity=day|hour`
`timeline`, `probability_distribution`, `amount_analysis`, `hourly_activity` (24 rows),
`daily_pattern` (7 rows), `source_comparison`.

---

## Transactions

### `GET /api/transactions`
| Query | Type | Notes |
|---|---|---|
| `q` | string | Search external id, customer, merchant, city, country |
| `source` | `kaggle` \| `synthetic` \| `user` | Real vs synthetic filter |
| `model` | model name | Which model's latest prediction to join/filter on |
| `min_amount`, `max_amount` | float | |
| `min_prob`, `max_prob` | 0–1 | Fraud probability range |
| `risk_level` | `low`…`critical` | |
| `predicted_label`, `ground_truth` | 0/1 | |
| `date_from`, `date_to` | ISO datetime | |
| `sort_by` | `event_time` \| `amount` \| `probability` \| `id` \| `external_id` | |
| `sort_dir` | `asc` \| `desc` | |
| `page`, `page_size` | int | `page_size` ≤ 200 |

Response: `{"total", "page", "page_size", "pages", "items":[{...transaction, "prediction":{...}}], "model"}`.

### `GET /api/transactions/{id}`
Full record: metadata, the 30 `features`, the latest prediction from **each** model, and alerts.

### `GET /api/transactions/sample?label=fraud|legitimate|any`
A random **real** Kaggle test record with its known label (used by the Scanner).

### `GET /api/transactions/bounds` · `POST /api/transactions/{id}/rescore`
Filter bounds; re-score an existing transaction with all models (adds prediction rows, no new alerts).

---

## Prediction (Fraud Scanner)

### `POST /api/predict`
```json
{
  "features": {"Time": 52934, "V1": 1.0366, "V2": 0.4072, "...": 0, "V28": 0.03, "Amount": 1.0},
  "model": "xgboost",          // optional
  "threshold": 0.4,            // optional, 0.01-0.99
  "persist": true,             // store as a 'user' transaction (default true)
  "explain": true,             // include SHAP (default true)
  "metadata": {"merchant": "Example", "city": "Leeds"}   // optional, NOT used by the model
}
```
All 30 features are required, must be finite, and `Amount`/`Time` must be ≥ 0. Unknown keys are rejected.

Real response (a fraud-labelled Kaggle test record, abbreviated):
```json
{
  "model": "xgboost", "model_version": "20261111.1007-none",
  "probability": 0.9902, "threshold": 0.55, "predicted_label": 1, "prediction": "fraud",
  "risk": {"level": "critical", "label": "Critical Risk", "range": [0.8, 1.0],
           "recommended_action": "Prioritise immediately - consider holding the transaction pending review.",
           "explanation": "The model estimates a 99.0% fraud probability. That falls in the Critical Risk band (0.80 - 1.00). The model's decision threshold is 0.55, so the transaction is FLAGGED as predicted fraud."},
  "transaction_id": null,
  "explanation": {"base_value": -6.2289, "output_units": "log-odds", "model_output": 4.6136,
    "contributions": [
      {"feature": "V14", "value": -3.988, "shap_value": 3.948, "direction": "towards_fraud",
       "note": "Anonymised principal component published by the dataset authors. Its real-world meaning is confidential and is not interpreted by TRANZIQ."}
    ]}
}
```

### `POST /api/predict/batch`
`{"transactions":[{...30 features...}, ...], "model":"random_forest", "threshold":null, "persist":false}`
(1–5,000 rows). Returns `summary` (counts, mean probability, risk levels) and per-row `results`.

### `POST /api/predict/upload` (multipart/form-data)
| Field | Notes |
|---|---|
| `file` | `.csv` with columns `Time, V1..V28, Amount` (extra columns like `Class` are ignored) |
| `model`, `threshold`, `persist` | optional form fields |

Rows with invalid values are skipped and reported in `validation.errors` as `{"row": <line number>, "error": "..."}`.
The whole file is rejected (422) if columns are missing, it's empty, or it has more than 5,000 rows.

---

## Models (Model Lab)

| Endpoint | Returns |
|---|---|
| `GET /api/models` | Each model's version, strategy, thresholds, hyper-parameters, test summary, `is_active`, `is_best` |
| `GET /api/models/metrics` | Full test evaluation: curves, threshold tables, confusion matrices, probability histogram |
| `GET /api/models/comparison` | Ranking, selection criterion, all 9 imbalance experiments |
| `GET /api/models/{name}` | One model in detail |
| `GET /api/models/{name}/threshold-analysis?threshold=0.3` | Precision/recall/F1/confusion matrix for **any** threshold on the held-out test split |
| `POST /api/models/reload` | Reload artifacts from disk after re-training |

---

## Synthetic data

### `POST /api/synthetic/generate`
```json
{"count": 100, "fraud_profile_ratio": 0.05, "noise_level": 0.15, "days_back": 14, "seed": null, "persist": true}
```
`count` 1–1,000. Returns a `disclaimer`, counts, risk levels and every generated item with its
prediction. With `persist:false` nothing is stored (preview).

### `GET /api/synthetic/stats` · `DELETE /api/synthetic`
Count of stored synthetic rows; **reset** deletes all synthetic transactions plus their predictions
and alerts. Real and user data are untouched.

---

## Alerts

### `GET /api/alerts?status=&severity=&source=&sort=newest|severity|updated&page=&page_size=`
### `GET /api/alerts/summary` · `GET /api/alerts/{id}`
### `PATCH /api/alerts/{id}`
```json
{"status": "investigating", "analyst_note": "Called cardholder, awaiting reply."}
```
`status` ∈ `pending | investigating | confirmed | dismissed`. You must send at least one field. This
records an **analyst decision**; it doesn't change ground truth or retrain anything.

---

## Explainability

| Endpoint | Returns |
|---|---|
| `GET /api/explain/{transaction_id}?model=` | SHAP contributions for all 30 features, base value, output, probability, risk |
| `POST /api/explain` | Same, for a raw feature vector (body as `/api/predict`) |
| `GET /api/explain/global?model=` | Mean \|SHAP\| per feature, beeswarm sample points, URL of the official SHAP summary PNG |

---

## Reports

| Endpoint | Output |
|---|---|
| `GET /api/reports/transactions.csv?model=&source=&risk_level=&predicted_label=&q=&min_prob=&include_features=` | Streamed CSV with metadata, label, model, probability, threshold, prediction and risk (+ optional 30 features) |
| `GET /api/reports/alerts.csv` | All alerts with status and notes |
| `GET /api/reports/evaluation?format=md\|csv\|json` | Evaluation report built from the real training results |
| `GET /static/plots/{file}.png` | EDA and SHAP figures written during training |
