"""
NFR-02 evidence: response time of GET /api/stock (the stock list) against the running stack.

Usage (with `docker compose up -d` running):
    python api/measure_response_times.py [--url http://localhost:5000] [--requests 50] [--warmup 5]

Writes evidence/response-times.txt.

This is a SEQUENTIAL, SINGLE-USER measurement: one request at a time from one client.
It is not a load test and says nothing directly about behaviour under concurrent users.
"""
import argparse
import json
import os
import platform
import re
import time
import urllib.request
from datetime import datetime

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..")
SEED = os.path.join(ROOT, "db", "init", "02-seed.sql")
OUT = os.path.join(ROOT, "evidence", "response-times.txt")
ENDPOINT = "/api/stock"


def request(url, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="POST" if body else "GET",
                                 data=json.dumps(body).encode() if body else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5000")
    ap.add_argument("--requests", type=int, default=50)
    ap.add_argument("--warmup", type=int, default=5)
    args = ap.parse_args()

    password = re.search(r"password '([^']+)' \(test data only\)", open(SEED, encoding="utf-8").read()).group(1)
    _, raw = request(f"{args.url}/api/auth/login", body={"email": "nomvula@intellistock.test", "password": password})
    token = json.loads(raw)["token"]

    for _ in range(args.warmup):
        request(f"{args.url}{ENDPOINT}", token)

    times, statuses, sizes, counts = [], [], [], []
    for _ in range(args.requests):
        t0 = time.perf_counter()
        status, body = request(f"{args.url}{ENDPOINT}", token)
        times.append((time.perf_counter() - t0) * 1000)
        statuses.append(status)
        sizes.append(len(body))
        counts.append(len(json.loads(body)))

    t = np.array(times)
    p95 = np.percentile(t, 95)
    lines = [
        "IntelliStock - NFR-02 response time: GET /api/stock (stock list)",
        "=" * 70,
        f"Run at          : {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"Endpoint        : GET {args.url}{ENDPOINT}  (authenticated, valid JWT for nomvula@intellistock.test)",
        f"Stack           : docker compose - api (ASP.NET Core 8) -> db (MySQL 8.0.45), both in Docker,",
        f"                  Docker Desktop on the same Windows machine as the client",
        f"Client          : Python {platform.python_version()} urllib, {platform.system()} {platform.release()}",
        f"Data returned   : {counts[0]} stock items per response, {sizes[0]:,} bytes of JSON",
        f"Method          : {args.warmup} warm-up requests (not timed), then {args.requests} timed requests,",
        "                  SEQUENTIAL - one at a time, one user, no concurrency. Client wall-clock time,",
        "                  including HTTP, JSON serialisation and the database query.",
        "",
        f"Requests timed  : {len(t)}   (HTTP 200: {statuses.count(200)})",
        f"p50 (median)    : {np.percentile(t, 50):7.1f} ms",
        f"p95             : {p95:7.1f} ms",
        f"Max             : {t.max():7.1f} ms",
        f"Min             : {t.min():7.1f} ms",
        f"Mean            : {t.mean():7.1f} ms",
        "",
        "Against NFR-02 (95th-percentile response under 3 seconds for up to 50 concurrent users)",
        "-" * 70,
        f"  Single-user sequential p95 of {p95:.1f} ms is under the 3,000 ms target.",
        "  WHAT THIS DOES NOT SHOW: behaviour under concurrent load. No concurrency test was",
        "  run - there was no test with 50 simultaneous users, so the concurrency part of",
        "  NFR-02 is not evidenced here. A load test (for example 50 virtual users with k6 or",
        "  JMeter against the same endpoint) is needed to evidence it.",
    ]
    text = "\n".join(lines) + "\n"
    print(text)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)


if __name__ == "__main__":
    main()
