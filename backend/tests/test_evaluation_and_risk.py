import numpy as np
import pytest

from app.services import risk
from ml.evaluation import metrics_at_threshold, optimise_threshold, threshold_table


def test_metrics_at_threshold_known_values():
    y = np.array([0, 0, 0, 1, 1])
    p = np.array([0.1, 0.6, 0.2, 0.7, 0.4])
    m = metrics_at_threshold(y, p, 0.5)
    assert m["confusion_matrix"] == {"tn": 2, "fp": 1, "fn": 1, "tp": 1}
    assert m["precision"] == 0.5 and m["recall"] == 0.5 and m["f1"] == 0.5


def test_threshold_changes_tradeoff():
    y = np.array([0, 0, 1, 1])
    p = np.array([0.1, 0.35, 0.3, 0.9])
    low, high = metrics_at_threshold(y, p, 0.2), metrics_at_threshold(y, p, 0.5)
    assert low["recall"] >= high["recall"]
    assert low["confusion_matrix"]["fp"] >= high["confusion_matrix"]["fp"]


def test_optimise_threshold_finds_separating_value():
    y = np.array([0] * 50 + [1] * 5)
    p = np.r_[np.linspace(0, 0.3, 50), np.linspace(0.6, 0.9, 5)]
    t = optimise_threshold(y, p)
    assert 0.3 < t <= 0.6
    assert metrics_at_threshold(y, p, t)["f1"] == 1.0


def test_threshold_table_contains_requested_thresholds():
    t = [r["threshold"] for r in threshold_table([0, 1], [0.1, 0.9])]
    for x in (0.2, 0.3, 0.4, 0.5, 0.6):
        assert x in t


BANDS = {"medium": 0.25, "high": 0.5, "critical": 0.8}


@pytest.mark.parametrize("p,level", [(0.0, "low"), (0.249, "low"), (0.25, "medium"), (0.5, "high"), (0.79, "high"), (0.8, "critical"), (1.0, "critical")])
def test_risk_classification_boundaries(p, level):
    assert risk.classify(p, BANDS) == level


def test_invalid_bands_rejected():
    with pytest.raises(ValueError):
        risk.validate_bands({"medium": 0.6, "high": 0.5, "critical": 0.8})


def test_risk_explanation_mentions_threshold_decision():
    e = risk.explain_level(0.9, BANDS, threshold=0.55)
    assert e["level"] == "critical" and e["predicted_label"] == 1
    assert "FLAGGED" in e["explanation"]
    assert risk.explain_level(0.3, BANDS, 0.55)["predicted_label"] == 0
