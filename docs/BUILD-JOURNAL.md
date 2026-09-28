# IntelliStock — Build Journal

The record of what was built, why, and what is still open. Decisions are numbered so they
can be cited from the Assignment 3 document ("see D7"). Later decisions never silently
override earlier ones; they reference them.

---

## 1. Current status

_Last updated: Mon 28 Sep 2026._

| Component | UML name | State |
|---|---|---|
| Model training + evaluation | — | **Done.** MAPE 10.51% vs 22.18% baseline (see D1–D7). |
| Model service | ReorderPredictionService | **Done.** `POST /predict`, `GET /health`, `GET /models/{id}`, running in Docker Compose. p95 latency 72.9 ms. |
| MySQL schema + seed | — | Not started. |
| API | StockController, InventoryRepository | Not started. |
| Client | InventoryDashboard | Not started. |

**Requirements**

| ID | Requirement | Status |
|---|---|---|
| FR-01 | Registration | Partial — users seeded, no registration UI |
| FR-02 | Login | To build |
| FR-03 | Stock item CRUD | To build |
| FR-04 | Stock movement, immutable transaction log | To build |
| FR-05 | Low-stock alerts | To build |
| FR-06, FR-07 | Supplier functionality | Partial — supplier data seeded, no supplier interface |
| FR-08 | Reorder prediction | Model service done; API call and UI to build |
| FR-09 | Consolidated reorder plan | Not met — deferred |
| ETR-01 | MAPE ≤ 20% and ≥ 10% better than baseline | Met on the Kaggle test period — but see **O1** |
| ETR-03 | 422 on insufficient history; low-confidence flag | Met in the model service; the fallback itself is the API's job |

**Open issues**

- **O1 — the model cannot predict spaza-shop volumes.** Found Mon 28 while smoke-testing.
  Given flat sales histories, the model's output is bounded to about 44–148 units/day:

  | Flat history (units/day) | 2 | 5 | 10 | 20 | 40 | 80 | 120 | 200 | 300 |
  |---|---|---|---|---|---|---|---|---|---|
  | Predicted | 44.1 | 44.1 | 44.1 | 44.1 | 54.0 | 83.2 | 113.7 | 148.4 | 148.4 |

  Gradient-boosted trees cannot extrapolate beyond the target values seen in training, and
  the Kaggle dataset's daily units sold have a median of 84 (IQR 58–114). A spaza shop
  selling 5 loaves a day would be forecast at 44. The 10.51% MAPE is true for the test
  period it was measured on and says nothing about low-volume items. **Needs a decision**
  before seed data is written — options are in the session log for Mon 28.
- **O2 — category vocabulary.** The model knows five categories: Clothing, Electronics,
  Furniture, Groceries, Toys. Any other category string maps to code −1, which the model
  never saw. Seeded stock items should use these names (almost all spaza stock is
  Groceries), or accept −1 knowingly. Permutation importance of `category_code` is 0.017
  against 1.41 for `roll_mean_7`, so the effect is small either way.
- **O3 — InventoryRepository vs "controller calls EF Core directly".** The UML has an
  InventoryRepository component; the build brief rules out a repository layer. Proposed
  reconciliation: the EF Core `DbContext` class is named `InventoryRepository`. To confirm
  before the API is built.

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
layer is code to explain without a requirement to justify it. See O3 for how this
reconciles with the UML.

---

## 3. File guide

| Path | What it is |
|---|---|
| `model-service/src/features.py` | Feature engineering, shared by training and serving. Column exclusions and their reasons. |
| `model-service/src/train.py` | Trains the model, evaluates it against the baseline, writes the artefact and evidence. |
| `model-service/app.py` | ReorderPredictionService — the FastAPI app. |
| `model-service/src/check_parity.py` | Proves serving features equal training features. |
| `model-service/src/measure_latency.py` | 100 timed `POST /predict` requests → `evidence/latency-p95.txt`. |
| `model-service/src/inspect_dataset.py` | Checks a CSV is usable for training. |
| `model-service/src/eda.py` | Exploratory analysis, demand profile. |
| `model-service/src/make_synthetic.py` | Stand-in data with the Kaggle file's shape. |
| `model-service/models/v1.0-base.joblib` | Trained artefact: model, feature columns, category map, metrics (git-ignored). |
| `docker-compose.yml` | MySQL 8 and the model service; api and client to be added. |
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
- Found O1. Options, for decision:
  1. **Guard in the API** — if the item's 30-day mean falls outside the training range,
     use the 30-day-average fallback and say so on screen. Smallest change, no retrain,
     honest. The model is simply not used where it is not valid.
  2. **Scale-free model** — predict demand relative to the item's own 30-day mean (with
     ratio features), so it works at any volume. The proper fix, but it redesigns the
     features and needs a retrain and re-evaluation. The 10.51% figure would change.
  3. **Seed only volumes inside the training range** (40–150/day). Makes screenshots look
     right while hiding the limitation. Not recommended.
- Fixed the README: schedule dates now match their 2026 weekdays, file tree matches the
  real files, scope note shows FR-01 and FR-06/07 as Partial.

---

## 5. Questions to be ready for

- **Why not a random split?** D1. The number would look better and mean less.
- **How do you know there is no leakage?** D1 (chronological), D2 (shift), D4 (Demand excluded).
- **Why not an LSTM, or deep learning?** D5.
- **Does the model actually work for a spaza shop?** O1. Answer honestly: it was validated
  at Kaggle volumes, and the prototype handles low volumes by [the option chosen].
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
- **Why are FR-06, FR-07 and FR-09 not fully met?** Scope was cut to protect the core
  prediction flow. They are recorded as Partial/Not met, not omitted.
