# IntelliStock — Build Journal

The record of what was built, why, and what is still open. Decisions are numbered so they
can be cited from the Assignment 3 document ("see D7"). Later decisions never silently
override earlier ones; they reference them.

---

## 1. Current status

_Last updated: Mon 28 Sep 2026._

| Component | UML name | State |
|---|---|---|
| Model training + evaluation | — | **Done.** Default model `v1.1-relative`: MAPE 10.53% vs 22.18% baseline, works at any sales volume (D16). `v1.0-base` (10.51%) kept. |
| Model service | ReorderPredictionService | **Done.** `POST /predict`, `GET /health`, `GET /models/{id}`, running in Docker Compose. p95 latency 72.7 ms. Confidence measured on weekly totals (D31). |
| MySQL schema + seed | all 8 UML classes | **Done.** 8 tables, FR-04 immutability enforced by triggers, 120 days of spaza-shop history (5,570 transactions). Verified: `evidence/db-verification.txt`. |
| API | AuthController, StockController, InventoryRepository | **Done.** ASP.NET Core 8, EF Core 8 + Pomelo, JWT. 41 unit + 32 integration tests pass; end-to-end 15/15. Runs in Docker Compose on port 5000. |
| Client | InventoryDashboard | Not started. Minimal two-screen client planned for Tue 29 (screenshots and user guide); the full client is for Assignment 4. |

**Requirements — traceability status for Assignment 3**

Graded from the system's point of view: a requirement is Pass when the system does it and
tests prove it, whether or not a screen exists yet. "API only" marks behaviour that is built
and tested in the API but has no client screen yet (the minimal client is Tue 29).

| ID | Requirement | Status | Reason | Evidence |
|---|---|---|---|---|
| FR-01 | Registration | Partial | Users are seeded with hashed passwords; no registration endpoint or screen. | `db/init/02-seed.sql`, `PasswordHashTests` |
| FR-02 | Login | Pass | JWT login against seeded users; wrong password and unknown email get the same 401; missing or forged token rejected; suppliers refused stock endpoints. | `tests-integration.txt` (AuthTests, 6), `api-endpoints.txt` |
| FR-03 | Stock item CRUD | Pass — API only | Create, read, update, soft delete; each owner sees only their own stock; another owner's item is 404. | `tests-integration.txt` (StockItemTests, 7) |
| FR-04 | Stock movement, immutable transaction log | Pass — API only | Sale/Restock/Adjustment with running balance and row lock; overselling refused; UPDATE/DELETE rejected by database triggers. | `tests-integration.txt`, `tests-unit.txt`, `db-verification.txt` |
| FR-05 | Low-stock alerts | Pass — API only | Raised at or below the reorder level, resolved on restock, one open alert per item enforced by the database; 8 open in the seed. | `tests-integration.txt`, `db-verification.txt` |
| FR-06 | Supplier functionality | Partial | Supplier accounts and price lists seeded; no supplier interface. | `db-verification.txt` §8 |
| FR-07 | Supplier functionality | Partial | Supplier data seeded; no supplier interface. | `db-verification.txt` §8 |
| FR-08 | Reorder prediction | Pass — API only | Model called with history from the transaction log; days to stock-out and reorder quantity derived in the API; threshold-based advice when the model cannot be trusted. | `api-endpoints.txt`, `tests-integration.txt` (PredictionTests, 8), `model-*.txt` |
| FR-09 | Consolidated reorder plan | Not met | Deferred. | — |
| FR-10 | Order placement and status tracking | Not met | Deferred; ordering is not part of the prototype scope. | — |
| ETR-01 | MAPE ≤ 20% and ≥ 10% better than baseline | Pass | v1.1-relative 10.53% vs 22.18% baseline (52.5% better), chronological test period. | `model-evaluation-v1.1-relative.txt` |
| ETR-03 | Insufficient history and low confidence handled | Pass | Model service: 422 under 30 days and `lowConfidence` under 0.6. API: threshold-based advice with the reason recorded and shown (D25). | `model-service-smoke.txt`, `tests-integration.txt` |

**Open issues**

None open.

Resolved on Mon 28:

- **O4 — the confidence heuristic flagged most slow-moving items.** 10 of 22 seeded
  items fell back because daily Poisson noise pushed their daily CV past 0.67. **Resolved by
  D31**: CV is now measured on weekly totals. After the change, 0 of 22 are low-confidence.
- **O5 — AuthController was not in the UML component list.** **Resolved by D32**: added to
  the component diagram as an approved change (Q1.2).
- **O6 — what "threshold-based advice" (ETR-03) means.** ETR-03 does not define the
  arithmetic. **Resolved by D25**, which now states the exact formula, and by the API response,
  which labels which path produced each recommendation.
- **O1 — v1.0-base could not predict spaza-shop volumes.** Found while smoke-testing.
  With flat sales histories, v1.0's output was bounded to about 44–148 units/day. Trees
  cannot extrapolate beyond the targets seen in training, and the Kaggle data's median is
  84 units/day. **Resolved by D16**: `v1.1-relative` predicts a ratio, and it is −4% at
  every volume from 3 to 300 units/day.
- **O2 — category vocabulary.** The model knows five categories: Clothing, Electronics,
  Furniture, Groceries, Toys. Any other string maps to code −1. **Resolved**: spaza stock
  is seeded as Groceries.
- **O3 — InventoryRepository vs "controller calls EF Core directly".** **Resolved**: the
  EF Core `DbContext` class is named `InventoryRepository`, so the UML component exists by
  name. There is no repository pattern layered on top (D15).

---

## 2. Decision log

**D1 — Chronological train/test split, not random.**
Cutoff at the 80th percentile of dates (2023-09-02). Train 60,000 rows (2022-01-11 to
2023-09-02); test 14,900 rows (2023-09-03 to 2024-01-29). A random split would put days
from the future into training, and the model would be scored on days surrounded by
days it had already seen. That inflates accuracy in a way that disappears in production.
ETR-01 requires a held-out period. `features.chronological_split()`.

**D2 — Rolling features are computed on sales shifted by one day.**
`build_features()` applies `shift(1)` before every rolling mean and std. Without it,
the 7-day mean for day D would include day D's own sales, which is part of what is
being predicted. That's target leakage, and it would inflate the evaluation. With the shift, every
feature for day D uses only information available at the end of day D−1, which is exactly
what the live system has.

**D3 — A series is one product in one store.**
The Kaggle data has 20 products across 5 stores. Grouping on product alone would sum five
stores' demand into one series, producing a smoother, larger pattern that no single shop
experiences. `series = store + "|" + product`. In IntelliStock, one stock item belongs to
one business, so the serving side is naturally one series per stock item.

**D4 — Excluded columns: `Demand` as target leakage, `Epidemic` as unavailable at inference.**
`Demand` in the Kaggle file is a pre-computed estimate of the quantity being predicted.
Training on it would give a spectacular MAPE and a model that does nothing without it.
`Epidemic` is a flag the live system has no way to know. A feature the system cannot
supply at prediction time is useless even if it's predictive. The same test excluded
weather, competitor pricing, region, price, discount, promotion and seasonality. The
reason for each is recorded in `features.EXCLUDED_COLUMNS`, so the code and this document
cannot disagree.

**D5 — Gradient boosting (HistGradientBoostingRegressor), not an LSTM.**
- The problem is tabular after feature engineering: 12 hand-built features per row, 60,000
  training rows. Gradient-boosted trees are the strong default for tabular data.
- An LSTM learns per-sequence temporal structure and needs far more history per series than
  20 × 5 series over two years to beat engineered rolling features reliably.
- CPU-only training in about a minute, and inference in milliseconds in a slim container
  (see D14's latency). An LSTM brings a deep-learning runtime into the image for no
  measured gain.
- Explainable: permutation importance shows `roll_mean_7` dominating, which can be
  defended in a presentation. An LSTM's reasoning cannot be shown the same way.
- The measured result met ETR-01 with margin (10.51% vs the 20% target), so the extra
  complexity was not needed.
- The trade-off: trees cannot extrapolate beyond the training range. This caused O1.

**D6 — Baseline is the 30-day rolling mean; MAPE ignores zero-demand rows.**
The naive forecast a shop owner would actually use is "about what I sold last month". That
is `roll_mean_30`, computed with the same shift as D2. MAPE is undefined when actual
demand is 0, so `safe_mape()` excludes those rows. MAE is reported alongside MAPE so the
exclusion hides nothing.

**D7 — Label is mean daily demand over the next 7 days.**
A single day is too noisy to forecast and too short to reorder against. Seven days matches a
weekly restock cycle, and "units per day" converts directly into days-until-stockout
(on hand ÷ daily demand) and a reorder quantity.

**D8 — Category codes come from a mapping stored in the model artefact.** _(Mon 28)_
Previously `category_code` was `astype("category").cat.codes`, which numbers whatever
categories happen to be in the frame. At serving time the frame holds one item, so every
item would get code 0, whatever its category. `category_mapping()` builds a sorted
name → code map at training time. `build_features()` leaves it in
`df.attrs["category_map"]`, and `train.py` saves it in the artefact. Sorted order gives the same
codes `cat.codes` did, so retraining reproduced identical metrics (evidence re-run Mon 28).

**D9 — Serving builds its feature vector through `features.build_features()`.** _(Mon 28)_
`app.serving_features()` lays the supplied `dailySales` out as consecutive days ending the
day before `asOfDate`. It appends a placeholder row for `asOfDate` and runs the same
`build_features()` training uses. Thanks to D2's shift, the placeholder's own sales value is never
read. `check_parity.py` compares 194 random training rows against the serving path given
only the 60 prior days: 194/194 identical (`evidence/model-serving-parity.txt`).

**D10 — Fewer than 30 days of history returns HTTP 422 `{"error": "insufficientHistory"}`.** _(Mon 28, ETR-03)_
This matches the submitted sequence diagram. The 30-day rolling features are not meaningful
on less, and a confident-looking number built on 10 days of history is worse than no number. FastAPI
also uses 422 for malformed request bodies, but those return `{"detail": [...]}`. The API
tells the two apart by the `error` key.

**D11 — Confidence is a heuristic, flagged at 0.6, not acted on by the model service.** _(Mon 28, ETR-03)_
`confidence = 1 / (1 + CV)` over the last 30 days, where CV = std ÷ mean of daily sales.
It is **not a probability** and not a calibrated interval. It is a score that falls as
recent demand gets more erratic. CV 0 → 1.0, CV 1 → 0.5; the 0.6 threshold means CV ≈ 0.67.
No recent sales → 0. The response carries `lowConfidence: true` below 0.6. Applying the
fallback is the API's job, per the sequence diagram. Smoke test: a steady item scored
0.952, an erratic one 0.411 and was flagged. `lowConfidence` is the field name chosen
(confirmed). **Amended by D31:** CV is now computed on weekly totals, not daily sales.

**D12 — `daysSinceRestock` is supplied by the caller and overrides the fallback.** _(Mon 28)_
In training, the Kaggle data records restocks, so `build_features()` derives this feature.
At serving time it has no restock rows and would fall back to a counter. The API can compute
the true value from the transaction log (last inbound movement), so the supplied value is used.

**D13 — `asOfDate` is the day being predicted; `dailySales` ends the day before.** _(Mon 28)_
It defaults to the service's today. The container clock is UTC, while South Africa is UTC+2,
so between 00:00 and 02:00 SAST the default is yesterday. The API should always send
`asOfDate` explicitly.

**D14 — Models are cached in memory; the default is preloaded at startup.** _(Mon 28)_
Each `.joblib` is read once and kept in a dict keyed by model id. The default model
(`v1.0-base`) is loaded when the service starts, so the first request doesn't pay the
load cost, and `/health` reports whether it loaded. The model id becomes a file name, so it is
validated against a strict pattern and `..` is rejected. Unknown ids return 404.
Measured: p95 72.9 ms over 100 sequential requests (`evidence/latency-p95.txt`).

**D15 — Simplicity over layering in the API.** _(brief)_
Controllers call EF Core directly. There is no repository/service/mediator stack, no
AutoMapper and no CQRS. The system has one client and five features, and every extra
layer is code to explain without a requirement to justify it. The UML's InventoryRepository
component is the EF Core `DbContext` class, named `InventoryRepository`. It is the data-access
component, not an extra pattern on top of EF Core (O3).

**D16 — Default model is `v1.1-relative`, a scale-free ratio model.** _(Mon 28, resolves O1)_
v1.0-base predicts demand in absolute units, and its output is bounded by the Kaggle training
range (O1): a 3/day item was forecast at 44. v1.1-relative predicts **the ratio of
next-7-day mean demand to the item's own 30-day mean**. At serving time that ratio is
multiplied by the item's 30-day mean.
- The label alone is not enough. With absolute features (`roll_mean_7` etc.) the trees would
  still split on volume. So every volume feature is divided by the 30-day mean too
  (`features.RELATIVE_FEATURE_COLUMNS`, `add_relative_features()`), and `roll_mean_30`
  itself is left out. Scaling an item's whole history by k then scales the forecast by k.
  `build_features()` is unchanged, so v1.0 is untouched.
- Evaluated on the same chronological test period (2023-09-03 to 2024-01-29, 14,900 rows)
  in absolute units, against the same 30-day-average baseline:

  | Model | MAPE | MAE | Baseline MAPE | Improvement |
  |---|---|---|---|---|
  | v1.0-base | 10.51% | 8.04 | 22.18% | 52.6% |
  | v1.1-relative | 10.53% | 8.23 | 22.18% | 52.5% |

- Flat-history scale check (`evidence/model-scale-check.txt`):

  | Flat units/day | 3 | 10 | 30 | 90 | 300 |
  |---|---|---|---|---|---|
  | v1.0-base | 44.13 (+1371%) | 44.13 (+341%) | 45.90 (+53%) | 89.29 (−1%) | 148.36 (−51%) |
  | v1.1-relative | 2.87 (−4%) | 9.57 (−4%) | 28.71 (−4%) | 86.13 (−4%) | 287.11 (−4%) |

  The constant −4% is the model's learned expectation for a flat history on that date, the
  same at every scale, which is what scale-free means. Poisson histories at a 3, 10 and 30/day
  mean were forecast at 2.97, 10.64 and 28.20.
- Decision rule set in advance: default to v1.1 if MAPE ≤ 20% and it beats the baseline by
  ≥ 10%. Both were met, so the default was switched (`DEFAULT_MODEL_ID`). The fallback plan, a
  guard in the API that bypasses the model outside its training range, was not needed.
- The cost is 0.02 percentage points of MAPE on Kaggle-scale data. The gain is that the model
  now works for the shops the project targets.
- v1.0-base stays on disk, unmodified (md5 `c01e9ba4…`), and callable with
  `modelId: "v1.0-base"`. `train.py` now refuses to overwrite an existing artefact without `--force`.
- Parity check for v1.1: 194/194 identical (`evidence/model-serving-parity-v1.1-relative.txt`).
- Known limit: the ratio is undefined when the 30-day mean is 0. Such an item gets a forecast
  of 0 and confidence 0 (D11), which is the right answer for a product that isn't selling.

**D17 — `daysUntilStockOut` is derived in the API, not returned by the model service.** _(Mon 28 — approved change since Assignment 2, for Q1.2)_
The submitted sequence diagram shows ReorderPredictionService returning `daysUntilStockOut`.
The implementation returns only demand (`predictedDailyDemand`, `confidence`,
`lowConfidence`, `modelVersion`, `sufficientHistory`). The StockController computes
`daysUntilStockOut = quantityOnHand ÷ predictedDailyDemand`. Reasons:
- Quantity on hand lives in MySQL and changes with every stock movement. The API already has
  it; the model service would need to be sent it just to divide by it.
- The model service stays a pure function of sales history. The same prediction serves any
  stock level, and the division uses the current quantity, not the one at request time.
- The low-confidence fallback (ETR-03) is applied in the API, so stock-out days have to be
  computed there anyway for the fallback case.
This is a deliberate improvement on the diagram, recorded as an approved change, not a deviation.

**D18 — The schema is owned by SQL scripts, not EF Core migrations.** _(Mon 28)_
`db/init/01-schema.sql` creates the tables, and the MySQL container runs it on first start.
EF Core (Pomelo) maps onto that schema and does not generate it. The FR-04 immutability
triggers, CHECK constraints and the generated `Alert.OpenFlag` column are all plain SQL.
Keeping them in one reviewable file means the rules are visible in one place, and the
database enforces them even against a bug in the API. Table and column names match the UML
classes exactly. `Transaction` is a MySQL keyword, so it is always backtick-quoted.
Inheritance is table-per-type: `BusinessOwner` and `Supplier` share `RegisteredUser`'s key.

**D19 — FR-04 immutability is enforced by the database.** _(Mon 28)_
`BEFORE UPDATE` and `BEFORE DELETE` triggers on `Transaction` raise SQLSTATE 45000. A wrong
entry is corrected with a new `Adjustment` row, the way an accounting ledger is. CHECK
constraints make a Sale negative and a Restock positive, and keep stock from going negative.
`QuantityAfter` stores the running balance, so the log can be audited against
`StockItem.QuantityOnHand`. `db/verify.sh` proves both hold (0 mismatches over 5,570 rows) and
that 7 forbidden statements are rejected.

**D20 — FR-03 delete is a soft delete.** _(Mon 28)_
`StockItem.IsActive = 0`. A hard delete would have to delete the item's transactions, which
D19 forbids, and the foreign key blocks it anyway (tested).

**D21 — FR-05: one open alert per item, raised at or below the reorder level.** _(Mon 28)_
An alert is raised when a movement takes `QuantityOnHand` to or below `ReorderLevel`, and
resolved when a restock takes it back above. A unique key on `(StockItemId, OpenFlag)`, where
`OpenFlag` is 1 while unresolved and NULL after, stops duplicates at the database level. The
seed generator applies the same rule, so seeded alert history is consistent with what the
API will produce.

**D22 — Passwords use ASP.NET Core Identity's `PasswordHasher` (v3: PBKDF2-HMAC-SHA512, 100,000 iterations).** _(Mon 28, FR-02)_
It is part of the ASP.NET Core shared framework, so it needs no extra package, and its format is
documented. The seed generator produces compatible hashes with Python's standard library.
Test credentials for the seeded users are in the header of `db/init/02-seed.sql`.

**D23 — Seed data is simulated, not hand-written.** _(Mon 28)_
`db/seed/generate_seed.py` simulates 120 days of Nomvula's Spaza (Khayelitsha, 22 items) and
60 days of Sipho's Tuck Shop (Soshanguve, 6 items, there to prove owners see only their own
stock), from a fixed random seed. It includes weekday and month-end payday and grant-day
peaks, bakery deliveries Mon–Sat, and wholesaler trips on Mon and Thu that are skipped on public holidays.
The missed Heritage Day trip (Thu 24 Sep) is why 8 items are low at the end. It also
simulates load-shedding weeks for candles, winter demand for paraffin, lost sales at a
stock-out, and one item added on 14 Sep so it has too little history. Everything is
Groceries (O2). Real brand names are used for product names only; the shops, owners and
suppliers are fictional, with `.test` email domains.

**D24 — API shape: two controllers, EF Core used directly.** _(Mon 28)_
`AuthController` handles `POST /api/auth/login` (FR-02). `StockController`
(`[Authorize(Roles = "BusinessOwner")]`) handles everything else under `/api/stock`:
list/get/create/update/delete (FR-03), `POST` and `GET /{id}/movements` (FR-04),
`GET /alerts` (FR-05), and `POST` / `GET /{id}/prediction` (FR-08). Both use the
`InventoryRepository` DbContext directly (D15). The movement and reorder rules are pure static
functions (`Domain/StockRules.cs`, `Domain/ReorderCalculator.cs`). That isn't a layer: it's
what makes them unit-testable without a database. Swagger UI is at `/swagger`.

**D25 — ETR-03 threshold-based advice: the exact rule.** _(Mon 28; formula fixed Mon 28 evening)_
ETR-03 requires "threshold-based advice" when the model cannot be relied on, and doesn't
define the arithmetic. This is the definition the system implements:

Let *s₁ … sₙ* be the item's units sold per day, oldest first, for the *n* complete days before
today (*n* ≤ 60, starting the day after the item was created; days with no sale count as 0).
Let *Q* be quantity on hand and *R* the reorder level.

1. **Which path.** The model path is used if and only if the model service answers HTTP 200
   **and** `lowConfidence` is false (confidence *c* ≥ 0.6, D31). Otherwise the
   recommendation is threshold-based advice, and the reason is recorded:
   `insufficientHistory` (model returned 422, *n* < 30), `lowConfidence` (*c* < 0.6), or
   `modelUnavailable` (any other status, timeout, or unreachable).
2. **Daily demand *d*.**
   - Model path: *d* = the model's `predictedDailyDemand`.
   - Threshold-based advice: *d* = (1/*m*) · Σ *sᵢ* over the last *m* = min(30, *n*) days,
     i.e. the 30-day average sales, or the average of whatever history exists under 30 days.
     This is the same naive baseline the model was evaluated against (D6).
3. **The same arithmetic on both paths (D26):**
   days until stock-out = round(*Q* / *d*, 1), or none if *d* = 0;
   recommended quantity = max(0, ⌈7·*d* + *R* − *Q*⌉).
4. **Alerts are separate.** The `ReorderLevel` threshold raises low-stock alerts (FR-05)
   on both paths. The fallback changes only the demand estimate.

**How a reader can tell the paths apart.** Every prediction response carries
`recommendationSource` (`"model"` or `"thresholdBasedAdvice"`, in ETR-03's words),
`fallbackReason`, and a plain-language `basis` line, for example:
- `Model forecast (v1.1-relative), confidence 0.77`
- `Threshold-based advice: 30-day average sales, because the model's confidence 0.44 is below 0.6`
- `Threshold-based advice: average sales over 13 days, because the model needs at least 30 days of history`

The client should show `basis` next to the recommendation, so a screenshot shows which path
produced it. `UsedFallback` and `FallbackReason` are stored on every `ReorderPrediction` row.
A model outage degrades the advice and never breaks the screen.

**D26 — Reorder arithmetic.** _(Mon 28)_
`daysUntilStockOut = quantityOnHand ÷ dailyDemand` (null if demand is 0), and
`recommendedQuantity = ⌈7 × dailyDemand + ReorderLevel − quantityOnHand⌉`, never negative.
That's a week's forecast demand (one wholesaler cycle, and the model's 7-day horizon) and still
above the reorder level after it. Pack sizes are not rounded to, because they live in
SupplierListing (FR-06/07, Partial).
The 7-day cover assumes goods keep. That fails for perishables: see limitation **L1**.

**D27 — The model's input is built from the transaction log.** _(Mon 28)_
`dailySales` = units sold per day for up to 60 days ending yesterday, oldest first, with 0 for days
with no sale. It starts the day after the item was created, because the creation day is partial. Today is
excluded because it is not over. `daysSinceRestock` comes from the last `Restock` row (D12), and
`asOfDate` is always sent (D13). The integration test checks that the series sums to the Sale
rows in the database.

**D28 — Ownership: another owner's stock answers 404.** _(Mon 28)_
Every query is filtered to the signed-in owner. Asking for another owner's item returns 404,
not 403, so the API doesn't confirm the item exists. Suppliers can log in (FR-02) but get 403 on
`/api/stock`, because there's no supplier interface yet.

**D29 — Concurrency and time.** _(Mon 28)_
Recording a movement locks the stock item row (`SELECT … FOR UPDATE`) inside a database
transaction, so two sales recorded at the same moment can't both read the same balance.
Times are South African wall-clock time, UTC+2 fixed (SA has no daylight saving), matching the
seed data.

**D30 — Integration tests use a real MySQL database, not an in-memory fake.** _(Mon 28)_
`intellistock_test` is rebuilt from `db/init/01-schema.sql` and `02-seed.sql` at the start of
each run. So the triggers, CHECK constraints and unique keys under test are the real ones, and an
EF in-memory provider would not have them. Only the model service is replaced, by a stub, so each
ETR-03 path can be forced. The real model is exercised by `api/smoke_test.py`.

**D31 — Confidence is measured on weekly totals, not daily sales.** _(Mon 28 evening, resolves O4; amends D11)_
The formula is *c* = 1 / (1 + σ_w / μ_w). The *w_k* are non-overlapping 7-day sales totals counted
back from the most recent day, over *K* = min(8, ⌊*n*/7⌋) weeks (an incomplete oldest week is dropped).
σ_w is the population standard deviation of the *w_k*, μ_w their mean, and *c* = 0 if μ_w = 0.
`lowConfidence` is *c* < 0.6, and the threshold is unchanged.
- Why: the model forecasts mean demand over the next 7 days, so week-to-week variability
  is what matters. Daily counts of a slow mover are mostly Poisson noise. A steady 2-a-day item
  has a daily CV of about 0.7, so it was always flagged whatever its real predictability.
- Measured through the API on all 22 seeded items (`evidence/confidence-before-after.txt`):

  | | Model used | lowConfidence fallback | insufficientHistory |
  |---|---|---|---|
  | Before (daily CV) | 11 | 10 | 1 |
  | After (weekly CV) | 21 | 0 | 1 |

- Genuine volatility is still caught. A synthetic week-to-week surge-and-slump history scores
  0.466 and is flagged (`model-service-smoke.txt`). The candles, whose 8-week window includes a
  load-shedding spike, now score **0.62**: just above the threshold, so the model is used. So no
  seeded item currently shows the low-confidence path. It is exercised by the tests and the
  model smoke test instead. This wasn't tuned away, and the seed wasn't adjusted to force it.
- The old smoke-test "erratic" case, alternating on a 10-day cycle, now scores 0.91. That is
  correct, because its weekly totals barely move. It was replaced by a week-to-week volatile case.
- Latency after the change: p95 84.9 ms on a first run just after a container rebuild, and
  72.7 ms on the re-run that is recorded. The change adds a reshape and a sum.

**D32 — AuthController is added to the component diagram.** _(Mon 28 — approved change since Assignment 2, for Q1.2)_
The submitted component diagram lists InventoryDashboard, StockController, InventoryRepository
and ReorderPredictionService. FR-02 needs a login endpoint that works *before* the user is
signed in, and StockController is restricted to signed-in Business Owners
(`[Authorize(Roles = "BusinessOwner")]`). So login gets its own component, `AuthController`
(`POST /api/auth/login`), which issues the JWT that StockController requires. It reads users
through InventoryRepository like StockController does. The diagram is updated to add
AuthController between InventoryDashboard and InventoryRepository. Recorded as an approved
change, not a deviation.

---

## 2a. Known limitations (for Assignment 3 Q5.4 and Assignment 4 Q4.3)

**L1 — The reorder formula assumes goods keep; perishables get a week's order.**
- *What happens:* recommended quantity covers 7 days of demand for every item (D26). For
  Albany Brown Bread 700g (22.1 loaves/day forecast, 0 on hand, reorder level 6), the
  end-to-end run recommends **161 loaves** (`evidence/api-endpoints.txt`). Bread is delivered
  by the bakery every morning and is stale within about 2–3 days, so most of that order would
  be thrown away. The same applies to milk, amasi and eggs, at longer shelf lives.
- *Why:* the cover period stands in for the wholesaler cycle and matches the model's 7-day
  horizon. It is a sound assumption for maize meal or tinned fish and a false one for fresh goods.
  The forecast is fine; the arithmetic built on it isn't.
- *Corrective action:* add a per-item shelf-life field, `StockItem.ShelfLifeDays` (nullable,
  null = keeps), and cap the cover period by it:
  recommended quantity = max(0, ⌈*d* · min(7, *L*) + *R* − *Q*⌉), where *L* = ShelfLifeDays.
  For bread (*L* = 2) the same forecast gives ⌈22.1 × 2 + 6 − 0⌉ = **51 loaves**. That's two
  days' demand plus the reorder level, in line with daily bakery deliveries. It needs one
  column, one line in `ReorderCalculator.RecommendedQuantity`, and a field on the stock form,
  and it is planned for Assignment 4.

**L2 — Accuracy was measured at Kaggle scale, not at spaza scale.** The 10.53% MAPE comes from a
held-out period of the Kaggle retail data (median 84 units/day). At spaza volumes the evidence
is that the forecast *follows the item's own level* (−4% at every scale, D16), not a measured
MAPE. There is no real spaza sales history to measure against. *Corrective action:* re-evaluate
on a pilot shop's own transaction log once it has a few months of history, and retrain on it.

**L3 — Confidence is a heuristic, not a probability.** It reflects week-to-week variability
(D31). It isn't calibrated against forecast error, and the 0.6 threshold is a judgement call.
The candles sit at 0.62, just above it. *Corrective action:* once real forecast errors
accumulate in `ReorderPrediction`, calibrate the threshold against observed error.

**L4 — The seed data is simulated.** It is realistic by construction (D23) and verified for
consistency, but it isn't real trading data. Screens and predictions demonstrate behaviour,
not real-world accuracy.

---

## 3. File guide

| Path | What it is |
|---|---|
| `model-service/src/features.py` | Feature engineering, shared by training and serving. Column exclusions and their reasons. |
| `model-service/src/train.py` | Trains the model, evaluates it against the baseline, writes the artefact and evidence. |
| `model-service/app.py` | ReorderPredictionService — the FastAPI app. |
| `model-service/src/check_parity.py` | Proves serving features equal training features. |
| `model-service/src/measure_latency.py` | 100 timed `POST /predict` requests → `evidence/latency-p95.txt`. |
| `model-service/src/smoke_test.py` | Every endpoint and error path → `evidence/model-service-smoke.txt`. |
| `model-service/src/check_scale.py` | Flat and Poisson histories at several volumes, per model → `evidence/model-scale-check.txt`. |
| `model-service/src/inspect_dataset.py` | Checks a CSV is usable for training. |
| `model-service/src/eda.py` | Exploratory analysis, demand profile. |
| `model-service/src/make_synthetic.py` | Stand-in data with the Kaggle file's shape. |
| `model-service/models/v1.1-relative.joblib` | Default model artefact: model, feature columns, target type, category map, metrics (git-ignored). |
| `model-service/models/v1.0-base.joblib` | Original absolute model, kept unmodified (git-ignored). |
| `db/init/01-schema.sql` | Schema: 8 tables named after the UML classes, triggers, constraints. |
| `db/init/02-seed.sql` | Seed data. Generated; do not edit by hand. Test logins in its header. |
| `db/seed/generate_seed.py` | Simulates the spaza-shop history and writes `02-seed.sql`. |
| `db/verify.sql`, `db/verify.sh` | Consistency checks and constraint tests → `evidence/db-verification.txt`, `evidence/schema.sql`. |
| `api/IntelliStock.Api/Controllers/` | `AuthController` (FR-02), `StockController` (FR-03/04/05/08). |
| `api/IntelliStock.Api/Data/InventoryRepository.cs` | The EF Core DbContext, i.e. the UML InventoryRepository component. |
| `api/IntelliStock.Api/Models/` | One class per UML class. |
| `api/IntelliStock.Api/Domain/` | Pure rules: movements and alerts (`StockRules`), reorder arithmetic (`ReorderCalculator`), SA time (`Clock`). |
| `api/IntelliStock.Api.Tests/` | `Unit/` (no database) and `Integration/` (real MySQL, stub model). |
| `api/smoke_test.py` | End-to-end check against the running stack → `evidence/api-endpoints.txt`. |
| `api/confidence_check.py` | Which path every seeded item's recommendation takes → `evidence/confidence-before-after.txt`. |
| `docker-compose.yml` | MySQL 8 (host port 3308), model service (8000), API (5000); client to be added. |
| `evidence/` | Everything Assignment 3 cites. Checklist in `evidence/README.md`. |

---

## 4. Session log

**Sun 20 Sep** — Repository scaffold (`10618d0`).

**Mon 21 Sep** — Dataset inspection, EDA, feature engineering, training and evaluation.
MAPE 10.51% vs 22.18% baseline (`86de1ea`).

**Mon 28 Sep**
- Found `train.py` broken by a bad paste (a `category_map` entry inside `len()`). Restored
  the `out()` line and put `category_map` in the artefact dict (D8). `build_features()`
  now sets `df.attrs["category_map"]`.
- Retrained: metrics identical to Mon 21. MAPE 10.51%, baseline 22.18%, improvement 52.6%,
  MAE 8.04 vs 15.18, test period 2023-09-03 to 2024-01-29, 14,900 rows.
- Wrote `app.py` (D9–D14). Parity check 194/194 identical. Smoke test 8/8, including the
  422 and a path-traversal attempt. Latency p95 72.9 ms (p50 56.8 ms, max 86.0 ms) in the
  Docker Compose container.
- `measure_latency.py` did not exist, although it was referred to as if it did. Written
  this session.
- Found O1. Options considered: (1) a guard in the API that bypasses the model outside its
  training range; (2) a scale-free ratio model; (3) seeding only volumes inside the training
  range. Option 3 was rejected because it hides the limitation. Chose 2, timeboxed to an
  hour, with 1 as the fallback if v1.1 missed ETR-01.
- Committed (`b4efa14`) before retraining. While adding the overwrite guard, a
  training run overwrote `v1.0-base.joblib` by mistake. It was restored byte-for-byte from a backup taken
  just before (md5 checked). The guard now prevents this.
- Trained v1.1-relative: MAPE 10.53%, baseline 22.18%, 52.5% improvement. The scale check
  shows −4% at every volume. Made it the default (D16). Latency with v1.1 default: p95
  69.9 ms (v1.0 run kept as `evidence/latency-p95-v1.0-base.txt`). Smoke test 9/9.
- Recorded D17: `daysUntilStockOut` moves from the model service to the API.
- Build freeze is today; Assignment 3 is due Wed 30 Sep. Priority from here: database →
  API → Angular, as a thin working slice.
- Database: schema (D18–D21), password hashing (D22), seed generator (D23). First seed run
  left 8 items at exactly 0, because the simulated owner kept too thin a buffer. That censors
  demand (a stock-out records 0 sales), so a safety buffer was added. Now only bread sells
  out, on Sundays with no bakery, and candles during load shedding.
- Host ports 3306 (a local MySQL80 service) and 3307 (another project's container) were
  taken, so MySQL is published on **3308**. Port 4200, planned for the Angular client, is also
  taken by another project's container.
- `db/verify.sh`: 0 mismatches on all three consistency checks. All 7 forbidden statements
  are rejected by the database.
- Ran every seeded item through the model service: good forecasts (bread 22.3 against a
  23.1/day average, chips 21.0 against 21.1), the new item → 422, but 10 of 22 flagged
  low-confidence. Recorded as O4.
- Scope confirmed: Assignment 3 (Wed 30) grades documentation and evidence of what exists.
  The prototype is graded in Assignment 4 (from 3 Oct). Tonight: finish the API and stop.
- API (D24–D30). The test run found one bug in a test, which assumed item ids above 100
  were the second owner's; the API was right. It also found a real bug: timestamps
  serialised with a `Z` (UTC) although they are SA time. Both fixed. 37 unit and 32 integration
  tests pass. Only the .NET 9 SDK is installed on this machine, and it builds the `net8.0`
  target. The .NET 8 runtime is installed; the Docker image uses the official 8.0 SDK.
- Evening: FR-10 defined (order placement and status tracking), marked Not met, deferred.
  Confidence moved to weekly totals (D31): low-confidence fallbacks went from 10 of 22 to 0 of 22.
  The API now labels each recommendation's source (`recommendationSource`, `basis`) and D25
  states the exact threshold-based-advice formula. AuthController recorded as an approved change
  (D32). Limitations written up (L1–L4). 41 unit and 32 integration tests pass; end-to-end
  15/15; model smoke 9/9. Build freeze.
- Fixed the README: schedule dates now match their 2026 weekdays, file tree matches the
  real files, scope note shows FR-01 and FR-06/07 as Partial.

---

## 5. Questions to be ready for

- **Why not a random split?** D1. The number would look better and mean less.
- **How do you know there is no leakage?** D1 (chronological), D2 (shift), D4 (Demand excluded).
- **Why not an LSTM, or deep learning?** D5.
- **Does the model actually work for a spaza shop?** It does now, and the story is worth
  telling (O1 → D16). The first model was bounded to 44–148/day by its training data. The
  fix was to predict a ratio to the item's own average, and the evidence is the scale check:
  −4% at 3/day and at 300/day. Be honest that accuracy was *measured* on Kaggle-scale
  data. What was shown at spaza scale is that the forecast follows the item's own level.
- **Why two models?** D16. The new one had to earn the default by a rule set in advance, and
  the old one was kept so the comparison stays reproducible.
- **Your sequence diagram shows the model returning daysUntilStockOut — why doesn't it?** D17.
- **What does "confidence 0.95" mean?** D11. A variability score, not a probability.
- **How do you know the live system computes the same features as training?** D9 and
  `evidence/model-serving-parity.txt`.
- **What happens with a brand-new product?** Under 30 days of history → 422 (D10) → the
  API shows the fallback instead of a prediction.
- **Why is MAPE computed without zero-demand days?** D6. MAPE is undefined there, and MAE is
  reported alongside so nothing is hidden.
- **Where did 72.9 ms come from?** 100 sequential requests after 5 warm-ups, client wall
  clock, service in Docker on the same machine (`evidence/latency-p95.txt`).
- **Why no repository layer, when the UML shows InventoryRepository?** D15 and O3.
- **How do you know the transaction log really is immutable?** D19. The database rejects
  the UPDATE and DELETE itself (`evidence/db-verification.txt`), so it doesn't depend on
  the API behaving.
- **Is the seed data real?** No, and say so. It is simulated (D23), from a fixed seed, with
  the behaviour of a real spaza shop built in: payday peaks, bakery deliveries, the missed
  Heritage Day trip. It is internally consistent by construction and verified by query.
- **How does the owner know whether a recommendation came from the model?** D25. Every
  response says so (`recommendationSource`, `basis`), and the screen shows the basis line.
- **What's the biggest limitation?** L1. Be concrete: 161 loaves of bread, and the
  one-field fix that makes it 51.
- **Why did you change the confidence measure?** D31: daily noise was mistaken for
  unpredictability. Quote the before/after table.
- **What happens if the model service is down?** D25. The owner still gets a
  recommendation from the 30-day average, labelled as a fallback. The integration tests force
  a 500, a 503 and a refused connection.
- **Why test against real MySQL rather than an in-memory database?** D30.
- **Why does another owner's item give 404 and not 403?** D28.
- **Why are FR-06, FR-07 and FR-09 not fully met?** Scope was cut to protect the core
  prediction flow. They are recorded as Partial/Not met, not omitted.
