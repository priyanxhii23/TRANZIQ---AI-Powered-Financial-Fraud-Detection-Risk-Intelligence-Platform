@echo off
REM ============================================================
REM  TRANZIQ - one-time setup for Windows
REM  1. Python virtual environment + dependencies
REM  2. Frontend npm packages
REM  3. Kaggle dataset download
REM  4. Model training (about 3-10 minutes)
REM ============================================================
setlocal
cd /d "%~dp0"
title TRANZIQ setup

where python >nul 2>nul || (echo [TRANZIQ] Python not found. Install Python 3.11+ from python.org and tick "Add to PATH". & pause & exit /b 1)
where npm >nul 2>nul || (echo [TRANZIQ] Node.js/npm not found. Install Node.js 18+ from nodejs.org. & pause & exit /b 1)

if not exist ".venv\Scripts\python.exe" (
  echo [TRANZIQ] Creating virtual environment .venv ...
  python -m venv .venv || (echo Failed to create venv & pause & exit /b 1)
)
call ".venv\Scripts\activate.bat"

echo [TRANZIQ] Installing Python packages ...
python -m pip install --upgrade pip
pip install -r requirements.txt || (echo pip install failed & pause & exit /b 1)

if not exist ".env" copy ".env.example" ".env" >nul

echo [TRANZIQ] Installing frontend packages ...
pushd frontend
call npm install || (popd & echo npm install failed & pause & exit /b 1)
popd

echo [TRANZIQ] Getting the Kaggle dataset ...
python backend\scripts\download_dataset.py || (echo Dataset download failed - see data\raw\README.md & pause & exit /b 1)

echo [TRANZIQ] Training models (this takes a few minutes) ...
python backend\scripts\train_models.py || (echo Training failed & pause & exit /b 1)

echo.
echo [TRANZIQ] Setup complete. Start the platform with:  run_project.bat
pause
