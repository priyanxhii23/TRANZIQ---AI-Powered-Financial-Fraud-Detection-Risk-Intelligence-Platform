@echo off
REM ============================================================
REM  TRANZIQ - start backend (FastAPI :8000) + frontend (Vite :5173)
REM  Each service runs in its own window; close the windows to stop.
REM ============================================================
setlocal
cd /d "%~dp0"
title TRANZIQ launcher

if not exist ".venv\Scripts\activate.bat" (
  echo [TRANZIQ] Virtual environment missing. Run setup_project.bat first.
  pause & exit /b 1
)
if not exist "frontend\node_modules" (
  echo [TRANZIQ] Frontend packages missing. Run setup_project.bat first.
  pause & exit /b 1
)
if not exist "artifacts\models\xgboost.joblib" (
  echo [TRANZIQ] WARNING: models are not trained yet. The UI will show a notice.
  echo           Train with:  .venv\Scripts\python backend\scripts\train_models.py
)

echo [TRANZIQ] Starting API on http://localhost:8000  (docs: /docs)
start "TRANZIQ API" cmd /k "call .venv\Scripts\activate.bat && cd backend && uvicorn app.main:app --reload --port 8000"

echo [TRANZIQ] Starting web app on http://localhost:5173
start "TRANZIQ Web" cmd /k "cd frontend && npm run dev"

timeout /t 6 /nobreak >nul
start "" http://localhost:5173
echo [TRANZIQ] Both services are running in their own windows. Close them to stop.
