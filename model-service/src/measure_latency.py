"""
Measure POST /predict latency against a running model service.

Usage:
    python src/measure_latency.py [--url http://localhost:8000] [--requests 100] [--server "..."]

Sends warm-up requests (not timed), then N sequential timed requests, each with a
different stock item and a realistic 60-day sales history. Timing is wall clock
from the client, so it includes HTTP and JSON overhead, not just model inference.

Writes ../evidence/latency-p95.txt
"""
import argparse
import json
import os
import platform
import statistics
import time
import urllib.request
from datetime import datetime

import numpy as np

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")
CATEGORIES = ["Groceries", "Clothing", "Electronics", "Furniture", "Toys"]


def call(url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status, json.loads(resp.read())


def payload(i, rng):
    level = rng.uniform(5, 150)
    sales = np.clip(rng.normal(level, level * 0.3, 60), 0, None).round().tolist()
    return {"stockItemId": i, "category": CATEGORIES[i % len(CATEGORIES)],
            "dailySales": sales, "daysSinceRestock": int(rng.integers(0, 20))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--requests", type=int, default=100)
    ap.add_argument("--warmup", type=int, default=5)
    ap.add_argument("--server", default="not recorded",
                    help="where the service runs, e.g. 'docker compose model-service container'")
    args = ap.parse_args()

    rng = np.random.default_rng(42)
    _, health = call(f"{args.url}/health")
    for i in range(args.warmup):
        call(f"{args.url}/predict", payload(i, rng))

    times_ms, statuses = [], []
    for i in range(args.requests):
        body = payload(1000 + i, rng)
        t0 = time.perf_counter()
        status, _ = call(f"{args.url}/predict", body)
        times_ms.append((time.perf_counter() - t0) * 1000)
        statuses.append(status)

    t = np.array(times_ms)
    lines = [
        "IntelliStock - model service latency (POST /predict)",
        "=" * 64,
        f"Run at        : {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"Target        : {args.url}/predict",
        f"Model         : {health.get('defaultModel')} (loaded: {health.get('defaultModelLoaded')})",
        f"Server        : {args.server}",
        f"Client host   : {platform.system()} {platform.release()}, {platform.machine()}, Python {platform.python_version()}",
        f"Method        : {args.warmup} warm-up requests (not timed), then {args.requests} sequential",
        "                timed requests, one at a time, no concurrency. Each request is a",
        "                different stock item with a 60-day sales history. Times are client",
        "                wall clock, so they include HTTP and JSON overhead.",
        "",
        f"Requests      : {len(t)}   (HTTP 200: {statuses.count(200)})",
        f"Min           : {t.min():7.1f} ms",
        f"Mean          : {t.mean():7.1f} ms",
        f"Median (p50)  : {np.percentile(t, 50):7.1f} ms",
        f"p95           : {np.percentile(t, 95):7.1f} ms",
        f"p99           : {np.percentile(t, 99):7.1f} ms",
        f"Max           : {t.max():7.1f} ms",
        f"Std dev       : {statistics.stdev(times_ms):7.1f} ms",
    ]
    print("\n".join(lines))
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(os.path.join(EVIDENCE_DIR, "latency-p95.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
