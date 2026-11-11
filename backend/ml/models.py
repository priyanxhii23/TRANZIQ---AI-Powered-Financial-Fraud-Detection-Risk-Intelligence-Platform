"""Model factory - one place that defines the three algorithms and their
hyper-parameters for each imbalance strategy.

Strategies
----------
* ``none``          - train on the data as-is (0.17% fraud).
* ``class_weight``  - tell the algorithm that mistakes on the rare class cost
                      more (``class_weight='balanced'`` / ``scale_pos_weight``).
* ``smote``         - synthesise extra minority examples *inside the training
                      pipeline only* (see preprocessing.build_pipeline).
"""
from __future__ import annotations

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from xgboost import XGBClassifier

from . import config

# Documented hyper-parameters (chosen as sensible, well-known defaults for this
# dataset size; kept moderate so training runs on a laptop in minutes).
HYPERPARAMETERS: dict[str, dict] = {
    "logistic_regression": {
        "C": 0.1,              # L2 regularisation strength (smaller = stronger)
        "max_iter": 2000,
        "solver": "lbfgs",
    },
    "random_forest": {
        "n_estimators": 200,   # number of trees
        "max_depth": 14,       # limits tree depth -> less overfitting, faster
        "min_samples_leaf": 2,
        "max_features": "sqrt",
        "n_jobs": -1,
    },
    "xgboost": {
        "n_estimators": 400,
        "learning_rate": 0.05,
        "max_depth": 5,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 1,
        "tree_method": "hist",
        "eval_metric": "aucpr",
        "n_jobs": -1,
    },
}


def make_model(name: str, strategy: str, neg_pos_ratio: float, seed: int = config.RANDOM_SEED):
    """Return an *unfitted* estimator for the given algorithm + strategy."""
    if name not in HYPERPARAMETERS:
        raise ValueError(f"Unknown model '{name}'")
    if strategy not in config.IMBALANCE_STRATEGIES:
        raise ValueError(f"Unknown strategy '{strategy}'")
    params = dict(HYPERPARAMETERS[name])
    weighted = strategy == "class_weight"

    if name == "logistic_regression":
        return LogisticRegression(class_weight="balanced" if weighted else None, random_state=seed, **params)
    if name == "random_forest":
        return RandomForestClassifier(
            class_weight="balanced_subsample" if weighted else None, random_state=seed, **params
        )
    # XGBoost has no class_weight; scale_pos_weight = (#negatives / #positives) is the equivalent.
    return XGBClassifier(scale_pos_weight=neg_pos_ratio if weighted else 1.0, random_state=seed, **params)
