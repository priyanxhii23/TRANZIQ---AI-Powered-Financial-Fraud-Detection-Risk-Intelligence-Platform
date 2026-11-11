"""Fraud Scenario Lab - model stress-testing scenarios.

Every scenario produces complete, model-compatible feature vectors
(Time, V1-V28, Amount) derived from REAL TRAINING records, using a
documented perturbation. Nothing here invents meanings for V1-V28 and
descriptive metadata (merchant, device, country) is never a model input.

Scenarios
---------
unusual_spending  One base record; Amount scaled up to ~50x (intensity), V1-V28 kept
                  almost unchanged -> "same behaviour, unusual amount".
rapid_activity    One base record repeated with Time = base + i * interval
                  (+ small V noise) -> many transactions in a short window.
fraud_patterns    Seeds drawn from FRAUD-labelled training rows + Gaussian noise
                  (intensity x feature std).
legit_patterns    Seeds drawn from LEGITIMATE training rows + the same noise.
custom            User-chosen base profile, amount, count, intensity and interval.

Generated rows have NO ground-truth label and are never used for training
or evaluation.
"""
from __future__ import annotations

import numpy as np

from . import config

COLS = config.FEATURE_COLUMNS
V_IDX = [COLS.index(c) for c in config.V_FEATURES]
A_IDX, T_IDX = COLS.index("Amount"), COLS.index("Time")
MAX_TIME = 172_792.0  # range of Time seen in training

CATALOG = {
    "unusual_spending": {
        "title": "Unusual spending",
        "summary": "Same transaction behaviour, amounts far above the selected historical sample.",
        "method": "Amount × U(1, 1 + 49·intensity); V1–V28 receive only 2% std noise.",
    },
    "rapid_activity": {
        "title": "Rapid transaction activity",
        "summary": "A burst of transactions seconds apart, starting from one historical sample.",
        "method": "Time = base Time + i × interval; V1–V28 noise of 10%·intensity std; Amount ±20%.",
    },
    "fraud_patterns": {
        "title": "Fraud-like feature patterns",
        "summary": "Perturbations of fraud-labelled training transactions.",
        "method": "Random fraud-labelled training seed + Gaussian noise (0.6·intensity × feature std).",
    },
    "legit_patterns": {
        "title": "Legitimate transaction patterns",
        "summary": "Perturbations of genuine-labelled training transactions.",
        "method": "Random legitimate training seed + Gaussian noise (0.6·intensity × feature std).",
    },
    "custom": {
        "title": "Custom scenario",
        "summary": "Your own base profile, amount, volume, intensity and time interval.",
        "method": "Seed from the chosen profile; optional fixed Amount; Time spaced by the interval; noise = 0.6·intensity × std.",
    },
}


def _noise(rng, x: np.ndarray, std: np.ndarray, level: float) -> np.ndarray:
    out = x.copy()
    out[:, V_IDX] += rng.normal(0, 1, size=(len(x), len(V_IDX))) * (level * std[V_IDX])
    return out


def run(pool: dict, scenario: str, count: int, intensity: float = 0.5, amount: float | None = None,
        interval: float = 30.0, base_profile: str = "legit", base: np.ndarray | None = None,
        seed: int | None = None) -> dict:
    """Return {"X": (count x 30) array, "base": base vector or None, "seeds": seed matrix}."""
    if scenario not in CATALOG:
        raise ValueError(f"unknown scenario '{scenario}'")
    if not 1 <= count <= 500:
        raise ValueError("count must be between 1 and 500")
    rng = np.random.default_rng(seed)
    std = pool["std"]
    src = pool["fraud"] if (scenario == "fraud_patterns" or (scenario == "custom" and base_profile == "fraud")) else pool["legit"]

    def pick_base() -> np.ndarray:
        return base.copy() if base is not None else src[rng.integers(len(src))].copy()

    if scenario == "unusual_spending":
        b = pick_base()
        X = np.repeat(b[None, :], count, axis=0)
        X = _noise(rng, X, std, 0.02)
        start = amount if amount else max(b[A_IDX], 1.0)
        factor = rng.uniform(1, 1 + 49 * max(intensity, 0.02), size=count)
        X[:, A_IDX] = np.round(start * factor, 2)
        return {"X": X, "base": b, "seeds": np.repeat(b[None, :], count, axis=0)}

    if scenario == "rapid_activity":
        b = pick_base()
        X = np.repeat(b[None, :], count, axis=0)
        X = _noise(rng, X, std, 0.1 * intensity)
        X[:, T_IDX] = np.clip(b[T_IDX] + np.arange(count) * interval, 0, MAX_TIME)
        X[:, A_IDX] = np.round(np.maximum(0, b[A_IDX] * rng.uniform(0.8, 1.2, size=count)), 2)
        return {"X": X, "base": b, "seeds": np.repeat(b[None, :], count, axis=0)}

    # pattern-based scenarios: many seeds from the chosen pool
    if base is not None and scenario == "custom":
        seeds = np.repeat(base[None, :], count, axis=0)
    else:
        seeds = src[rng.integers(len(src), size=count)].copy()
    X = _noise(rng, seeds, std, 0.6 * intensity)
    X[:, A_IDX] = np.round(np.maximum(0, X[:, A_IDX] * rng.lognormal(0, 0.3 * intensity, size=count)), 2)
    if scenario == "custom":
        if amount is not None:
            X[:, A_IDX] = np.round(amount * rng.uniform(0.97, 1.03, size=count), 2)
        t0 = seeds[0, T_IDX]
        X[:, T_IDX] = np.clip(t0 + np.arange(count) * interval, 0, MAX_TIME)
    return {"X": X, "base": base, "seeds": seeds}
