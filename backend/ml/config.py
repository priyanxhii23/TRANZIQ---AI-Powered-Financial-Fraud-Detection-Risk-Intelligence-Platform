"""Central configuration for the ML pipeline.

Keeping every path, seed and hyper-parameter in one place makes experiments
reproducible and easy to document.
"""
from __future__ import annotations

import os
from pathlib import Path

# Repository root = two levels above this file (backend/ml/config.py)
ROOT_DIR = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.getenv("TRANZIQ_DATA_DIR", ROOT_DIR / "data"))
RAW_DATA_PATH = Path(os.getenv("TRANZIQ_DATASET_PATH", DATA_DIR / "raw" / "creditcard.csv"))

ARTIFACTS_DIR = Path(os.getenv("TRANZIQ_ARTIFACTS_DIR", ROOT_DIR / "artifacts"))
MODELS_DIR = ARTIFACTS_DIR / "models"
REPORTS_DIR = ARTIFACTS_DIR / "reports"
PLOTS_DIR = ARTIFACTS_DIR / "plots"

# Files written by training and read by the API
EXPERIMENTS_PATH = REPORTS_DIR / "experiments.json"   # every experiment + final results
EDA_PATH = REPORTS_DIR / "eda.json"                   # dataset statistics for the UI
SHAP_GLOBAL_PATH = REPORTS_DIR / "shap_global.json"   # global feature importance
SPLITS_PATH = ARTIFACTS_DIR / "splits.joblib"         # test split (for DB seeding) + synthetic pool

DATASET_URL = "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud"
# Public mirror of the identical file used in the TensorFlow documentation.
DATASET_MIRROR_URL = "https://storage.googleapis.com/download.tensorflow.org/data/creditcard.csv"

# ---- Schema -----------------------------------------------------------------
V_FEATURES = [f"V{i}" for i in range(1, 29)]
FEATURE_COLUMNS = ["Time", *V_FEATURES, "Amount"]   # 30 model inputs, in this order
TARGET_COLUMN = "Class"
EXPECTED_COLUMNS = [*FEATURE_COLUMNS, TARGET_COLUMN]

# ---- Reproducibility --------------------------------------------------------
RANDOM_SEED = 42

# Split proportions: 60% train / 20% validation / 20% test (all stratified).
TEST_SIZE = 0.20
VALIDATION_SIZE = 0.20  # fraction of the *whole* dataset

# SMOTE: grow the minority class to 10% of the majority class (not 50/50).
# Full balancing creates ~170k synthetic points and tends to hurt precision.
SMOTE_SAMPLING_STRATEGY = 0.10
SMOTE_K_NEIGHBORS = 5

# Thresholds shown in the threshold comparison table (spec asks for 0.2-0.6).
COMPARISON_THRESHOLDS = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]

MODEL_NAMES = ["logistic_regression", "random_forest", "xgboost"]
MODEL_LABELS = {
    "logistic_regression": "Logistic Regression",
    "random_forest": "Random Forest",
    "xgboost": "XGBoost",
}
IMBALANCE_STRATEGIES = ["none", "class_weight", "smote"]

# Number of test rows used to compute global SHAP importance.
SHAP_SAMPLE_SIZE = int(os.getenv("TRANZIQ_SHAP_SAMPLE", "400"))


def ensure_dirs() -> None:
    for d in (MODELS_DIR, REPORTS_DIR, PLOTS_DIR):
        d.mkdir(parents=True, exist_ok=True)
