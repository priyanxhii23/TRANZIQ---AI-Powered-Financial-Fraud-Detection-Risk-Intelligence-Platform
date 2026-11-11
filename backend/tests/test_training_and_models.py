import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

from ml import config


def test_training_writes_all_artifacts(trained):
    for n in config.MODEL_NAMES:
        assert (config.MODELS_DIR / f"{n}.joblib").exists()
    assert config.EXPERIMENTS_PATH.exists() and config.EDA_PATH.exists() and config.SHAP_GLOBAL_PATH.exists()
    # JSON must be strictly valid (no NaN / Infinity) for the API
    json.loads(config.EXPERIMENTS_PATH.read_text(), parse_constant=lambda c: pytest.fail(f"non-finite {c}"))


def test_all_strategies_evaluated(trained):
    combos = {(e["model"], e["strategy"]) for e in trained["experiments"]}
    assert combos == {(m, s) for m in config.MODEL_NAMES for s in config.IMBALANCE_STRATEGIES}


def test_best_model_comes_from_results_not_hardcoded(trained):
    val = {n: trained["models"][n]["validation"]["pr_auc"] for n in config.MODEL_NAMES}
    assert trained["best_model"] == max(val, key=val.get)
    assert trained["ranking"][0] == trained["best_model"]


def test_metrics_are_valid_probabilities(trained):
    for m in trained["models"].values():
        t = m["test"]
        for k in ("pr_auc", "roc_auc"):
            assert 0 <= t[k] <= 1
        for k in ("precision", "recall", "f1", "accuracy"):
            assert 0 <= t["at_recommended"][k] <= 1
        assert 0.01 <= m["recommended_threshold"] <= 0.99


def test_models_learn_signal_on_synthetic_test_data(trained):
    # The test dataset has a strong planted signal; every model should beat random ranking easily.
    for m in trained["models"].values():
        assert m["test"]["roc_auc"] > 0.9


def test_saved_model_loads_and_predicts(trained):
    bundle = joblib.load(config.MODELS_DIR / "xgboost.joblib")
    X = pd.DataFrame([{c: 0.0 for c in config.FEATURE_COLUMNS}])
    p = bundle["pipeline"].predict_proba(X)[:, 1]
    assert p.shape == (1,) and 0 <= p[0] <= 1
    assert bundle["feature_names"] == config.FEATURE_COLUMNS


REAL_MODELS = Path(__file__).resolve().parents[2] / "artifacts" / "models"


@pytest.mark.skipif(not (REAL_MODELS / "xgboost.joblib").exists(), reason="real models not trained yet")
@pytest.mark.parametrize("name", config.MODEL_NAMES)
def test_real_trained_models_load(name):
    """Checks the models produced by `python backend/scripts/train_models.py` on the Kaggle data."""
    bundle = joblib.load(REAL_MODELS / f"{name}.joblib")
    X = pd.DataFrame(np.zeros((3, 30)), columns=config.FEATURE_COLUMNS)
    p = bundle["pipeline"].predict_proba(X)[:, 1]
    assert np.all((p >= 0) & (p <= 1))
