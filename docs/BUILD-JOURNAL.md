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
| Model service | ReorderPredictionService | **Done.** `POST /predict`, `GET /health`, `GET /models/{id}`, running in Docker Compose. p95 latency 69.9 ms. |
| MySQL schema + seed | all 8 UML classes | **Done.** 8 tables, FR-04 immutability enforced by triggers, 120 days of spaza-shop history (5,570 transactions). Verified: `evidence/db-verification.txt`. |
| API | StockController, InventoryRepository (+ AuthController, see O5) | **Done.** ASP.NET Core 8, EF Core 8 + Pomelo, JWT. 37 unit + 32 integration tests pass. Runs in Docker Compose on port 5000. |
| Client | InventoryDashboard | Not started. Minimal two-screen client planned for Tue 29 (screenshots and user guide); the full client is for Assignment 4. |

**Requirements**

| ID | Requirement | Status |
|---|---|---|
| FR-01 | Registration | Partial — users seeded, no registration UI |
| FR-02 | Login | API done and tested; UI to build |
| FR-03 | Stock item CRUD | API done and tested; UI to build |
| FR-04 | Stock movement, immutable transaction log | API done and tested, immutability enforced by the database; UI to build |
| FR-05 | Low-stock alerts | API done and tested; UI to build |
| FR-06, FR-07 | Supplier functionality | Partial — supplier data seeded, no supplier interface |
| FR-08 | Reorder prediction | Model service and API done and tested end to end; UI to build |
| FR-09 | Consolidated reorder plan | Not met — deferred |
| ETR-01 | MAPE ≤ 20% and ≥ 10% better than baseline | Met — v1.1-relative 10.53%, 52.5% better than baseline, same test period as v1.0 |
| ETR-03 | 422 on insufficient history; low-confidence flag | Met in the model service; the fallback itself is the API's job |

**Open issues**

- **O4 — the confidence heuristic flags most slow-moving items.** With the seeded spaza
  data, 10 of 22 items come back `lowConfidence` (D11's threshold of 0.6). Candles are
  flagged because load shedding makes their demand erratic, which is right. But
  rice, tea, matches, soap and stock cubes are flagged only because they sell 1–3 a day.
  At that volume, day-to-day Poisson noise alone puts the daily coefficient of variation
  above 0.67, however steady the item really is. The model's own forecasts for them are
  close to their 30-day averages. A proposed fix, **not applied, needs a decision**:
  compute CV on 7-day totals instead of daily sales. That matches the model's 7-day label,
  and summing 7 days cuts the Poisson noise by √7 while keeping real volatility such as the
  candle spikes. Until then, the API's fallback applies to those items (ETR-03 working as
  designed, just more often than it should).

- **O5 — AuthController is not in the UML component list.** FR-02 needs a login
  endpoint, and putting it in StockController would be wrong (StockController is for
  signed-in owners only). The implementation adds `AuthController` (`POST /api/auth/login`).
  **To decide**: add it to the component diagram and record it as an approved change for
  Q1.2 (recommended), or keep the diagram and record it as a deviation.
- **O6 — the meaning of "threshold fallback" (ETR-03).** It is implemented as: when the model
  is not confident, has too little history, or is unreachable, the forecast is replaced by
  the item's 30-day average demand (the baseline from D6), and the reason is stored. The
  item's `ReorderLevel` threshold keeps driving alerts either way (D25). **To check** against
  the wording of ETR-03 in the submitted requirements.

Resolved on Mon 28:

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
0.952, an erratic one 0.411 and was flagged. _`lowConfidence` is the field name chosen.
Check it against the sequence diagram's return message._

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

**D25 — ETR-03 fallback: the 30-day average, with the reason recorded.** _(Mon 28)_
The model's forecast is used only if the model service answered 200 and `lowConfidence` is
false. Otherwise the forecast is the item's average daily sales over the last 30 days (the
same baseline the model was evaluated against, D6), and `FallbackReason` is stored:
`insufficientHistory` (the model's 422), `lowConfidence`, or `modelUnavailable` (error,
timeout or unreachable). The owner always gets a recommendation. A model outage degrades it
and never breaks the screen. See O6.

**D26 — Reorder arithmetic.** _(Mon 28)_
`daysUntilStockOut = quantityOnHand ÷ dailyDemand` (null if demand is 0), and
`recommendedQuantity = ⌈7 × dailyDemand + ReorderLevel − quantityOnHand⌉`, never negative.
That's a week's forecast demand (one wholesaler cycle, and the model's 7-day horizon) and still
above the reorder level after it. Pack sizes are not rounded to, because they live in
SupplierListing (FR-06/07, Partial).
**Known limitation, for Assignment 4:** the 7-day cover is the same for every item. For bread,
delivered daily and perishable, the end-to-end run recommends 161 loaves, which is a week's
demand. A per-item cover period (1 day for bakery items) is the fix.

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
- **What happens if the model service is down?** D25. The owner still gets a
  recommendation from the 30-day average, labelled as a fallback. The integration tests force
  a 500, a 503 and a refused connection.
- **Why test against real MySQL rather than an in-memory database?** D30.
- **Why does another owner's item give 404 and not 403?** D28.
- **Why are FR-06, FR-07 and FR-09 not fully met?** Scope was cut to protect the core
  prediction flow. They are recorded as Partial/Not met, not omitted.
