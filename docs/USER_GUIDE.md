# TRANZIQ: User Guide

*Intelligence Behind Every Transaction.*

This guide walks through every screen. Setup is in the [README](../README.md#15-installation-windows).
Once `run_project.bat` is running, open <http://localhost:5173>.

## Before you start: four ideas to know

| Term | Meaning |
|---|---|
| **Fraud probability** | The model's estimate (0–100%) that a transaction is fraudulent |
| **Decision threshold** | The cut-off above which a transaction is *predicted fraud*. Chosen per model on validation data. |
| **Risk level** | Low / Medium / High / Critical: probability bands that set how urgently to act |
| **Ground truth** | The real label. Only real Kaggle rows have one. Synthetic and user rows don't. |

Source tags appear everywhere: `REAL` = Kaggle record (held-out test data), `SYNTH` = generated demo
record, `USER` = something you entered or uploaded.

## Navigation

The **left rail** lists the ten areas, numbered 01–10. At the bottom:
- **Active model**: choose which model drives dashboards and new alerts (`best` marks the winner from training).
- **API status** dot and the **theme toggle** (☀/☾). Your theme choice is remembered.

The **live feed** across the top shows the most recently stored transactions with their fraud
probability (▲ = flagged). Hover to pause it. When new alerts appear, a **floating notification** pops up
in the bottom-right corner. Click it to open the Alert Center.

On phones and tablets, open the menu with the ☰ button.

---

## 01 · Command Center
Your overview. The **risk-distribution core** (concentric rings, log-scaled so rare levels stay visible)
shows how stored transactions spread across risk levels, with the predicted fraud rate in the centre.
The **ledger** lists totals. Below it you'll find the 24-hour **activity timeline**, the latest
**alerts**, a live **monitoring stream** and the active model's **test-set performance**. The "live
check" box compares predictions with known labels on the stored Kaggle records.

## 02 · Fraud Scanner
**Single transaction**
1. Click **Real fraud sample** or **Real legit sample** to load a genuine held-out Kaggle record (its
   known label is shown), or type all 30 values yourself.
2. Choose a **model** and optionally drag the **threshold** (click *reset* to return to the recommended value).
3. Leave **Save as a user transaction** on if you want it stored (it can raise an alert).
4. Press **Run fraud scan**. You get a risk gauge, a verdict, a plain-English explanation and the top
   **SHAP** reasons. For loaded samples TRANZIQ also tells you whether the model was right.

Invalid fields are outlined in red and the scan won't run until they're fixed.

**Batch CSV**: click **Template** to download a correctly formatted file (it contains real test rows),
then drop your CSV, choose model/threshold and press **Run batch prediction**. Invalid rows are
skipped and listed by line number. **Export** saves the results.

## 03 · Model Lab
- **Ranking cards**: the three models ordered by validation PR-AUC, with test metrics. *Make active* switches the active model.
- **Metric bars**: compare Precision, Recall, F1 and PR-AUC at the tuned threshold or at 0.50.
- **PR and ROC curves**, **score separation** histogram, **confusion matrices**.
- **Threshold laboratory**: drag the slider (or click 0.2 … 0.6) to see how precision, recall, missed
  fraud and false alarms change on the 56,746-row test split.
- **Imbalance experiment**: none vs class weighting vs SMOTE for every model. The row marked
  *selected* was kept.

## 04 · Explorer
Search by ID, customer, merchant or place, and filter by source, model, risk level, prediction, known
label, amount, probability range and dates. Click a column heading to sort. Click a row to open the
**detail panel**: metadata, every model's prediction, alerts, the 30 input features, **Re-score**, and
**Explain this prediction**. **Export CSV** downloads the current filter.

## 05 · Risk Engine
- **Band editor**: drag the starting points of Medium, High and Critical, then **Save bands**. The black
  marker shows the active model's decision threshold.
- **Re-apply to stored data** updates the risk level of every stored prediction under the new bands.
- **Simulator**: slide a probability to see how it would be classified and why.
- **Decision thresholds**: override per model (leave empty to use the recommended value).

## 06 · XAI Studio
Choose a model at the top.
- **Global importance**: which features matter most on average. Toggle **SHAP plot** to see the
  official SHAP summary image.
- **Beeswarm**: each dot is one transaction. Left of zero pushes towards *legitimate*, right pushes
  towards *fraud*. Colour shows the feature's value (cyan = low, coral = high).
- **Individual prediction**: pick a high-risk transaction or type its ID to get a **waterfall**
  running from the base value through each contribution to the final output.

> V1–V28 are anonymised. TRANZIQ tells you *which* component mattered, never what it "means".

## 07 · Generator
Pick a volume (10–1,000), the **fraud-pattern seed share**, **noise** and **date spread**, optionally a
**seed** for repeatable batches, then **Generate & score**. Results show predictions and risk levels.
**Save batch CSV** exports them. **Reset synthetic data** (with confirmation) removes every synthetic
record; real data stays.

## 08 · Alert Center
Status tiles at the top filter the queue. Pick an alert to investigate: check the risk gauge and
details, set **Pending / Investigating / Confirmed / Dismissed**, and add an **analyst note**. Changes are
saved immediately in SQLite. *Confirmed* is your judgement, not a verified label. **Export alerts**
downloads the log.

## 09 · Trends
Switch daily/hourly, filter by source or model. Charts cover volume by source, flagged trend, the
probability distribution, amount analysis, the 24-hour radar and weekday patterns, plus a
**real-vs-synthetic** comparison. Under **Dataset anatomy** you'll find EDA of the real Kaggle file:
class balance, amount and time distributions, the strongest correlations with fraud, and an
interactive **correlation heatmap** (hover a cell).

## 10 · Reports
Health checks, model versions and prediction activity, dataset facts, and downloads:
- **Transaction export (CSV)**: choose model/source, optionally include the 30 features.
- **Model evaluation report**: Markdown, CSV or JSON.
- **Alert log (CSV)**.
- **Reload models** after you re-train, without restarting the API.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red banner "Cannot reach the TRANZIQ API" | Start the backend (`run_project.bat`, or `uvicorn app.main:app --port 8000` inside `backend/`) |
| Amber banner "Models are not trained" | `python backend\scripts\train_models.py`, then restart the API |
| `Dataset not found` during training | `python backend\scripts\download_dataset.py`, or place `creditcard.csv` in `data\raw\` |
| PowerShell refuses to activate the venv | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt |
| Port 8000 / 5173 already in use | Close the old TRANZIQ windows, or change `--port` / `vite.config.ts` |
| Start over with a fresh demo database | Stop the API, delete `data\tranziq.db`, start again (it re-seeds automatically) |
