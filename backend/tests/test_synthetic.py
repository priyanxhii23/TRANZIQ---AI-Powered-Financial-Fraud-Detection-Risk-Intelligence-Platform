import numpy as np
import pandas as pd
import pytest

from ml import config
from ml.synthetic import build_pool, generate
from tests.conftest import make_dataset


@pytest.fixture(scope="module")
def pool():
    df = make_dataset(1500)
    return build_pool(df[config.FEATURE_COLUMNS], df["Class"], legit_size=500)


def test_generates_requested_count_with_metadata(pool):
    recs = generate(pool, 50, seed=1)
    assert len(recs) == 50
    r = recs[0]
    for key in ("external_id", "customer_id", "amount", "timestamp", "merchant", "country", "city", "channel", "device", "status", "features"):
        assert key in r
    assert r["external_id"].startswith("SYN-")
    assert "ground_truth" not in r  # synthetic records never carry a label


def test_features_are_model_compatible(pool):
    recs = generate(pool, 200, noise_level=0.3, seed=2)
    X = pd.DataFrame([r["features"] for r in recs])
    assert list(X.columns) == config.FEATURE_COLUMNS
    assert np.isfinite(X.values).all()
    assert (X["Amount"] >= 0).all()
    assert X["Time"].between(0, 172800).all()
    assert all(r["amount"] == r["features"]["Amount"] for r in recs)


def test_reproducible_with_seed(pool):
    a = [r["features"] for r in generate(pool, 10, seed=7)]
    b = [r["features"] for r in generate(pool, 10, seed=7)]
    assert a == b


def test_fraud_profile_ratio_controls_seed_source(pool):
    recs = generate(pool, 300, fraud_profile_ratio=1.0, seed=3)
    assert all(r["generation_profile"] == "fraud-pattern seed" for r in recs)
    recs = generate(pool, 300, fraud_profile_ratio=0.0, seed=3)
    assert all(r["generation_profile"] == "legitimate-pattern seed" for r in recs)


@pytest.mark.parametrize("kw", [{"count": 0}, {"count": 6000}, {"count": 5, "noise_level": 2}, {"count": 5, "fraud_profile_ratio": -0.1}])
def test_invalid_settings_rejected(pool, kw):
    with pytest.raises(ValueError):
        generate(pool, **kw)
