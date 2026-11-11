import numpy as np
import pandas as pd
import pytest

from ml.data_loader import (
    DatasetNotFoundError,
    DatasetValidationError,
    class_distribution,
    clean,
    load_dataset,
    validate_schema,
)
from tests.conftest import make_dataset


def test_load_valid_dataset(dataset_path):
    df, report = load_dataset(dataset_path)
    assert list(df.columns) == ["Time", *[f"V{i}" for i in range(1, 29)], "Amount", "Class"]
    assert report.rows_loaded == 3000
    assert set(df["Class"].unique()) <= {0, 1}


def test_missing_dataset_gives_clear_message(tmp_path):
    with pytest.raises(DatasetNotFoundError) as e:
        load_dataset(tmp_path / "nope.csv")
    assert "kaggle.com/datasets/mlg-ulb/creditcardfraud" in str(e.value)
    assert "download_dataset.py" in str(e.value)


def test_missing_column_rejected():
    df = make_dataset(20).drop(columns=["V7"])
    with pytest.raises(DatasetValidationError, match="V7"):
        validate_schema(df)


def test_non_numeric_column_rejected():
    df = make_dataset(20)
    df["Amount"] = "abc"
    with pytest.raises(DatasetValidationError, match="numeric"):
        validate_schema(df)


def test_invalid_labels_rejected():
    df = make_dataset(20)
    df.loc[0, "Class"] = 2
    with pytest.raises(DatasetValidationError, match="0/1"):
        validate_schema(df)


def test_cleaning_drops_missing_invalid_and_duplicates():
    df = make_dataset(50)
    df.loc[0, "V1"] = np.nan
    df.loc[1, "Amount"] = -5
    df.loc[2, "V3"] = np.inf
    df = pd.concat([df, df.iloc[[10, 11]]])  # two exact duplicates
    out, report = clean(df)
    assert report.missing_values == {"V1": 1}
    assert report.invalid_rows_dropped == 3
    assert report.duplicate_rows_dropped == 2
    assert len(out) == 50 - 3
    assert not out.isna().any().any()


def test_class_distribution():
    df = pd.DataFrame({"Class": [0] * 98 + [1] * 2})
    d = class_distribution(df)
    assert d == {"total": 100, "legitimate": 98, "fraudulent": 2, "fraud_percentage": 2.0, "imbalance_ratio": 49.0}
