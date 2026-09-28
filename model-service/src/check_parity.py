"""
Check that the serving path (app.serving_features) produces the same prediction
as the training path (build_features on the full dataset) for the same history.

Usage:
    python src/check_parity.py data/sales_data.csv [--rows 200]

Writes ../evidence/model-serving-parity.txt
"""
import argparse
import os
import sys
import warnings
from datetime import datetime

import joblib
import numpy as np

warnings.filterwarnings("ignore")
HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
from features import build_features, load_and_standardise  # noqa: E402
import app  # noqa: E402

EVIDENCE_DIR = os.path.join(HERE, "..", "..", "evidence")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("--rows", type=int, default=200)
    ap.add_argument("--model", default=app.DEFAULT_MODEL_ID)
    args = ap.parse_args()

    art = joblib.load(os.path.join(app.MODEL_DIR, f"{args.model}.joblib"))
    raw = load_and_standardise(args.dataset)
    train_path = build_features(raw, for_training=True)
    sample = train_path.sample(args.rows, random_state=42)

    diffs = []
    for idx, r in sample.iterrows():
        hist = raw[(raw["series"] == r["series"]) & (raw["date"] < r["date"])].tail(60)
        if len(hist) < app.MIN_HISTORY_DAYS:
            continue
        req = app.PredictRequest(stockItemId=1, category=r["category"],
                                 dailySales=hist["units_sold"].tolist(),
                                 daysSinceRestock=int(r["days_since_restock"]),
                                 asOfDate=r["date"].date())
        a = art["model"].predict(train_path.loc[[idx], art["feature_columns"]])[0]
        b = art["model"].predict(app.serving_features(req, req.asOfDate, art))[0]
        diffs.append(abs(a - b))

    diffs = np.array(diffs)
    lines = [
        "IntelliStock - training/serving parity check",
        "=" * 64,
        f"Run at      : {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"Dataset     : {os.path.basename(args.dataset)}",
        f"Model       : {args.model}",
        f"Method      : {len(diffs)} random rows (seed 42, >= {app.MIN_HISTORY_DAYS} days prior history).",
        "              Each row's prediction from the training feature frame is compared",
        "              with the prediction from app.serving_features() given only the",
        "              60 days of sales before that row, as the API would send them.",
        "",
        f"Max  |difference| : {diffs.max():.6f} units/day",
        f"Mean |difference| : {diffs.mean():.6f} units/day",
        f"Identical rows    : {(diffs == 0).sum()} of {len(diffs)}",
        "",
        f"Result: {'PASS - serving reproduces training features exactly' if diffs.max() < 1e-9 else 'FAIL - training and serving features differ'}",
    ]
    print("\n".join(lines))
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(os.path.join(EVIDENCE_DIR, "model-serving-parity.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
