# TRANZIQ: Development Progress

_Last updated: 2026-11-11 · Version 2.0_

## Status: ✅ V2 product redesign complete

### V1 (foundation): complete
ML pipeline on the real Kaggle data (3 models × 3 imbalance strategies, validation-based thresholds and selection,
SHAP), FastAPI + SQLite backend, React frontend with 10 features, docs, Windows scripts.

### V2 (product redesign): complete
| Phase | Status | Key files |
|---|---|---|
| 1. Welcome story | ✅ | `frontend/src/pages/Welcome.tsx`, `App.tsx` (once per session, "Replay intro" in footer) |
| 2. Scanner redesign | ✅ | `pages/Scanner.tsx` (Quick / Advanced / Batch), `GET /api/predict/template.csv` |
| 3. Model Lab interpretations | ✅ | `lib/insights.tsx`, `components/ui.tsx` (`Insight`) |
| 4. Unified Explorer | ✅ | `pages/Explorer.tsx` (source filter/column/badges removed; origin kept in the drawer) |
| 5. Risk Decision Center + re-apply fix | ✅ | `pages/RiskEngine.tsx`, `POST /api/risk/reapply` |
| 6. XAI improvements | ✅ | `pages/Explain.tsx` (banner removed, auto lists, auto-select) |
| 7. Fraud Scenario Lab | ✅ | `backend/ml/scenarios.py`, `app/api/scenarios_api.py`, `pages/ScenarioLab.tsx` |
| 8. PDF report | ✅ | `app/services/pdf_report.py`, `GET /api/reports/pdf`, Reports page button |
| 9. Themes + animation | ✅ | `styles/index.css` tokens, `components/Ambient.tsx`, `components/ThemeSwitch.tsx` |
| 10. Integration & testing | ✅ | 83 pytest tests; scripted browser walkthrough (see below) |

### Root cause of the old "Re-apply" bug
The button was `disabled={reapplying || dirty}`: as soon as the bands were edited (the normal flow) it could not be
clicked, and the endpoint only used the *previously saved* bands, ignored alert severities and updated rows one by one.
Fix: one endpoint validates → saves → bulk `UPDATE … CASE` → syncs alert severity; the UI asks for confirmation, then
refreshes the dashboard, alerts and risk cards and shows a before/after summary.

## Verification performed (V2)
- `pytest`: **83 passed** (16 new: re-apply incl. alert sync and validation, every scenario, scenario API/persistence,
  PDF with exactly 5 pages, CSV template round-trip).
- TypeScript strict type-check + production build: clean.
- Playwright (Chromium) walkthrough, all passing: rapid arrow keys through the story, skip/replay, enter;
  rapid navigation clicks; Quick Scan blocked until a sample, then scans an edited fraud sample; Advanced
  validation; save & re-apply bands; risk card → filtered Explorer (no source column); XAI auto-selects; Scenario
  comparison + threshold experiment; PDF download; Model Lab insights; theme persistence.
- All 10 pages, both themes: zero console errors. Phone width (390 px): no horizontal overflow on any page.
- Reduced motion: the welcome opens directly on the final screen; the ambient canvas renders one static frame.

## Known limitations
- `.bat` scripts and the app are developed on Linux; commands are cross-platform but Windows runs are user-verified.
- Scenario Lab shows the models react mainly to V-component patterns; amount or velocity changes barely move scores
  (documented as a finding, not hidden).
- Kaggle records use replay timestamps; the demo DB over-represents fraud; probabilities are not calibrated.
- Single-user, no authentication.
- The View-Transition circular theme reveal needs a Chromium-based browser; others get a smooth cross-fade.

## Bugs fixed during V2
Re-apply disabled while editing; `AnimatePresence mode="wait"` freezing fast-changing panels (orbit card, risk
sentence, results); SVG `r`/`cx` attribute animations logging errors on unmount (now transform/scale based);
nested `<button>` in the Advanced Scan header; ledger overlapping the story scene; Model Lab panels stretching when
an insight opened.

## Next steps (optional)
1. Frontend unit tests (Vitest + Testing Library) for `insights.tsx` and scanner validation.
2. Cost-based threshold objective selectable in the Risk Center.
3. Probability calibration; drift monitoring; authentication; Docker.

## How to resume in a new session
1. `.\setup_project.bat` (first time) then `.\run_project.bat` (in PowerShell use the `.\` prefix).
2. Backend tests: run `..\.venv\Scripts\python -m pytest` from `backend/`. Frontend: run `npm run typecheck` from `frontend/`.
3. Read `docs/ARCHITECTURE.md` for where things live.
