# TRANZIQ: Development Progress

_Last updated: 2026-11-11_

## Status: ✅ Feature-complete v1.0

| Phase | Status | Notes |
|---|---|---|
| 1. Planning & structure | ✅ | Monorepo: `backend/ml`, `backend/app`, `frontend`, `docs` |
| 2. Dataset & ML | ✅ | Real Kaggle data (284,807 rows); 9 experiments; models trained and evaluated; SHAP; EDA |
| 3. Backend | ✅ | FastAPI, SQLite (5 tables), service layer, 35+ endpoints |
| 4. Frontend | ✅ | 10 feature pages, brand identity, dark/light, Framer Motion, responsive |
| 5. Integration | ✅ | Vite proxy → API; all pages verified in Chromium with zero console errors |
| 6. Testing | ✅ | 67 pytest tests passing; scripted browser walkthrough of the main workflows |
| 7. Delivery | ✅ | README, 4 docs, `.bat` scripts, VS Code tasks, backup script, .gitignore |

## Completed components
- **ML** (`backend/ml`): loader + validation + cleaning, stratified 60/20/20 split, leak-free pipelines,
  none / class_weight / SMOTE, LR / RF / XGBoost, F1-optimal validation thresholds, validation-based
  ranking, test evaluation, global SHAP + summary plots, EDA JSON + PNGs, synthetic engine.
- **API** (`backend/app`): health, dataset, settings, risk, monitoring, dashboard, analytics,
  transactions, predict (single / batch / CSV upload), models, synthetic, alerts, explain, reports.
- **UI** (`frontend/src/pages`): CommandCenter, Scanner, ModelLab, Explorer, RiskEngine, Explain,
  Synthetic, Alerts, Analytics, Reports, NotFound, plus loading screen, ticker and toast alerts.

## Verified results (seed 42, full dataset)
XGBoost (best): test PR-AUC 0.834, precision 0.986, recall 0.726, F1 0.836 (threshold 0.55).
Random Forest: 0.794 / 0.880 / 0.768 / 0.820. Logistic Regression: 0.691 / 0.833 / 0.737 / 0.782.
Retraining reproduced these numbers exactly.

## Known limitations / caveats
- The Windows `.bat` scripts were written for Windows but developed and tested on Linux; the commands
  they call (venv, pip, npm, uvicorn) were all verified. Run `setup_project.bat` on Windows to confirm.
- Kaggle records get *replay* timestamps (seed date + `Time` offset).
- The demo DB is fraud-enriched (all test frauds + 4,000 legit), so dashboard rates exceed 0.17%.
- Single-user, no authentication (local demo).
- Recharts bundle is ~450 kB (split into its own cached chunk).

## Known bugs
None open. Fixed during development: non-finite ROC threshold broke JSON; artifact path crash with a
custom artifacts dir; mobile horizontal overflow (grid `min-width`); gauge needle overlapping the label.

## Next steps (optional enhancements)
1. Hyper-parameter search (Optuna) + probability calibration.
2. Cost-based threshold objective selectable in the UI.
3. Drift monitoring (PSI) on incoming transactions.
4. Docker / deployment, authentication.
5. Frontend unit tests (Vitest + Testing Library).

## How to resume in a new session
1. `setup_project.bat` (or follow README §15), then `run_project.bat`.
2. Backend tests: run `..\.venv\Scripts\python -m pytest` from `backend/`. Frontend type-check: run
   `npm run typecheck` from `frontend/`.
3. Read `docs/ARCHITECTURE.md` for where things live.
