"""
Run a reorder prediction for every one of Nomvula's seeded items through the running API
(real MySQL, real model service) and count which path produced each recommendation.

Usage:
    python api/confidence_check.py --label "before" [--url http://localhost:5000]

Appends a table to evidence/confidence-before-after.txt, so running it before and after a
change to the confidence heuristic leaves both results side by side.
"""
import argparse
import json
import os
import re
import urllib.request
from datetime import datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
SEED = os.path.join(ROOT, "db", "init", "02-seed.sql")
OUT = os.path.join(ROOT, "evidence", "confidence-before-after.txt")


def call(base, method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--url", default="http://localhost:5000")
    args = ap.parse_args()
    password = re.search(r"password '([^']+)' \(test data only\)", open(SEED, encoding="utf-8").read()).group(1)

    token = call(args.url, "POST", "/api/auth/login",
                 {"email": "nomvula@intellistock.test", "password": password})["token"]
    items = call(args.url, "GET", "/api/stock", token=token)
    health = json.loads(urllib.request.urlopen("http://localhost:8000/health").read())

    lines = [f"--- {args.label} --- run at {datetime.now().strftime('%Y-%m-%d %H:%M')}, "
             f"model {health.get('defaultModel')}",
             f"  {'id':>3}  {'item':<32} {'conf':>5}  {'demand/day':>10}  path", "  " + "-" * 72]
    counts = {}
    for it in sorted(items, key=lambda i: i["stockItemId"]):
        p = call(args.url, "POST", f"/api/stock/{it['stockItemId']}/prediction", token=token)
        reason = p["fallbackReason"] or "model"
        counts[reason] = counts.get(reason, 0) + 1
        conf = "" if p["confidence"] is None else f"{p['confidence']:.2f}"
        lines.append(f"  {it['stockItemId']:>3}  {it['name']:<32} {conf:>5}  {p['predictedDailyDemand']:>10.2f}  {reason}")
    lines.append("")
    lines.append("  " + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) + f"  (of {len(items)})")
    lines.append("")

    new_file = not os.path.exists(OUT)
    with open(OUT, "a", encoding="utf-8") as f:
        if new_file:
            f.write("IntelliStock - which path produced each recommendation (confidence heuristic change)\n")
            f.write("=" * 84 + "\n")
            f.write("Every Nomvula's Spaza item through POST /api/stock/{id}/prediction, real model service.\n")
            f.write("model = the model's forecast was used; lowConfidence / insufficientHistory = ETR-03 fallback.\n\n")
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
