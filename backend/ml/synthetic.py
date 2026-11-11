"""Synthetic transaction engine.

How model-compatible features are produced (documented method):
1. Pick a *seed* record from a pool of real **training** records
   (never test records). ``fraud_profile_ratio`` controls how often the seed
   comes from a fraud-labelled training record.
2. Perturb it: V1-V28 get Gaussian noise with std = ``noise_level`` x the
   feature's standard deviation in the pool; Amount is multiplied by a
   log-normal factor so it stays positive.
3. ``Time`` is derived from the generated timestamp (seconds into a day,
   optionally +1 day) so it stays within the 0-172,800 s range the models saw.

Descriptive metadata (merchant, city, device ...) is generated independently
and stored separately. It is NOT used by the models and does not imply any
meaning for V1-V28.

Synthetic records carry NO ground-truth label. The ``generation_profile``
field only records which kind of seed record was perturbed - it is not a
verified fraud label.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from . import config

MERCHANTS = [
    ("Northwind Grocers", "Groceries"), ("Lumen Electronics", "Electronics"), ("Harbor & Pine Cafe", "Dining"),
    ("Atlas Air Travel", "Travel"), ("Kestrel Fuel", "Fuel"), ("Velvet Fashion House", "Apparel"),
    ("Orbit Streaming", "Digital Services"), ("Meridian Pharmacy", "Health"), ("Copperline Hardware", "Home"),
    ("Nimbus Cloud Store", "Digital Services"), ("Saffron Street Kitchen", "Dining"), ("Polar Sports Co.", "Sporting Goods"),
    ("Quartz Jewellers", "Luxury"), ("Tidewater Hotels", "Travel"), ("Ember Gaming Hub", "Gaming"),
    ("Brightpath Books", "Books"), ("Cobalt Rideshare", "Transport"), ("Silverleaf Telecom", "Utilities"),
]
LOCATIONS = [
    ("United Kingdom", "London"), ("United Kingdom", "Manchester"), ("Germany", "Berlin"), ("France", "Paris"),
    ("Netherlands", "Amsterdam"), ("Spain", "Madrid"), ("Italy", "Milan"), ("United States", "New York"),
    ("United States", "San Francisco"), ("Canada", "Toronto"), ("India", "Bengaluru"), ("India", "Mumbai"),
    ("Singapore", "Singapore"), ("Japan", "Tokyo"), ("Australia", "Sydney"), ("United Arab Emirates", "Dubai"),
    ("Brazil", "Sao Paulo"), ("South Africa", "Cape Town"),
]
CHANNELS = ["Card Present (POS)", "E-commerce", "Mobile Wallet", "Contactless", "ATM Withdrawal"]
CHANNEL_DEVICE = {
    "Card Present (POS)": ["POS Terminal"],
    "E-commerce": ["Desktop", "Mobile", "Tablet"],
    "Mobile Wallet": ["Mobile"],
    "Contactless": ["POS Terminal", "Mobile"],
    "ATM Withdrawal": ["ATM"],
}
STATUSES = ["Approved", "Approved", "Approved", "Approved", "Pending", "Declined"]


def build_pool(X_train: pd.DataFrame, y_train: pd.Series, legit_size: int = 20000,
               seed: int = config.RANDOM_SEED) -> dict:
    """Store a small pool of *training* records used as perturbation seeds."""
    rng = np.random.default_rng(seed)
    legit_idx = np.flatnonzero(y_train.values == 0)
    fraud_idx = np.flatnonzero(y_train.values == 1)
    legit_idx = rng.choice(legit_idx, size=min(legit_size, len(legit_idx)), replace=False)
    legit = X_train.iloc[legit_idx][config.FEATURE_COLUMNS].to_numpy(dtype=float)
    fraud = X_train.iloc[fraud_idx][config.FEATURE_COLUMNS].to_numpy(dtype=float)
    return {"legit": legit, "fraud": fraud,
            "std": X_train[config.FEATURE_COLUMNS].std().to_numpy(dtype=float)}


def generate(pool: dict, count: int, fraud_profile_ratio: float = 0.05, noise_level: float = 0.15,
             days_back: int = 14, seed: int | None = None, now: datetime | None = None) -> list[dict]:
    if count < 1 or count > 5000:
        raise ValueError("count must be between 1 and 5000")
    if not 0 <= fraud_profile_ratio <= 1:
        raise ValueError("fraud_profile_ratio must be between 0 and 1")
    if not 0 <= noise_level <= 1:
        raise ValueError("noise_level must be between 0 and 1")
    rng = np.random.default_rng(seed)
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    cols = config.FEATURE_COLUMNS
    v_idx = [cols.index(c) for c in config.V_FEATURES]
    amt_idx, time_idx = cols.index("Amount"), cols.index("Time")
    customers = [f"CUS-{rng.integers(100000, 999999)}" for _ in range(max(5, count // 4))]

    records = []
    for _ in range(count):
        use_fraud = rng.random() < fraud_profile_ratio and len(pool["fraud"]) > 0
        src = pool["fraud"] if use_fraud else pool["legit"]
        x = src[rng.integers(len(src))].copy()
        x[v_idx] += rng.normal(0, noise_level * pool["std"][v_idx])
        x[amt_idx] = round(max(0.0, x[amt_idx] * float(rng.lognormal(0, noise_level))), 2)

        ts = now - timedelta(seconds=float(rng.uniform(0, days_back * 86400)))
        seconds_into_day = ts.hour * 3600 + ts.minute * 60 + ts.second
        x[time_idx] = float(seconds_into_day + 86400 * int(rng.integers(0, 2)))

        merchant, category = MERCHANTS[rng.integers(len(MERCHANTS))]
        country, city = LOCATIONS[rng.integers(len(LOCATIONS))]
        channel = CHANNELS[rng.integers(len(CHANNELS))]
        device = CHANNEL_DEVICE[channel][rng.integers(len(CHANNEL_DEVICE[channel]))]
        records.append({
            "external_id": f"SYN-{uuid.uuid4().hex[:12].upper()}",
            "customer_id": customers[rng.integers(len(customers))],
            "amount": float(x[amt_idx]),
            "timestamp": ts,
            "merchant": merchant,
            "merchant_category": category,
            "country": country,
            "city": city,
            "channel": channel,
            "device": device,
            "status": STATUSES[rng.integers(len(STATUSES))],
            "generation_profile": "fraud-pattern seed" if use_fraud else "legitimate-pattern seed",
            "features": {c: float(v) for c, v in zip(cols, x)},
        })
    return records
