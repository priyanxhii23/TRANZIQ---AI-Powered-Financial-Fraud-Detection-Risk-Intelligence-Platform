"""End-to-end training pipeline.

Run from the repository root:

    python backend/scripts/train_models.py

Steps
-----
1. Load + validate + clean the Kaggle CSV.
2. Stratified 60/20/20 split (train / validation / test).
3. EDA statistics and figures.
4. Imbalance experiment: 3 models x 3 strategies (none, class_weight, smote),
   each scored on the VALIDATION split by PR-AUC.
5. For each model keep the strategy with the best validation PR-AUC.
6. Pick each model's decision threshold on the VALIDATION split (max F1).
7. Evaluate the final models ONCE on the untouched TEST split.
8. Rank models by validation PR-AUC (the test set is never used for choices).
9. Compute global SHAP importance, save models with joblib, write reports.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import sklearn

from . import config
from .data_loader import load_dataset
from .eda import compute_eda, save_eda_plots, write_eda
from .evaluation import (
    THRESHOLD_OBJECTIVE,
    full_evaluation,
    metrics_at_threshold,
    optimise_threshold,
    ranking_metrics,
)
from .explain import global_importance, save_summary_plot
from .models import HYPERPARAMETERS, make_model
from .preprocessing import build_pipeline, split_data
from .synthetic import build_pool

SELECTION_CRITERION = "Highest PR-AUC (Average Precision) on the validation split; ties broken by validation F1."


def log(msg: str) -> None:
    print(f"[TRANZIQ {datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _subsample(df: pd.DataFrame, frac: float, seed: int) -> pd.DataFrame:
    """Keep all fraud rows and `frac` of legitimate rows (for quick test runs)."""
    fraud = df[df[config.TARGET_COLUMN] == 1]
    legit = df[df[config.TARGET_COLUMN] == 0].sample(frac=frac, random_state=seed)
    return pd.concat([fraud, legit]).sample(frac=1, random_state=seed).reset_index(drop=True)


def train(dataset_path=None, sample_frac: float | None = None, make_plots: bool = True,
          shap_sample: int = config.SHAP_SAMPLE_SIZE, models: list[str] | None = None) -> dict:
    config.ensure_dirs()
    seed = config.RANDOM_SEED
    models = models or config.MODEL_NAMES
    started = time.time()

    # 1. Load -------------------------------------------------------------------
    df, cleaning = load_dataset(dataset_path)
    log(f"Loaded {cleaning.rows_loaded:,} rows -> {cleaning.rows_after_cleaning:,} after cleaning "
        f"({cleaning.duplicate_rows_dropped:,} duplicates, {cleaning.invalid_rows_dropped} invalid dropped)")
    if sample_frac:
        df = _subsample(df, sample_frac, seed)
        log(f"Quick mode: using {len(df):,} rows (all fraud + {sample_frac:.0%} of legitimate)")

    # 2. Split ------------------------------------------------------------------
    splits = split_data(df, seed)
    neg_pos = float((splits.y_train == 0).sum() / max(1, (splits.y_train == 1).sum()))
    log(f"Split sizes: {splits.summary()}")

    # 3. EDA --------------------------------------------------------------------
    eda = compute_eda(df, cleaning.to_dict(), splits.summary())
    eda["plots"] = save_eda_plots(df) if make_plots else []
    write_eda(eda)
    log("EDA written")

    # 4. Imbalance-strategy experiment -------------------------------------------
    experiments, fitted = [], {}
    for name in models:
        for strategy in config.IMBALANCE_STRATEGIES:
            t0 = time.time()
            pipe = build_pipeline(make_model(name, strategy, neg_pos, seed), use_smote=strategy == "smote", seed=seed)
            pipe.fit(splits.X_train, splits.y_train)
            secs = time.time() - t0
            val_proba = pipe.predict_proba(splits.X_val)[:, 1]
            res = {
                "model": name, "strategy": strategy, "train_seconds": round(secs, 2),
                "validation": {**ranking_metrics(splits.y_val, val_proba),
                               **{k: v for k, v in metrics_at_threshold(splits.y_val, val_proba, 0.5).items()
                                  if k in ("precision", "recall", "f1")}},
            }
            experiments.append(res)
            fitted[(name, strategy)] = (pipe, val_proba, secs)
            v = res["validation"]
            log(f"{name:20s} {strategy:13s} PR-AUC={v['pr_auc']:.4f} F1@0.5={v['f1']:.4f} ({secs:.1f}s)")

    # 5-7. Final model per algorithm ------------------------------------------------
    trained_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    version_tag = datetime.now(timezone.utc).strftime("%Y%m%d.%H%M")
    results: dict[str, dict] = {}
    rng = np.random.default_rng(seed)
    background_idx = rng.choice(len(splits.X_train), size=min(200, len(splits.X_train)), replace=False)

    for name in models:
        cands = [e for e in experiments if e["model"] == name]
        best = max(cands, key=lambda e: (e["validation"]["pr_auc"], e["validation"]["f1"]))
        strategy = best["strategy"]
        pipe, val_proba, secs = fitted[(name, strategy)]
        threshold = optimise_threshold(splits.y_val.values, val_proba)
        test_proba = pipe.predict_proba(splits.X_test)[:, 1]
        version = f"{version_tag}-{strategy}"

        bundle = {
            "name": name, "label": config.MODEL_LABELS[name], "version": version, "strategy": strategy,
            "threshold": threshold, "trained_at": trained_at, "pipeline": pipe,
            "feature_names": config.FEATURE_COLUMNS,
            "background": pipe.named_steps["preprocess"].transform(splits.X_train.iloc[background_idx]),
            "sklearn_version": sklearn.__version__,
        }
        path = config.MODELS_DIR / f"{name}.joblib"
        joblib.dump(bundle, path, compress=3)

        results[name] = {
            "name": name, "label": config.MODEL_LABELS[name], "version": version, "strategy": strategy,
            "hyperparameters": {k: v for k, v in HYPERPARAMETERS[name].items() if k != "n_jobs"},
            "trained_at": trained_at, "train_seconds": round(secs, 2),
            "recommended_threshold": threshold, "threshold_objective": THRESHOLD_OBJECTIVE,
            "validation": {**ranking_metrics(splits.y_val, val_proba),
                           "at_recommended": metrics_at_threshold(splits.y_val, val_proba, threshold)},
            "test": full_evaluation(splits.y_test.values, test_proba, threshold),
            "artifact": str(path.relative_to(config.ROOT_DIR)).replace("\\", "/"),
        }
        t = results[name]["test"]
        log(f"FINAL {name}: strategy={strategy} thr={threshold:.2f} TEST PR-AUC={t['pr_auc']:.4f} "
            f"P={t['at_recommended']['precision']:.3f} R={t['at_recommended']['recall']:.3f} "
            f"F1={t['at_recommended']['f1']:.3f}")

    # 8. Ranking (validation-based - avoids choosing on the test set) ---------------
    ranking = sorted(models, key=lambda n: (results[n]["validation"]["pr_auc"],
                                            results[n]["validation"]["at_recommended"]["f1"]), reverse=True)
    for i, n in enumerate(ranking, 1):
        results[n]["rank"] = i
    log(f"Ranking: {ranking} -> best = {ranking[0]}")

    # 9. Global SHAP ----------------------------------------------------------------
    test_df = splits.X_test.copy()
    fraud_rows = test_df[splits.y_test.values == 1]
    legit_rows = test_df[splits.y_test.values == 0]
    n_fraud = min(len(fraud_rows), max(1, shap_sample // 5))
    shap_X = pd.concat([fraud_rows.sample(n_fraud, random_state=seed),
                        legit_rows.sample(min(len(legit_rows), shap_sample - n_fraud), random_state=seed)])
    shap_global = {"sample_description": f"{len(shap_X)} test rows ({n_fraud} fraud-labelled, rest legitimate)",
                   "models": {}}
    for name in models:
        bundle = joblib.load(config.MODELS_DIR / f"{name}.joblib")
        t0 = time.time()
        gi = global_importance(bundle, shap_X)
        if make_plots:
            save_summary_plot(name, gi["values"], gi["X_t"], config.PLOTS_DIR / f"shap_summary_{name}.png")
        shap_global["models"][name] = {k: v for k, v in gi.items() if k not in ("values", "X_t")}
        shap_global["models"][name]["plot"] = f"shap_summary_{name}.png" if make_plots else None
        log(f"SHAP global for {name} ({time.time() - t0:.1f}s)")
    config.SHAP_GLOBAL_PATH.write_text(json.dumps(shap_global))

    # Splits needed later: TEST rows for seeding the demo DB, TRAIN pool for the generator.
    joblib.dump({
        "X_test": splits.X_test.reset_index(drop=True),
        "y_test": splits.y_test.reset_index(drop=True),
        "pool": build_pool(splits.X_train, splits.y_train, seed=seed),
    }, config.SPLITS_PATH, compress=3)

    report = {
        "generated_at": trained_at,
        "total_training_seconds": round(time.time() - started, 1),
        "random_seed": seed,
        "quick_mode": bool(sample_frac),
        "dataset": {"path": str(config.RAW_DATA_PATH.name), "cleaning": cleaning.to_dict(),
                    "splits": splits.summary(), "neg_pos_ratio": round(neg_pos, 2)},
        "settings": {"smote_sampling_strategy": config.SMOTE_SAMPLING_STRATEGY,
                     "smote_k_neighbors": config.SMOTE_K_NEIGHBORS,
                     "split": "60% train / 20% validation / 20% test (stratified)"},
        "experiments": experiments,
        "models": results,
        "ranking": ranking,
        "best_model": ranking[0],
        "selection_criterion": SELECTION_CRITERION,
        "versions": {"scikit-learn": sklearn.__version__},
    }
    config.EXPERIMENTS_PATH.write_text(json.dumps(report, indent=2))
    log(f"Done in {report['total_training_seconds']}s. Reports in {config.REPORTS_DIR}")
    return report
