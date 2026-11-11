"""Test fixtures.

The suite is fully isolated from your real data: before any TRANZIQ module is
imported we point every path (dataset, artifacts, database) at a temporary
folder. A small dataset with the exact Kaggle schema is generated, and real
(but tiny) models are trained on it once per test session.
"""
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

TMP = Path(tempfile.mkdtemp(prefix="tranziq_test_"))
os.environ["TRANZIQ_DATA_DIR"] = str(TMP / "data")
os.environ["TRANZIQ_DATASET_PATH"] = str(TMP / "data" / "raw" / "creditcard.csv")
os.environ["TRANZIQ_ARTIFACTS_DIR"] = str(TMP / "artifacts")
os.environ["TRANZIQ_DATABASE_URL"] = f"sqlite:///{(TMP / 'test.db').as_posix()}"
os.environ["TRANZIQ_SEED_LEGIT_SAMPLE"] = "150"
os.environ["TRANZIQ_SEED_SYNTHETIC"] = "40"
os.environ["TRANZIQ_SHAP_SAMPLE"] = "60"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FEATURES = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]


def make_dataset(n: int = 3000, fraud_rate: float = 0.03, seed: int = 0) -> pd.DataFrame:
    """Kaggle-shaped data where fraud rows are shifted on a few components (learnable)."""
    rng = np.random.default_rng(seed)
    y = (rng.random(n) < fraud_rate).astype(int)
    V = rng.normal(0, 1, size=(n, 28))
    V[y == 1, 13] -= 3.0   # V14
    V[y == 1, 9] -= 2.0    # V10
    V[y == 1, 3] += 2.0    # V4
    df = pd.DataFrame(V, columns=[f"V{i}" for i in range(1, 29)])
    df.insert(0, "Time", np.sort(rng.uniform(0, 172000, n)).round())
    df["Amount"] = rng.lognormal(3, 1.2, n).round(2)
    df["Class"] = y
    return df


@pytest.fixture(scope="session")
def dataset_path() -> Path:
    path = Path(os.environ["TRANZIQ_DATASET_PATH"])
    path.parent.mkdir(parents=True, exist_ok=True)
    make_dataset().to_csv(path, index=False)
    return path


@pytest.fixture(scope="session")
def trained(dataset_path):
    from ml.train import train
    return train(dataset_path, make_plots=False, shap_sample=60)


@pytest.fixture(scope="session")
def client(trained):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def feature_row(trained) -> dict:
    df = make_dataset(5, seed=99)
    return {c: float(df.iloc[0][c]) for c in FEATURES}
