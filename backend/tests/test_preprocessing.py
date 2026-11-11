import numpy as np
from sklearn.linear_model import LogisticRegression

from ml import config
from ml.preprocessing import build_pipeline, features_frame, split_data
from tests.conftest import make_dataset


def test_split_is_stratified_disjoint_and_sized():
    df = make_dataset(4000, fraud_rate=0.05)
    s = split_data(df)
    n = len(df)
    assert abs(len(s.X_train) - 0.6 * n) <= 2 and abs(len(s.X_test) - 0.2 * n) <= 2
    idx = [set(s.X_train.index), set(s.X_val.index), set(s.X_test.index)]
    assert not (idx[0] & idx[1]) and not (idx[0] & idx[2]) and not (idx[1] & idx[2])
    rates = [s.y_train.mean(), s.y_val.mean(), s.y_test.mean()]
    assert max(rates) - min(rates) < 0.01  # stratification keeps the fraud ratio


def test_split_reproducible():
    df = make_dataset(1000)
    a, b = split_data(df), split_data(df)
    assert list(a.X_test.index) == list(b.X_test.index)


def test_scaler_fitted_on_training_data_only():
    df = make_dataset(2000)
    s = split_data(df)
    pipe = build_pipeline(LogisticRegression(max_iter=500), use_smote=False).fit(s.X_train, s.y_train)
    amount_scaler = pipe.named_steps["preprocess"].named_transformers_["amount"]
    assert np.isclose(amount_scaler.center_[0], s.X_train["Amount"].median())


def test_smote_only_resamples_during_fit():
    df = make_dataset(2000)
    s = split_data(df)
    pipe = build_pipeline(LogisticRegression(max_iter=500), use_smote=True).fit(s.X_train, s.y_train)
    # The sampler grows the minority class in the training data...
    Xt = pipe.named_steps["preprocess"].transform(s.X_train)
    _, y_res = pipe.named_steps["smote"].fit_resample(Xt, s.y_train)
    assert y_res.sum() > s.y_train.sum()
    # ...but prediction returns exactly one output per input row (no resampling).
    assert len(pipe.predict_proba(s.X_test)) == len(s.X_test)


def test_features_frame_orders_columns():
    row = {c: 1.0 for c in reversed(config.FEATURE_COLUMNS)}
    assert list(features_frame([row]).columns) == config.FEATURE_COLUMNS
