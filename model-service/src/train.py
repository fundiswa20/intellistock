"""
Train the IntelliStock demand-forecasting model and evaluate it against a
naive baseline.

Usage:
    python src/train.py data/synthetic_sales.csv
    python src/train.py data/<kaggle-file>.csv --version v1.0-base
    python src/train.py data/<kaggle-file>.csv --version v1.1-relative --target relative

--target absolute  predicts mean daily demand directly (v1.0-base)
--target relative  predicts it as a ratio to the series' own 30-day mean, from
                   scale-free features, then multiplies back (v1.1-relative)

Writes:
    models/<version>.joblib          the trained artefact (refuses to overwrite without --force)
    ../evidence/model-evaluation.txt the numbers quoted in Assignment 3 (5.2, 2.3)
    ../evidence/model-feature-importance.png
    (relative models write model-evaluation-<version>.txt etc., leaving v1.0's evidence intact)
"""
import argparse
import json
import os
import sys
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error

sys.path.insert(0, os.path.dirname(__file__))
from features import (add_relative_features, build_features, chronological_split,
                      load_and_standardise, FEATURE_COLUMNS, LABEL_HORIZON,
                      RELATIVE_FEATURE_COLUMNS, RELATIVE_TARGET)

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")


def safe_mape(y_true, y_pred):
    """MAPE ignoring rows where actual demand is zero (undefined there)."""
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    mask = y_true > 0
    if mask.sum() == 0:
        return float("nan")
    return mean_absolute_percentage_error(y_true[mask], y_pred[mask]) * 100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("--version", default="v1.0-base")
    ap.add_argument("--test-fraction", type=float, default=0.2)
    ap.add_argument("--target", choices=["absolute", "relative"], default="absolute")
    ap.add_argument("--force", action="store_true", help="overwrite an existing artefact")
    args = ap.parse_args()

    relative = args.target == "relative"
    feature_columns = RELATIVE_FEATURE_COLUMNS if relative else FEATURE_COLUMNS
    suffix = f"-{args.version}" if relative else ""
    model_path = os.path.join(MODEL_DIR, f"{args.version}.joblib")
    if os.path.exists(model_path) and not args.force:
        sys.exit(f"models/{args.version}.joblib already exists - pass --force to overwrite it")

    lines = []

    def out(s=""):
        print(s)
        lines.append(s)

    out("IntelliStock - model training and evaluation")
    out("=" * 64)
    out(f"Run at       : {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out(f"Dataset      : {os.path.basename(args.dataset)}")
    out(f"Model version: {args.version}")
    out(f"Target       : {'ratio of next-7-day mean to 30-day mean (scale-free)' if relative else 'mean daily demand, absolute units'}")
    out()

    # ---- data
    raw = load_and_standardise(args.dataset)
    out(f"Rows after standardisation : {len(raw):,}")
    out(f"Products                   : {raw['product'].nunique():,}")
    out(f"Date range                 : {raw['date'].min().date()} to {raw['date'].max().date()}")
    out()

    df = build_features(raw, for_training=True)
    if relative:
        df = add_relative_features(df)
    out(f"Rows after feature engineering : {len(df):,}")
    out(f"Features                       : {len(feature_columns)}")
    out(f"Label                          : mean daily demand over next {LABEL_HORIZON} days")
    out()

    train, test, cutoff = chronological_split(df, args.test_fraction)
    out("Split: CHRONOLOGICAL (not random - a random split would leak future")
    out("       information into training and inflate the measured accuracy)")
    out(f"  cutoff date : {cutoff.date()}")
    out(f"  train rows  : {len(train):,}  ({train['date'].min().date()} to {train['date'].max().date()})")
    out(f"  test rows   : {len(test):,}  ({test['date'].min().date()} to {test['date'].max().date()})")
    out()

    X_test, y_test = test[feature_columns], test["label"]
    if relative:
        # the ratio is undefined where the 30-day mean is 0, so those rows are not
        # fitted on; they stay in the test set and are predicted as 0
        fit = train[train["label_ratio"].notna()]
        X_train, y_train = fit[feature_columns], fit["label_ratio"]
        out(f"  fitted on   : {len(fit):,} train rows with a non-zero 30-day mean")
        out()
    else:
        X_train, y_train = train[FEATURE_COLUMNS], train["label"]

    # ---- model
    model = HistGradientBoostingRegressor(
        max_iter=300,
        learning_rate=0.06,
        max_depth=6,
        min_samples_leaf=20,
        l2_regularization=1.0,
        random_state=42,
    )
    model.fit(X_train, y_train)
    pred = model.predict(X_test)
    if relative:
        # back to units: predicted ratio x the item's own 30-day mean. MAPE below is
        # therefore in absolute units, directly comparable with v1.0-base
        pred = pred * test["roll_mean_30"].values
    pred = np.clip(pred, 0, None)

    # ---- baseline: predict next week's demand as the last 30-day average
    baseline = test["roll_mean_30"].values

    model_mape = safe_mape(y_test, pred)
    base_mape = safe_mape(y_test, baseline)
    model_mae = mean_absolute_error(y_test, pred)
    base_mae = mean_absolute_error(y_test, baseline)
    improvement = (base_mape - model_mape) / base_mape * 100 if base_mape else float("nan")

    out("RESULTS")
    out("-" * 64)
    out(f"  Model    MAPE : {model_mape:6.2f} %      MAE : {model_mae:6.2f} units")
    out(f"  Baseline MAPE : {base_mape:6.2f} %      MAE : {base_mae:6.2f} units")
    out(f"  Improvement over baseline : {improvement:.1f} %")
    out()
    out("Requirement checks")
    out(f"  ETR-01 target MAPE <= 20%           : {'PASS' if model_mape <= 20 else 'FAIL'} ({model_mape:.2f}%)")
    out(f"  ETR-01 beat baseline by >= 10%      : {'PASS' if improvement >= 10 else 'FAIL'} ({improvement:.1f}%)")
    out()

    # ---- feature importance via permutation on a sample (cheap and honest)
    try:
        from sklearn.inspection import permutation_importance
        sample = min(3000, len(X_test))
        y_imp = test["label_ratio"].fillna(0) if relative else y_test
        imp = permutation_importance(model, X_test.iloc[:sample], y_imp.iloc[:sample],
                                     n_repeats=5, random_state=42, n_jobs=1)
        order = np.argsort(imp.importances_mean)[::-1]
        out("Feature importance (permutation, top 8)")
        for i in order[:8]:
            out(f"  {feature_columns[i]:<22} {imp.importances_mean[i]:.4f}")
        out()

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        top = order[:10][::-1]
        fig, ax = plt.subplots(figsize=(8, 5))
        ax.barh([feature_columns[i] for i in top],
                [imp.importances_mean[i] for i in top], color="#2E75B6")
        ax.set_xlabel("Permutation importance")
        ax.set_title(f"IntelliStock demand model {args.version} - feature importance")
        fig.tight_layout()
        os.makedirs(EVIDENCE_DIR, exist_ok=True)
        fig.savefig(os.path.join(EVIDENCE_DIR, f"model-feature-importance{suffix}.png"), dpi=150)
        plt.close(fig)
    except Exception as e:
        out(f"(feature importance skipped: {e})")

    # ---- persist
    os.makedirs(MODEL_DIR, exist_ok=True)
    artefact = {
        "model": model,
        "feature_columns": feature_columns,
        "target": RELATIVE_TARGET if relative else "absolute",
        "category_map": df.attrs.get("category_map", {}),
        "version": args.version,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "metrics": {
            "mape": round(float(model_mape), 3),
            "baseline_mape": round(float(base_mape), 3),
            "improvement_pct": round(float(improvement), 2),
            "mae": round(float(model_mae), 3),
            "test_rows": int(len(test)),
            "test_start": str(test["date"].min().date()),
            "test_end": str(test["date"].max().date()),
        },
    }
    joblib.dump(artefact, model_path)
    out(f"Saved model artefact : models/{args.version}.joblib")

    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(os.path.join(EVIDENCE_DIR, f"model-evaluation{suffix}.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(EVIDENCE_DIR, f"model-metrics{suffix}.json"), "w") as f:
        json.dump(artefact["metrics"], f, indent=2)
    print(f"\nSaved evidence/model-evaluation{suffix}.txt and evidence/model-metrics{suffix}.json")


if __name__ == "__main__":
    main()
