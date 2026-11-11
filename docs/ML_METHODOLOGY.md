# TRANZIQ: Machine-Learning Methodology

This document explains *what* the pipeline does, *why*, and how to read the results. Technical terms
are explained in plain language.

All results quoted here come from `artifacts/reports/experiments.json`, produced by
`python backend/scripts/train_models.py` (seed 42). Re-running training reproduces them exactly.

---

## 1. Data

| Step | Result |
|---|---|
| Rows loaded | 284,807 |
| Missing values | 0 |
| Invalid rows (negative amount/time, infinities) | 0 |
| Exact duplicate rows removed | 1,081 |
| Rows used | **283,726** |
| Fraud rows | **473 (0.167%)**, about 599 legitimate per fraud |

**Why remove duplicates?** If the same row were in both the training and the test set, the model would
be "tested" on something it already memorised, which inflates scores. That's a form of **data
leakage**: information leaking from the evaluation data into training.

**About V1–V28.** The bank transformed the original attributes with **PCA** (Principal Component
Analysis, a mathematical rotation that mixes the original columns into new, uncorrelated ones) and
published only the result. The original meanings are confidential, so TRANZIQ never claims that, say,
"V14 = location mismatch".

## 2. Splitting: train / validation / test

```
283,726 rows ──stratified──►  train 60% (170,235 · 284 fraud)
                              validation 20% (56,745 · 94 fraud)
                              test 20% (56,746 · 95 fraud)
```

- **Stratified** means each part keeps the same 0.167% fraud ratio.
- **Train**: models learn from this.
- **Validation**: used to *make choices*: imbalance strategy, decision threshold and best model.
- **Test**: used **once**, at the very end, to report performance. It never influences a choice, so the
  reported numbers are an honest estimate for unseen data.

## 3. Preprocessing pipeline

Each model is wrapped in an `imblearn.pipeline.Pipeline`:

```
ColumnTransformer ──► (SMOTE, training only) ──► classifier
  Time    → StandardScaler   (mean 0, std 1)
  V1..V28 → StandardScaler
  Amount  → RobustScaler     (median / IQR, robust to the huge outliers)
```

Because the scaler sits *inside* the pipeline, `fit` learns its statistics **only from training data**.
The test in `tests/test_preprocessing.py` checks this. imbalanced-learn pipelines apply samplers like
SMOTE **only during `fit`**. During `predict` the SMOTE step is skipped, so validation and test data are
never resampled (also covered by a test).

## 4. Handling class imbalance

| Strategy | Mechanism |
|---|---|
| `none` | Plain training |
| `class_weight` | Logistic Regression `class_weight="balanced"`; Random Forest `class_weight="balanced_subsample"`; XGBoost `scale_pos_weight = #legit / #fraud ≈ 599` |
| `smote` | **SMOTE** (*Synthetic Minority Over-sampling Technique*) creates new fraud examples by interpolating between a fraud row and one of its 5 nearest fraud neighbours. We grow fraud to **10%** of the legitimate count (`sampling_strategy=0.1`). A full 50/50 balance would create ~170k artificial points and usually hurts precision. |

### Results (validation split, PR-AUC)

| Model | none | class_weight | SMOTE | Selected |
|---|---|---|---|---|
| Logistic Regression | **0.8021** | 0.7806 | 0.7995 | none |
| Random Forest | **0.8774** | 0.8635 | 0.8758 | none |
| XGBoost | **0.8894** | 0.8820 | 0.8770 | none |

**Interpretation.** PR-AUC measures how well a model *ranks* fraud above legitimate transactions,
independent of any cut-off. Re-weighting and SMOTE mostly push probabilities upward. At the default 0.5
threshold that raises recall and lowers precision (Logistic Regression + class weighting: recall 0.90
but precision 0.05). They didn't improve the ranking itself here. Since TRANZIQ tunes the threshold
separately (next section), the unresampled versions won. This is a legitimate, commonly observed
outcome on this dataset, and the pipeline reports it instead of hard-coding SMOTE as the winner.

## 5. Models and hyper-parameters

| Model | Key settings | Why |
|---|---|---|
| **Logistic Regression** | `C=0.1` (L2), `lbfgs`, `max_iter=2000` | Simple, fast, interpretable linear baseline |
| **Random Forest** | 200 trees, `max_depth=14`, `min_samples_leaf=2`, `max_features="sqrt"` | Captures non-linear patterns; depth limit keeps it laptop-friendly |
| **XGBoost** | 400 trees, `learning_rate=0.05`, `max_depth=5`, `subsample=0.8`, `colsample_bytree=0.8`, `tree_method="hist"` | Gradient boosting: each tree fixes the previous trees' mistakes |

These are well-established, moderate settings rather than an exhaustive search. Hyper-parameter tuning
is listed under future work.

## 6. Threshold optimisation

A model outputs a **probability**. A **threshold** turns it into a decision: *flag if probability ≥
threshold*.

- Lower threshold → more fraud caught (higher **recall**) but more false alarms (lower **precision**).
- Higher threshold → fewer false alarms but more missed fraud.

**Objective (documented):** for each model, search thresholds 0.01–0.99 (step 0.01) on the
**validation** split and pick the one with the highest **F1-score** (ties → lowest threshold, which
favours recall).

| Model | Recommended threshold |
|---|---|
| Logistic Regression | 0.12 |
| Random Forest | 0.24 |
| XGBoost | 0.55 |

The Model Lab shows the full trade-off at 0.05…0.90 (including the requested 0.20/0.30/0.40/0.50/0.60)
and an interactive slider that evaluates **any** threshold on the test split. The Risk Engine lets you
override thresholds per model.

## 7. Model selection

**Criterion:** highest **validation** PR-AUC (ties broken by validation F1). This picked **XGBoost**.
The code computes it (`train.py → ranking`); a test asserts that the best model equals the arg-max.

## 8. Final test results (untouched test split, 95 fraud / 56,746)

| Model | PR-AUC | ROC-AUC | Precision | Recall | F1 | TP | FP | FN | TN |
|---|---|---|---|---|---|---|---|---|---|
| **XGBoost** (thr 0.55) | **0.8342** | 0.9754 | **0.9857** | 0.7263 | **0.8364** | 69 | 1 | 26 | 56,650 |
| Random Forest (thr 0.24) | 0.7937 | 0.9645 | 0.8795 | **0.7684** | 0.8202 | 73 | 10 | 22 | 56,641 |
| Logistic Regression (thr 0.12) | 0.6914 | 0.9533 | 0.8333 | 0.7368 | 0.7821 | 70 | 14 | 25 | 56,637 |

How to read the XGBoost row: of 70 transactions it flagged, 69 were real fraud (precision 98.6%). It
caught 69 of the 95 frauds (recall 72.6%) and missed 26.

Notes:
- Test PR-AUC is lower than validation PR-AUC (e.g. 0.834 vs 0.889). With only ~95 fraud cases per split,
  a handful of hard cases moves the score noticeably. This is normal variance, and it's exactly why
  choices are made on validation and reported on test.
- Accuracy is 99.9%+ for every model and says almost nothing. That's why it's never used for selection.

## 9. Explainability (SHAP)

**SHAP** (SHapley Additive exPlanations) answers: *how much did each feature push this prediction up or
down compared with an average transaction?*

```
base value  +  Σ feature contributions  =  model output
```

- Tree models use `TreeExplainer` (exact and fast). Logistic Regression uses `LinearExplainer` with 200
  training rows as background.
- Units: XGBoost & Logistic Regression explain **log-odds** (the logistic function turns log-odds into a
  probability). Random Forest explains **probability** directly.
- **Global importance** = mean |SHAP| over 400 test rows (80 fraud, 320 legitimate; fraud is enriched so
  its patterns are visible).
- For XGBoost the most influential components are **V14, V10, V4 and V12**. We report this, and say
  nothing about what those components mean.

## 10. Synthetic data

Synthetic records exist to demonstrate the monitoring workflow, never to train or evaluate models.

1. Pick a seed record from a pool of **training** rows (all training frauds + 20,000 legitimate).
   *Fraud-pattern seed share* sets how often a fraud-labelled seed is used.
2. Add Gaussian noise to V1–V28 (std = *noise level* × feature std) and a log-normal factor to Amount.
3. Derive `Time` from the generated timestamp (seconds into the day, +0/1 day), so it stays inside the
   0–172,800 s range the models saw.
4. Generate merchant, city/country, channel, device, customer ID and status **independently**. The
   models never see this metadata.

Synthetic records have **no ground-truth label**. `generation_profile` records only which kind of seed
was perturbed.

## 11. Reproducibility checklist

- Seed `42` for splits, SMOTE, models, SHAP sampling and pools.
- Pinned dependency versions in `requirements.txt`.
- All metrics, curves and settings saved to `experiments.json`. Downloadable as Markdown/CSV/JSON from
  the Reports page.
- `pytest` re-trains small models on a generated dataset to test the pipeline end to end.
