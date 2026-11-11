"""Loads trained model bundles and training reports from ``artifacts/``.

Models are loaded once (lazily) and cached in memory - the API never
retrains on start-up. If artifacts are missing, the registry reports that
clearly so the UI can tell the user to run the training script.
"""
from __future__ import annotations

import json
import threading
from functools import lru_cache

import joblib
import numpy as np
import pandas as pd

from ml import config
from ml.explain import explain_row, make_explainer


class ModelsNotTrainedError(RuntimeError):
    def __init__(self, detail: str = ""):
        super().__init__(
            "Trained models not found. Run:  python backend/scripts/train_models.py" + (f" ({detail})" if detail else "")
        )


class ModelRegistry:
    def __init__(self) -> None:
        self._bundles: dict[str, dict] = {}
        self._explainers: dict[str, object] = {}
        self._test_proba: dict[str, np.ndarray] = {}
        self._lock = threading.Lock()

    # ---- availability ---------------------------------------------------------
    @staticmethod
    def artifacts_present() -> bool:
        return config.EXPERIMENTS_PATH.exists() and all(
            (config.MODELS_DIR / f"{n}.joblib").exists() for n in config.MODEL_NAMES
        )

    def available_models(self) -> list[str]:
        return [n for n in config.MODEL_NAMES if (config.MODELS_DIR / f"{n}.joblib").exists()]

    def loaded_models(self) -> list[str]:
        return list(self._bundles)

    # ---- loading --------------------------------------------------------------
    def get(self, name: str) -> dict:
        if name not in config.MODEL_NAMES:
            raise KeyError(name)
        if name not in self._bundles:
            path = config.MODELS_DIR / f"{name}.joblib"
            if not path.exists():
                raise ModelsNotTrainedError(f"missing {path.name}")
            with self._lock:
                if name not in self._bundles:
                    self._bundles[name] = joblib.load(path)
        return self._bundles[name]

    def load_all(self) -> list[str]:
        return [self.get(n)["name"] for n in self.available_models()]

    def reload(self) -> None:
        self._bundles.clear(); self._explainers.clear(); self._test_proba.clear()
        _read_json.cache_clear()

    # ---- inference ------------------------------------------------------------
    def predict_proba(self, name: str, X: pd.DataFrame) -> np.ndarray:
        bundle = self.get(name)
        return bundle["pipeline"].predict_proba(X[config.FEATURE_COLUMNS].astype(float))[:, 1]

    def explainer(self, name: str):
        if name not in self._explainers:
            self._explainers[name] = make_explainer(self.get(name))
        return self._explainers[name]

    def explain(self, name: str, row: pd.DataFrame, top_k: int = 30) -> dict:
        return explain_row(self.get(name), self.explainer(name), row, top_k=top_k)

    # ---- held-out test data (for interactive threshold analysis) ----------------
    def test_split(self) -> dict:
        return _load_splits()

    def test_probabilities(self, name: str) -> tuple[np.ndarray, np.ndarray]:
        if name not in self._test_proba:
            s = self.test_split()
            self._test_proba[name] = self.predict_proba(name, s["X_test"])
        return self.test_split()["y_test"].to_numpy(), self._test_proba[name]

    # ---- reports --------------------------------------------------------------
    @staticmethod
    def experiments() -> dict:
        if not config.EXPERIMENTS_PATH.exists():
            raise ModelsNotTrainedError("missing experiments.json")
        return _read_json(str(config.EXPERIMENTS_PATH))

    @staticmethod
    def eda() -> dict | None:
        return _read_json(str(config.EDA_PATH)) if config.EDA_PATH.exists() else None

    @staticmethod
    def shap_global() -> dict | None:
        return _read_json(str(config.SHAP_GLOBAL_PATH)) if config.SHAP_GLOBAL_PATH.exists() else None


@lru_cache(maxsize=8)
def _read_json(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


_splits_cache: dict = {}


def _load_splits() -> dict:
    if "data" not in _splits_cache:
        if not config.SPLITS_PATH.exists():
            raise ModelsNotTrainedError("missing splits.joblib")
        _splits_cache["data"] = joblib.load(config.SPLITS_PATH)
    return _splits_cache["data"]


registry = ModelRegistry()
