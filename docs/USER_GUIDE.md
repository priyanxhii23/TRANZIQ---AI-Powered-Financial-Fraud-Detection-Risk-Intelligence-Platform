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

Records without a verified label (simulated or user-submitted) show **N/A** as their known label. The record's
origin is kept for auditing and shown in small type in the Explorer detail panel.

## The welcome story

The first time you open TRANZIQ in a browser session, **The Journey of a Transaction** plays:

1. **Everyday banking**: a customer withdraws cash at an ATM.
2. **Transactions begin**: café, boutique, online order, a flight abroad. The account ledger updates.
3. **The unexpected problem**: at 03:14 an unknown device makes a €2,450 payment. *Click the coral transaction.*
4. **TRANZIQ intervenes**: every payment flows into the engine
   (Transaction → ML analysis → Risk detection → Fraud alert → Analyst review) and the unusual one is held.
5. **Welcome to TRANZIQ**: hover the signals in the *intelligence orbit* (real stored transactions) and click the warm
   ones to find all the suspicious signals. That's optional; press **ENTER TRANZIQ** any time.

Controls: **Pause/Play**, **Next**, the progress bars, ← / → keys, **Skip story** or Esc. If your system asks for reduced
motion, you go straight to the welcome screen. Replay it later with **Replay intro** in the page footer.

## Navigation

The **left rail** lists the ten areas, numbered 01–10. At the bottom:
- **Active model**: choose which model drives dashboards and new alerts (`best` marks the winner from training).
- **API status** dot and the **theme switch**: dark *Flashlight / Aubergine / Sandy Brown* or light *Italian Roast /
  Dried Plum / Parchment*. The page changes with a circular reveal, and your choice is remembered.

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
The model needs **all 30 features** (Time, V1–V28, Amount). Amount and Time alone are not enough for a valid
prediction, so the scanner always works from a complete feature vector.

**Quick scan** (default)
1. **Start from a historical transaction**: *Fraud sample*, *Legitimate sample*, *Random sample*, or pick one from the
   list. A badge shows whether it is a fraud-labelled or legitimate-labelled historical record.
2. **Transaction details**: change the **Amount** or **Transaction time** if you like. The 28 anonymised components
   stay attached. If you edit them, the badge warns that the record's known label no longer applies. *Transaction type*
   is saved with the record but is **not** a model input.
3. **Model & threshold**: choose a model and, optionally, a custom threshold.
4. Press **SCAN TRANSACTION**. The button stays locked until a complete vector is loaded.

Every **(i)** icon explains its field.

**Advanced features**: all 30 inputs, with V1–V28 in a collapsible panel; *Fill from an example transaction*, a
**Template** and a **Sample file** download, and validation of every field.

**Result**: animated risk gauge, predicted class, fraud probability, risk category, model, decision threshold, a plain
explanation, the recommended next action and the strongest SHAP reasons. For an unedited sample it also says whether
the model was right.

**Batch CSV**: download the **Template** or **Sample file**, drop your CSV, choose model/threshold and press **Run batch
prediction**. Invalid rows are listed by line; **Download predictions** saves the results.

## 03 · Model Lab
Every important chart has a **"What this chart tells you"** panel underneath. The text is generated from the stored
results: which model leads each metric, how well the classes separate, how errors move with the threshold, and what
the imbalance experiment actually found.

- **Ranking cards**: the three models ordered by validation PR-AUC, with test metrics. *Make active* switches the active model.
- **Metric bars**: compare Precision, Recall, F1 and PR-AUC at the tuned threshold or at 0.50.
- **PR and ROC curves**, **score separation** histogram, **confusion matrices**.
- **Threshold laboratory**: drag the slider (or click 0.2 … 0.6) to see how precision, recall, missed
  fraud and false alarms change on the 56,746-row test split.
- **Imbalance experiment**: none vs class weighting vs SMOTE for every model. The row marked
  *selected* was kept.

## 04 · Explorer
One unified list of every stored transaction. Search by ID, customer, merchant or place, and filter by model, risk level,
prediction, known label, amount, probability range and dates. Click a column heading to sort. Click a row to open the
**detail panel** (metadata, every model's prediction, alerts, the 30 inputs, **Re-score**, **Explain this
prediction**). **Export CSV** downloads the current filter.

## 05 · Risk Decision Center
Two different questions:
- **Risk band**: *how high* is the estimated fraud probability? It sets urgency (Low / Medium / High / Critical).
- **Decision threshold**: *does* the model classify the transaction as fraud? It is chosen per model on validation data.

A transaction can be **High risk yet predicted legitimate** when its probability is below the model's threshold. The
*Two different questions* panel shows both on one scale and explains the current case in a sentence.

- **Simulator**: drag a probability; see the gauge, band, threshold, predicted class and recommended analyst action.
- **Risk cards**: click one to open the Explorer filtered to that band.
- **Band editor**: sliders or numbers for where Medium, High and Critical start, plus **Revert** and **Save bands**.
- **Re-apply to stored data**: after a confirmation, saves the bands and re-classifies *every* stored prediction in the
  database. The dashboard, alert counts and cards refresh, and a summary shows the before/after distribution.
- **Decision thresholds**: override per model (leave empty for the recommended value).

Recommendations are decision support, never automatic approvals or rejections.

## 06 · XAI Studio
Choose a model at the top.
- **Global importance**: which features matter most on average. **SHAP plot** shows the official summary image.
- **Beeswarm**: each dot is one transaction. Right of zero pushes towards fraud, left towards legitimate; colour is the
  feature's value (low → high).
- **Choose a transaction**: the list fills itself (*Highest risk*, *Latest flagged*, *Recent*), with search and an
  optional ID lookup. The top transaction is selected automatically. The **waterfall** shows the path from the base
  value through each contribution to the final output.

V1–V28 are anonymised: TRANZIQ tells you *which* component mattered, never what it means (hover the (i)).

## 07 · Scenario Lab
Stress-test the models with simulated transactions:
**Unusual spending**, **Rapid activity**, **Fraud-like patterns**, **Legitimate patterns** or a **Custom** scenario.
Set the volume, perturbation intensity, amount, time interval, base record, model and seed, then **Run scenario**.

- The result shows the count, average and highest probability, predicted fraud, low-risk count, a scatter of every
  transaction, the risk distribution and how the scores moved from the unperturbed base.
- **Threshold experiment**: drag the slider and watch predictions change for the same scenario.
- **Compare scenarios**: select up to three runs, or press *Compare legitimate vs fraud-like patterns*.
- **Save to the transaction database** stores the run as simulated records (no labels). **Reset simulated data**
  removes them; historical data is untouched.

Scenario records are never used to train or evaluate the models.

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
**DOWNLOAD PDF REPORT** generates a branded 5-page A4 report: executive summary, model performance (validation and
test), evaluation charts, imbalance and methodology, risk analysis and conclusion. Also here: health checks, model
versions and prediction activity, dataset facts, and these downloads:
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
