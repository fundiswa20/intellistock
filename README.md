# IntelliStock

Intelligent inventory and supplier comparison platform for small and medium enterprises.

ISJ107V Integrated Software Project — Fundiswa Khanyi, student number 221447646.

IntelliStock lets an SME owner record stock movements, see what is running low and
compare supplier prices. A demand-forecasting model trained on the business's own
transaction history predicts when each product will run out and how much to reorder.

## Project structure

```
intellistock/
├── model-service/        Python — ReorderPredictionService, the demand-forecasting model
│   ├── src/
│   │   ├── inspect_dataset.py   check a CSV is usable for training
│   │   ├── make_synthetic.py    generate stand-in data with the same shape
│   │   ├── eda.py               exploratory analysis of the dataset
│   │   ├── features.py          feature engineering, shared by training and serving
│   │   ├── train.py             training, evaluation vs baseline, artefact export
│   │   ├── check_parity.py      proves serving builds the same features as training
│   │   ├── check_scale.py       forecasts at 3–300 units/day, per model
│   │   ├── smoke_test.py        every endpoint and error path
│   │   └── measure_latency.py   times 100 POST /predict requests
│   ├── data/             datasets (git-ignored)
│   ├── models/           trained artefacts (git-ignored): v1.1-relative (default), v1.0-base
│   └── app.py            FastAPI service: POST /predict, GET /health, GET /models/{id}
├── api/                  ASP.NET Core 8 Web API
├── client/               Angular 17 client
├── db/init/              MySQL schema (01) and generated seed data (02)
├── db/seed/              seed data generator
├── evidence/             test output, screenshots, metrics for Assignment 3
├── docs/                 BUILD-JOURNAL.md, diagrams and written documentation
└── docker-compose.yml    runs the whole system locally
```

## Prerequisites

- Docker Desktop
- Python 3.11+ (for running training outside the container)
- .NET 8 SDK
- Node.js 20+
- MySQL Workbench (optional, for inspecting the database)

## Getting started

```bash
git clone <repo-url>
cd intellistock

# 1. generate stand-in data so the pipeline runs before the real dataset lands
cd model-service
pip install -r requirements.txt
python src/make_synthetic.py 20 400

# 2. once the Kaggle dataset is downloaded into model-service/data/
python src/inspect_dataset.py data/<downloaded-file>.csv

# 3. run the services (MySQL loads db/init/*.sql on first start)
cd ..
docker compose up --build

# API tests (needs the db container running)
cd api && dotnet test && cd ..
python api/smoke_test.py          # end-to-end, needs the whole stack

# optional: regenerate seed data, then verify the database
python db/seed/generate_seed.py
bash db/verify.sh
```

| Service | URL |
|---|---|
| Model service | http://localhost:8000/docs |
| API | http://localhost:5000 (Swagger UI at /swagger) |
| Client | http://localhost:4200 (not built yet) |
| MySQL | localhost:3308 (container port 3306; set DB_PORT to change) |

## Dataset

The base model trains on a public Kaggle retail store inventory and sales dataset.
The required columns are a date, a product identifier and units sold; category and
inventory level improve accuracy where present. Run `inspect_dataset.py` against any
candidate file to confirm it is usable before committing to it.

`make_synthetic.py` produces a file with the same shape, so training, evaluation and
the API can all be developed and tested without waiting on the download.

## Build schedule

| Planned | Deliverable | Status |
|---|---|---|
| Sun 20 Sep | Repository scaffold, dataset inspection, synthetic data | Done Sun 20 |
| Mon 21 Sep | Feature engineering, model training, evaluation against baseline | Done Mon 21 |
| Tue 22 Sep | Model wrapped in FastAPI, containerised, latency measured | Done Mon 28 |
| Wed 23 Sep | MySQL schema, migrations, seeded transactions | Done Mon 28 |
| Thu 24 Sep | API — auth, stock items, movements, alerts | Done Mon 28 |
| Fri 25 Sep | API — reorder prediction endpoint, unit and integration tests | Done Mon 28 |
| Sat 26 Sep | Angular client — login, stock list, item detail, alerts | Minimal two-screen client Tue 29; full client for Assignment 4 |
| Sun 27 Sep | Full system run, capture all evidence | Not started |
| Mon 28 Sep | Build freeze. Diagrams. | — |
| Tue 29 Sep | Write and compile Assignment 3 | — |

Weekdays are for 2026. An earlier version of this table paired each weekday with the
following day's date; the dates were corrected to match the weekdays, which is what the
rest of the plan used.

## Scope note

In scope and built: FR-02 login, FR-03 stock item CRUD, FR-04 stock movements with an
immutable transaction log, FR-05 low-stock alerts, FR-08 reorder prediction. All five are
implemented and tested in the API; client screens follow (see the traceability table in
`docs/BUILD-JOURNAL.md`).

Partial:
- FR-01 registration — users are seeded; there is no registration UI.
- FR-06, FR-07 — supplier data is seeded directly into the database; there is no
  supplier interface.

Not met:
- FR-09 — consolidated reorder plan, deferred.
- FR-10 — order placement and status tracking, deferred; ordering is not part of the
  prototype scope.

These are recorded the same way in the Assignment 3 traceability matrix. See
`docs/BUILD-JOURNAL.md` for current status.
