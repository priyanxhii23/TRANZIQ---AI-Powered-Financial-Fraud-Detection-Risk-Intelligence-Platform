"""Splitting and preprocessing.

Design rules that prevent data leakage:
1. We split *before* fitting anything. Scalers and SMOTE only ever see the
   training split.
2. Preprocessing lives inside an imbalanced-learn ``Pipeline`` together with
   the model. When the pipeline is fitted, the scaler learns statistics from
   the training data only; when it predicts, it just applies them.
3. SMOTE is a *sampler* step of that pipeline. imblearn pipelines only run
   samplers during ``fit`` - never during ``predict`` - so validation and test
   data are never oversampled.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline as ImbPipeline
from sklearn.compose import ColumnTransformer
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import RobustScaler, StandardScaler

from . import config


@dataclass
class DataSplits:
    X_train: pd.DataFrame
    X_val: pd.DataFrame
    X_test: pd.DataFrame
    y_train: pd.Series
    y_val: pd.Series
    y_test: pd.Series

    def summary(self) -> dict:
        def part(y: pd.Series) -> dict:
            return {"rows": int(len(y)), "fraud": int(y.sum()), "fraud_pct": round(100 * float(y.mean()), 4)}
        return {"train": part(self.y_train), "validation": part(self.y_val), "test": part(self.y_test)}


def split_data(df: pd.DataFrame, seed: int = config.RANDOM_SEED) -> DataSplits:
    """Stratified 60/20/20 split so every part keeps the ~0.17% fraud ratio."""
    X = df[config.FEATURE_COLUMNS]
    y = df[config.TARGET_COLUMN]
    X_tmp, X_test, y_tmp, y_test = train_test_split(
        X, y, test_size=config.TEST_SIZE, stratify=y, random_state=seed
    )
    # validation fraction relative to what is left after removing the test set
    val_rel = config.VALIDATION_SIZE / (1 - config.TEST_SIZE)
    X_train, X_val, y_train, y_val = train_test_split(
        X_tmp, y_tmp, test_size=val_rel, stratify=y_tmp, random_state=seed
    )
    return DataSplits(X_train, X_val, X_test, y_train, y_val, y_test)


def build_preprocessor() -> ColumnTransformer:
    """Scale the two raw columns; V1-V28 are already PCA outputs.

    * ``Amount`` is heavily skewed with large outliers -> RobustScaler
      (uses median / IQR, so outliers do not dominate).
    * ``Time`` -> StandardScaler.
    * V1-V28 -> StandardScaler as well. They are already centred, but their
      variances differ, and Logistic Regression's regularisation assumes
      comparable scales. Tree models are unaffected by scaling.
    """
    return ColumnTransformer(
        transformers=[
            ("time", StandardScaler(), ["Time"]),
            ("v", StandardScaler(), config.V_FEATURES),
            ("amount", RobustScaler(), ["Amount"]),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def build_pipeline(model, use_smote: bool, seed: int = config.RANDOM_SEED) -> ImbPipeline:
    """preprocess -> (optional SMOTE, training-time only) -> model."""
    steps = [("preprocess", build_preprocessor())]
    if use_smote:
        steps.append(
            ("smote", SMOTE(sampling_strategy=config.SMOTE_SAMPLING_STRATEGY,
                            k_neighbors=config.SMOTE_K_NEIGHBORS, random_state=seed))
        )
    steps.append(("model", model))
    return ImbPipeline(steps)


def features_frame(rows: list[dict] | pd.DataFrame) -> pd.DataFrame:
    """Return a DataFrame with exactly the 30 feature columns in training order."""
    df = rows if isinstance(rows, pd.DataFrame) else pd.DataFrame(rows)
    missing = [c for c in config.FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing feature columns: {missing}")
    return df[config.FEATURE_COLUMNS].astype(float)
