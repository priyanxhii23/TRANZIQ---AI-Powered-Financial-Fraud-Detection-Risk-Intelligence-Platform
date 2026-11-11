"""Risk Assessment Engine.

Two separate ideas:
* The **decision threshold** (per model) turns a probability into a yes/no
  "predicted fraud" label. It is chosen on validation data during training.
* **Risk bands** split the probability scale into four levels that help an
  analyst prioritise work: Low, Medium, High, Critical.
"""
from __future__ import annotations

LEVELS = ["low", "medium", "high", "critical"]

LEVEL_INFO = {
    "low": {"label": "Low Risk", "action": "No action needed - routine monitoring."},
    "medium": {"label": "Medium Risk", "action": "Keep under observation; review if other signals appear."},
    "high": {"label": "High Risk", "action": "Raise an alert and queue for analyst investigation."},
    "critical": {"label": "Critical Risk", "action": "Prioritise immediately - consider holding the transaction pending review."},
}


def validate_bands(bands: dict) -> None:
    if not (0 < bands["medium"] < bands["high"] < bands["critical"] < 1):
        raise ValueError("Risk bands must satisfy 0 < medium < high < critical < 1")


def classify(probability: float, bands: dict) -> str:
    if probability >= bands["critical"]:
        return "critical"
    if probability >= bands["high"]:
        return "high"
    if probability >= bands["medium"]:
        return "medium"
    return "low"


def band_range(level: str, bands: dict) -> tuple[float, float]:
    edges = [0.0, bands["medium"], bands["high"], bands["critical"], 1.0]
    i = LEVELS.index(level)
    return edges[i], edges[i + 1]


def explain_level(probability: float, bands: dict, threshold: float | None = None) -> dict:
    level = classify(probability, bands)
    lo, hi = band_range(level, bands)
    pct = probability * 100
    text = (f"The model estimates a {pct:.1f}% fraud probability. That falls in the "
            f"{LEVEL_INFO[level]['label']} band ({lo:.2f} - {hi:.2f}).")
    if threshold is not None:
        flagged = probability >= threshold
        text += (f" The model's decision threshold is {threshold:.2f}, so the transaction is "
                 f"{'FLAGGED as predicted fraud' if flagged else 'classified as legitimate'}.")
    return {
        "level": level, "label": LEVEL_INFO[level]["label"], "range": [lo, hi],
        "recommended_action": LEVEL_INFO[level]["action"], "explanation": text,
        "probability": probability, "threshold": threshold,
        "predicted_label": None if threshold is None else int(probability >= threshold),
    }


def describe_bands(bands: dict) -> list[dict]:
    return [{"level": lvl, **LEVEL_INFO[lvl], "range": list(band_range(lvl, bands))} for lvl in LEVELS]
