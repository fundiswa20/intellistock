# Evidence

Everything Assignment 3 needs as proof. Capture each item on the day it is produced —
recreating it later costs hours, and several items cannot be recreated at all once the
build has moved on.

Name files with the question number they answer, so they drop straight into the document.

## Checklist

| File | Question | Planned | Done |
|---|---|---|---|
| `dataset-inspection.txt` | 4.2 | Sun 20 | ☑ committed Mon 21 |
| `model-evaluation.txt` — MAPE, baseline MAPE, improvement, test period, row counts | **5.2, 2.3** | Mon 21 | ☑ Mon 21, re-run Mon 28 (identical metrics) |
| `model-feature-importance.png` | 4.1 | Mon 21 | ☑ Mon 21, regenerated Mon 28 |
| `model-serving-parity.txt` — serving features identical to training features | 4.1, 5.1 | — | ☑ Mon 28 |
| `model-service-smoke.txt` — every endpoint and error path, incl. 422 | 5.1 | — | ☑ Mon 28 |
| `latency-p95.txt` — 100 timed requests | **5.2, 2.3** | Tue 22 | ☑ Mon 28 |
| `erd.png` — entity relationship diagram | 4.2 | Wed 23 | ☐ |
| `schema.sql` — final schema | 4.2 | Wed 23 | ☐ |
| `api-postman.png` — endpoints returning real data | 4.3 | Fri 25 | ☐ |
| `tests-unit.txt` — `dotnet test` output to file | **5.1** | Fri 25 | ☐ |
| `tests-integration.txt` | **5.1** | Fri 25 | ☐ |
| `4.1-login.png` | 4.1, 5.3 | Sat 26 | ☐ |
| `4.1-stock-list.png` | 4.1, 5.3 | Sat 26 | ☐ |
| `4.1-stock-item-recommendation.png` — the money shot | **4.1, 5.3** | Sat 26 | ☐ |
| `4.1-alerts.png` | 4.1, 5.3 | Sat 26 | ☐ |
| `response-times.txt` — page load measurements | **5.2** | Sun 27 | ☐ |
| `docker-compose-up.png` — all services running | 4.4 | Sun 27 | ☐ |
| `git-log.txt` — `git log --oneline` | 4.1 | Mon 28 | ☐ |

Dates are 2026 and match the corrected schedule in the top-level README.

## Rules

**Screenshots** — full window, realistic seeded data, never an empty state. An empty
stock list proves the screen exists but not that the system works.

**Test output** — write to a file, don't screenshot a terminal:
```bash
dotnet test > ../evidence/tests-unit.txt 2>&1
```

**Numbers** — record the measurement conditions alongside the result. "MAPE 17.4%" is
weak; "MAPE 17.4% on a held-out test period of 2026-04-01 to 2026-07-05, 1,600 rows,
against a naive 30-day-average baseline of 24.1%" is evidence.

**Commit daily.** The assignment accepts repository references as evidence, and the
commit history itself shows sustained work.

## Not-met items

Record these honestly rather than leaving them blank. A requirement marked Not met with
a one-line reason scores; a requirement silently omitted does not.

Partial:
- FR-01 — users are seeded; no registration UI
- FR-06, FR-07 — supplier data seeded directly; no supplier interface built

Not met:
- FR-09 — consolidated reorder plan deferred
