"""
Check whether a model's forecast follows the item's own sales volume.

Sends flat sales histories (the same number every day for 60 days) at several
volumes to a running model service, for each model id given. A model that works
at any scale predicts close to the flat level; one bounded by its training range
does not.

Usage:
    python src/check_scale.py [--url http://localhost:8000] [--models v1.0-base v1.1-relative]

Writes ../evidence/model-scale-check.txt
"""
import argparse
import json
import os
import urllib.request
from datetime import datetime

import numpy as np

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")
LEVELS = [3, 10, 30, 90, 300]


def predict(url, model_id, sales):
    body = {"stockItemId": 1, "category": "Groceries", "dailySales": sales,
            "daysSinceRestock": 4, "modelId": model_id, "asOfDate": "2026-09-28"}
    req = urllib.request.Request(f"{url}/predict", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--models", nargs="+", default=["v1.0-base", "v1.1-relative"])
    args = ap.parse_args()

    lines = ["IntelliStock - forecast scale check", "=" * 64,
             f"Run at : {datetime.now().strftime('%Y-%m-%d %H:%M')}",
             f"Target : {args.url}/predict", "",
             "1. Flat history: the same units every day for 60 days, category Groceries,",
             "   daysSinceRestock 4, asOfDate 2026-09-28. The right answer is the flat level.", ""]
    header = f"  {'units/day':>9} | " + " | ".join(f"{m:>24}" for m in args.models)
    lines += [header, "  " + "-" * (len(header) - 2)]
    for level in LEVELS:
        cells = []
        for m in args.models:
            p = predict(args.url, m, [float(level)] * 60)["predictedDailyDemand"]
            cells.append(f"{p:9.2f} ({(p - level) / level * 100:+6.0f}%)     ")
        lines.append(f"  {level:>9} | " + " | ".join(f"{c:>24}" for c in cells))

    lines += ["", "2. Realistic low-volume history: 60 days of Poisson-distributed daily sales",
              "   (seed 42), as a spaza shop's slow and fast movers would look.", ""]
    rng = np.random.default_rng(42)
    lines += [f"  {'mean/day':>9} | " + " | ".join(f"{m:>24}" for m in args.models),
              "  " + "-" * (len(header) - 2)]
    for level in [3, 10, 30]:
        sales = rng.poisson(level, 60).astype(float).tolist()
        actual = float(np.mean(sales[-30:]))
        cells = []
        for m in args.models:
            r = predict(args.url, m, sales)
            cells.append(f"{r['predictedDailyDemand']:7.2f} conf {r['confidence']:.2f}  ")
        lines.append(f"  {actual:>9.1f} | " + " | ".join(f"{c:>24}" for c in cells))
    lines += ["", "  mean/day = mean of the last 30 days sent. conf = confidence heuristic (D11)."]

    print("\n".join(lines))
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(os.path.join(EVIDENCE_DIR, "model-scale-check.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
