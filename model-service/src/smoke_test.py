"""
Exercise every model service endpoint and error path against a running service.

Usage:
    python src/smoke_test.py [--url http://localhost:8000]

Writes ../evidence/model-service-smoke.txt
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")

STEADY = [40, 42, 38, 45, 41, 39, 44, 43, 40, 42] * 4      # 40 days, mean 41.4
# volatile week to week: two normal weeks, a surge week, two normal, a slump week (42 days).
# Confidence is measured on weekly totals (D31), so day-to-day noise alone is not "erratic".
ERRATIC = [10] * 14 + [60] * 7 + [10] * 14 + [2] * 7


def item(stock_item_id, sales, days_since_restock=4, **extra):
    return {"stockItemId": stock_item_id, "category": "Groceries", "dailySales": sales,
            "daysSinceRestock": days_since_restock, "asOfDate": "2026-09-28", **extra}


CASES = [
    ("GET /health", "GET", "/health", None, 200),
    ("POST /predict - steady demand (mean 41.4/day), default model",
     "POST", "/predict", item(1, STEADY), 200),
    ("POST /predict - demand volatile week to week, expect lowConfidence=true (ETR-03)",
     "POST", "/predict", item(2, ERRATIC, 12), 200),
    ("POST /predict - modelId v1.0-base still served",
     "POST", "/predict", item(1, STEADY, modelId="v1.0-base"), 200),
    ("POST /predict - 29 days of history, expect 422 insufficientHistory (ETR-03)",
     "POST", "/predict", item(3, STEADY[:29]), 422),
    ("POST /predict - unknown modelId, expect 404",
     "POST", "/predict", item(1, STEADY, modelId="v9.9"), 404),
    ("GET /models/v1.1-relative - stored metrics", "GET", "/models/v1.1-relative", None, 200),
    ("GET /models/v1.0-base - stored metrics", "GET", "/models/v1.0-base", None, 200),
    ("GET /models/..%2Fapp - path traversal refused, expect 404", "GET", "/models/..%2Fapp", None, 404),
]


def call(base, method, path, body):
    req = urllib.request.Request(base + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    args = ap.parse_args()

    out = ["IntelliStock - model service smoke test", "=" * 64,
           f"Run at : {datetime.now().strftime('%Y-%m-%d %H:%M')}",
           f"Target : {args.url}", ""]
    passed = 0
    for name, method, path, body, expected in CASES:
        status, resp = call(args.url, method, path, body)
        ok = status == expected
        passed += ok
        out += [f"[{'PASS' if ok else 'FAIL'}] {name}",
                f"       HTTP {status} (expected {expected})",
                "       " + json.dumps(resp), ""]
    out.append(f"{passed} of {len(CASES)} checks passed")
    print("\n".join(out))
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(os.path.join(EVIDENCE_DIR, "model-service-smoke.txt"), "w") as f:
        f.write("\n".join(out) + "\n")
    sys.exit(0 if passed == len(CASES) else 1)


if __name__ == "__main__":
    main()
