"""Loading and validating the Kaggle Credit Card Fraud dataset.

The loader is intentionally strict: if the file is missing or the schema is
wrong we raise a clear error instead of silently producing bad models.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import config


class DatasetNotFoundError(FileNotFoundError):
    """Raised when creditcard.csv is not where we expect it."""

    def __init__(self, path: Path):
        super().__init__(
            f"Dataset not found at '{path}'.\n"
            f"Download 'creditcard.csv' from {config.DATASET_URL} (free Kaggle account) "
            f"and place it at data/raw/creditcard.csv,\n"
            f"or run:  python backend/scripts/download_dataset.py"
        )
        self.path = path


class DatasetValidationError(ValueError):
    """Raised when the CSV does not match the expected Kaggle schema."""


@dataclass
class CleaningReport:
    rows_loaded: int
    rows_after_cleaning: int
    missing_values: dict[str, int] = field(default_factory=dict)
    invalid_rows_dropped: int = 0
    duplicate_rows_dropped: int = 0

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def validate_schema(df: pd.DataFrame, require_target: bool = True) -> None:
    """Check that all expected columns exist and are numeric."""
    expected = config.EXPECTED_COLUMNS if require_target else config.FEATURE_COLUMNS
    missing = [c for c in expected if c not in df.columns]
    if missing:
        raise DatasetValidationError(f"Missing required columns: {missing}")
    non_numeric = [c for c in expected if not pd.api.types.is_numeric_dtype(df[c])]
    if non_numeric:
        raise DatasetValidationError(f"Columns must be numeric: {non_numeric}")
    if require_target:
        labels = set(pd.unique(df[config.TARGET_COLUMN].dropna()))
        if not labels.issubset({0, 1}):
            raise DatasetValidationError(f"'Class' must only contain 0/1, found {sorted(labels)}")


def clean(df: pd.DataFrame, drop_duplicates: bool = True) -> tuple[pd.DataFrame, CleaningReport]:
    """Handle missing / invalid values and duplicate rows.

    * Rows with missing or infinite values are dropped (the original dataset has none).
    * Negative amounts or times are invalid and dropped.
    * Exact duplicate rows are dropped so the same record cannot appear in both
      the training set and the test set (a subtle form of data leakage).
    """
    report = CleaningReport(rows_loaded=len(df), rows_after_cleaning=len(df))
    report.missing_values = {c: int(v) for c, v in df[config.EXPECTED_COLUMNS].isna().sum().items() if v}

    numeric = df[config.EXPECTED_COLUMNS].replace([np.inf, -np.inf], np.nan)
    invalid = numeric.isna().any(axis=1) | (numeric["Amount"] < 0) | (numeric["Time"] < 0)
    report.invalid_rows_dropped = int(invalid.sum())
    df = df.loc[~invalid, config.EXPECTED_COLUMNS].copy()

    if drop_duplicates:
        dup = df.duplicated()
        report.duplicate_rows_dropped = int(dup.sum())
        df = df.loc[~dup]

    df[config.TARGET_COLUMN] = df[config.TARGET_COLUMN].astype(int)
    df = df.reset_index(drop=True)
    report.rows_after_cleaning = len(df)
    return df, report


def load_dataset(path: Path | str | None = None, drop_duplicates: bool = True) -> tuple[pd.DataFrame, CleaningReport]:
    """Load creditcard.csv, validate it and return (clean dataframe, cleaning report)."""
    path = Path(path or config.RAW_DATA_PATH)
    if not path.exists():
        raise DatasetNotFoundError(path)
    try:
        df = pd.read_csv(path)
    except Exception as exc:  # pragma: no cover - corrupted file
        raise DatasetValidationError(f"Could not parse CSV: {exc}") from exc
    validate_schema(df)
    return clean(df, drop_duplicates=drop_duplicates)


def class_distribution(df: pd.DataFrame) -> dict:
    counts = df[config.TARGET_COLUMN].value_counts().to_dict()
    legit, fraud = int(counts.get(0, 0)), int(counts.get(1, 0))
    total = legit + fraud
    return {
        "total": total,
        "legitimate": legit,
        "fraudulent": fraud,
        "fraud_percentage": round(100 * fraud / total, 4) if total else 0.0,
        "imbalance_ratio": round(legit / fraud, 1) if fraud else None,  # e.g. 577.9 : 1
    }


def dataset_statistics(df: pd.DataFrame) -> dict:
    """Compact statistics shown on the dashboard / reports page."""
    return {
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "feature_count": len(config.FEATURE_COLUMNS),
        "class_distribution": class_distribution(df),
        "amount": {k: round(float(v), 2) for k, v in df["Amount"].describe().items()},
        "time_span_hours": round(float(df["Time"].max() - df["Time"].min()) / 3600, 1),
    }
