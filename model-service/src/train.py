"""
Train the IntelliStock demand-forecasting model and evaluate it against a
naive baseline.

Usage:
    python src/train.py data/synthetic_sales.csv
    python src/train.py data/<kaggle-file>.csv --version v1.0-base

Writes:
    models/<version>.joblib          the trained artefact
    ../evidence/model-evaluation.txt the numbers quoted in Assignment 3 (5.2, 2.3)
    ../evidence/model-feature-importance.png
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
from features import (build_features, chronological_split, load_and_standardise,
                      FEATURE_COLUMNS, LABEL_HORIZON)

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
    args = ap.parse_args()

    lines = []

    def out(s=""):
        print(s)
        lines.append(s)

    out("IntelliStock - model training and evaluation")
    out("=" * 64)
    out(f"Run at       : {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out(f"Dataset      : {os.path.basename(args.dataset)}")
    out(f"Model version: {args.version}")
    out()

    # ---- data
    raw = load_and_standardise(args.dataset)
    out(f"Rows after standardisation : {len(raw):,}")
    out(f"Products                   : {raw['product'].nunique():,}")
    out(f"Date range                 : {raw['date'].min().date()} to {raw['date'].max().date()}")
    out()

    df = build_features(raw, for_training=True)
    out(f"Rows after feature engineering : {len(df):,}")
    out(f"Features                       : {len(FEATURE_COLUMNS)}")
    out(f"Label                          : mean daily demand over next {LABEL_HORIZON} days")
    out()

    train, test, cutoff = chronological_split(df, args.test_fraction)
    out("Split: CHRONOLOGICAL (not random - a random split would leak future")
    out("       information into training and inflate the measured accuracy)")
    out(f"  cutoff date : {cutoff.date()}")
    out(f"  train rows  : {len(train):,}  ({train['date'].min().date()} to {train['date'].max().date()})")
    out(f"  test rows   : {len(test):,}  ({test['date'].min().date()} to {test['date'].max().date()})")
    out()

    X_train, y_train = train[FEATURE_COLUMNS], train["label"]
    X_test, y_test = test[FEATURE_COLUMNS], test["label"]

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
        imp = permutation_importance(model, X_test.iloc[:sample], y_test.iloc[:sample],
                                     n_repeats=5, random_state=42, n_jobs=1)
        order = np.argsort(imp.importances_mean)[::-1]
        out("Feature importance (permutation, top 8)")
        for i in order[:8]:
            out(f"  {FEATURE_COLUMNS[i]:<22} {imp.importances_mean[i]:.4f}")
        out()

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        top = order[:10][::-1]
        fig, ax = plt.subplots(figsize=(8, 5))
        ax.barh([FEATURE_COLUMNS[i] for i in top],
                [imp.importances_mean[i] for i in top], color="#2E75B6")
        ax.set_xlabel("Permutation importance")
        ax.set_title("IntelliStock demand model - feature importance")
        fig.tight_layout()
        os.makedirs(EVIDENCE_DIR, exist_ok=True)
        fig.savefig(os.path.join(EVIDENCE_DIR, "model-feature-importance.png"), dpi=150)
        plt.close(fig)
    except Exception as e:
        out(f"(feature importance skipped: {e})")

    # ---- persist
    os.makedirs(MODEL_DIR, exist_ok=True)
    artefact = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
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
    path = os.path.join(MODEL_DIR, f"{args.version}.joblib")
    joblib.dump(artefact, path)
    out(f"Saved model artefact : models/{args.version}.joblib")

    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(os.path.join(EVIDENCE_DIR, "model-evaluation.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(EVIDENCE_DIR, "model-metrics.json"), "w") as f:
        json.dump(artefact["metrics"], f, indent=2)
    print("\nSaved evidence/model-evaluation.txt and evidence/model-metrics.json")


if __name__ == "__main__":
    main()
