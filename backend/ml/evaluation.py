"""Model evaluation and threshold optimisation.

Why not accuracy? With 0.17% fraud, a model that says "legitimate" for every
transaction is 99.83% accurate yet catches zero fraud. We therefore focus on:

* Precision - of the transactions we flagged, how many were really fraud?
* Recall    - of all real fraud, how much did we catch?
* F1        - harmonic mean of precision and recall.
* PR-AUC    - area under the precision-recall curve (Average Precision);
              threshold-independent and robust to class imbalance.
"""
from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)

from . import config

THRESHOLD_OBJECTIVE = (
    "Maximise F1-score on the validation split (search grid 0.01-0.99, step 0.01). "
    "F1 balances missed fraud (false negatives) against false alarms (false positives)."
)


def metrics_at_threshold(y_true, proba, threshold: float) -> dict:
    y_true = np.asarray(y_true)
    y_pred = (np.asarray(proba) >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    return {
        "threshold": round(float(threshold), 4),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def ranking_metrics(y_true, proba) -> dict:
    return {
        "pr_auc": float(average_precision_score(y_true, proba)),
        "roc_auc": float(roc_auc_score(y_true, proba)),
    }


def _downsample(xs, ys, thr, n: int = 120) -> list[dict]:
    idx = np.unique(np.linspace(0, len(xs) - 1, num=min(n, len(xs))).astype(int))
    out = []
    for i in idx:
        t = float(thr[min(i, len(thr) - 1)]) if len(thr) else None
        if t is not None and not np.isfinite(t):  # roc_curve's first threshold is +inf
            t = None
        out.append({"x": round(float(xs[i]), 5), "y": round(float(ys[i]), 5), "threshold": None if t is None else round(t, 5)})
    return out


def curves(y_true, proba) -> dict:
    p, r, t = precision_recall_curve(y_true, proba)
    fpr, tpr, rt = roc_curve(y_true, proba)
    # PR: x = recall, y = precision. sklearn returns them in decreasing-recall order.
    return {
        "pr_curve": _downsample(r[::-1], p[::-1], np.r_[t, t[-1:]][::-1] if len(t) else t),
        "roc_curve": _downsample(fpr, tpr, rt),
    }


def threshold_table(y_true, proba, thresholds=None) -> list[dict]:
    thresholds = thresholds or config.COMPARISON_THRESHOLDS
    return [metrics_at_threshold(y_true, proba, t) for t in thresholds]


def optimise_threshold(y_true, proba) -> float:
    """Return the threshold that maximises F1 on (validation) data."""
    grid = np.round(np.arange(0.01, 1.0, 0.01), 2)
    scores = [f1_score(y_true, (proba >= t).astype(int), zero_division=0) for t in grid]
    best = int(np.argmax(scores))  # first max -> lowest threshold among ties (favours recall)
    return float(grid[best])


def full_evaluation(y_true, proba, threshold: float) -> dict:
    """Everything the Model Lab needs for one model on one split."""
    return {
        **ranking_metrics(y_true, proba),
        "at_default": metrics_at_threshold(y_true, proba, 0.5),
        "at_recommended": metrics_at_threshold(y_true, proba, threshold),
        "threshold_table": threshold_table(y_true, proba),
        **curves(y_true, proba),
        "probability_histogram": probability_histogram(y_true, proba),
    }


def probability_histogram(y_true, proba, bins: int = 20) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    y_true = np.asarray(y_true)
    proba = np.asarray(proba)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (proba >= lo) & ((proba < hi) if hi < 1 else (proba <= hi))
        out.append({
            "bin": f"{lo:.2f}-{hi:.2f}",
            "legitimate": int(((y_true == 0) & mask).sum()),
            "fraud": int(((y_true == 1) & mask).sum()),
        })
    return out
