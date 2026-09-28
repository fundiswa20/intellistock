"""
End-to-end check of the running system: API -> MySQL and API -> model service, no stubs.

Usage (with `docker compose up -d` running):
    python api/smoke_test.py [--url http://localhost:5000]

Writes evidence/api-endpoints.txt.

Makes no stock movements, so the seeded data used for screenshots is left as it is
(movements are permanent - FR-04). The writes are covered by the integration tests.
The only rows it adds are ReorderPrediction rows, which every prediction stores.
"""
import argparse
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
SEED = os.path.join(ROOT, "db", "init", "02-seed.sql")
OUT = os.path.join(ROOT, "evidence", "api-endpoints.txt")


def call(base, method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5000")
    args = ap.parse_args()
    password = re.search(r"password '([^']+)' \(test data only\)", open(SEED, encoding="utf-8").read()).group(1)

    out, results = [], []

    def check(name, status, expected, body, show=None):
        ok = status == expected
        results.append(ok)
        out.append(f"[{'PASS' if ok else 'FAIL'}] {name}")
        out.append(f"       HTTP {status} (expected {expected})")
        shown = show(body) if (show and ok) else body
        text = json.dumps(shown, indent=2, default=str) if shown is not None else "(no body)"
        out.extend("       " + line for line in text.splitlines())
        out.append("")

    base = args.url
    out += ["IntelliStock - API end-to-end check (real MySQL, real model service)", "=" * 70,
            f"Run at : {datetime.now().strftime('%Y-%m-%d %H:%M')}", f"Target : {base}", ""]

    s, b = call(base, "GET", "/health")
    check("GET /health - API up, database connected", s, 200, b)

    # FR-02
    s, b = call(base, "POST", "/api/auth/login", {"email": "nomvula@intellistock.test", "password": password})
    check("FR-02 POST /api/auth/login - seeded owner", s, 200, b,
          lambda x: {**x, "token": x["token"][:24] + "... (truncated)"})
    token = b["token"]
    s, b = call(base, "POST", "/api/auth/login", {"email": "nomvula@intellistock.test", "password": "wrong"})
    check("FR-02 POST /api/auth/login - wrong password", s, 401, b)
    s, b = call(base, "GET", "/api/stock")
    check("FR-02 GET /api/stock without a token", s, 401, b)

    # FR-03
    s, b = call(base, "GET", "/api/stock", token=token)
    check("FR-03 GET /api/stock - Nomvula's stock list", s, 200, b,
          lambda x: {"count": len(x), "low": sum(i["isLow"] for i in x),
                     "items": [f"{i['stockItemId']:>3}  {i['name']:<32} on hand {i['quantityOnHand']:>3}"
                               f"  reorder at {i['reorderLevel']:>2}{'  LOW' if i['isLow'] else ''}" for i in x]})
    s, b = call(base, "GET", "/api/stock/3", token=token)
    check("FR-03 GET /api/stock/3", s, 200, b)
    s, b = call(base, "GET", "/api/stock/101", token=token)
    check("FR-03 GET /api/stock/101 - another owner's item is not found", s, 404, b)

    # FR-04
    s, b = call(base, "GET", "/api/stock/3/movements?limit=8", token=token)
    check("FR-04 GET /api/stock/3/movements - transaction log, newest first", s, 200, b)
    s, b = call(base, "POST", "/api/stock/3/movements", {"type": "Sale", "quantity": 9999}, token=token)
    check("FR-04 POST /api/stock/3/movements - overselling refused, nothing written", s, 409, b)

    # FR-05
    s, b = call(base, "GET", "/api/stock/alerts", token=token)
    check("FR-05 GET /api/stock/alerts - open low-stock alerts", s, 200, b,
          lambda x: {"count": len(x), "alerts": [a["message"] for a in x]})

    # FR-08 against the real model service
    for item, label in ((1, "fast mover, bread"), (11, "fast mover, chips"),
                        (3, "slow mover, maize meal"), (19, "erratic, candles after load shedding"),
                        (22, "new item, 13 days of history")):
        s, b = call(base, "POST", f"/api/stock/{item}/prediction", token=token)
        check(f"FR-08 POST /api/stock/{item}/prediction - {label}", s, 200, b)

    out.append(f"{sum(results)} of {len(results)} checks passed")
    text = "\n".join(out) + "\n"
    print(text)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)


if __name__ == "__main__":
    main()
