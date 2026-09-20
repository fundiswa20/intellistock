# IntelliStock

Intelligent inventory and supplier comparison platform for small and medium enterprises.

ISJ107V Integrated Software Project — Fundiswa Khanyi, student number 221447646.

IntelliStock lets an SME owner record stock movements, see what is running low and
compare supplier prices. A demand-forecasting model trained on the business's own
transaction history predicts when each product will run out and how much to reorder.

## Project structure

```
intellistock/
├── model-service/        Python — the trained demand-forecasting model
│   ├── src/
│   │   ├── inspect_dataset.py   check a CSV is usable for training
│   │   ├── make_synthetic.py    generate stand-in data with the same shape
│   │   ├── features.py          feature engineering          (Mon 21)
│   │   ├── train.py             training + artefact export    (Mon 21)
│   │   └── evaluate.py          MAPE vs baseline, latency     (Mon 21–Tue 22)
│   ├── data/             datasets (git-ignored)
│   ├── models/           trained artefacts (git-ignored)
│   └── app.py            FastAPI service exposing POST /predict   (Tue 22)
├── api/                  ASP.NET Core 8 Web API                   (Thu 24)
├── client/               Angular 17 client                        (Sat 26)
├── db/init/              MySQL schema and seed data               (Wed 23)
├── evidence/             test output, screenshots, metrics for Assignment 3
├── docs/                 diagrams and written documentation
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

# 3. run the services
cd ..
docker compose up --build
```

| Service | URL |
|---|---|
| Model service | http://localhost:8000/docs |
| API | http://localhost:5000 (from 24 Sep) |
| Client | http://localhost:4200 (from 26 Sep) |
| MySQL | localhost:3306 |

## Dataset

The base model trains on a public Kaggle retail store inventory and sales dataset.
The required columns are a date, a product identifier and units sold; category and
inventory level improve accuracy where present. Run `inspect_dataset.py` against any
candidate file to confirm it is usable before committing to it.

`make_synthetic.py` produces a file with the same shape, so training, evaluation and
the API can all be developed and tested without waiting on the download.

## Build schedule

| Date | Deliverable |
|---|---|
| Sun 21 Sep | Repository scaffold, dataset inspection, synthetic data |
| Mon 22 Sep | Feature engineering, model training, evaluation against baseline |
| Tue 23 Sep | Model wrapped in FastAPI, containerised, latency measured |
| Wed 24 Sep | MySQL schema, migrations, seeded transactions |
| Thu 25 Sep | API — auth, stock items, movements, alerts |
| Fri 26 Sep | API — reorder prediction endpoint, unit and integration tests |
| Sat 27 Sep | Angular client — login, stock list, item detail, alerts |
| Sun 28 Sep | Full system run, capture all evidence |
| Mon 29 Sep | Build freeze. Diagrams. |
| Tue 30 Sep | Write and compile Assignment 3 |

## Scope note

FR-01 to FR-05 and FR-08 are built. Supplier-side functionality (FR-06, FR-07) is
seeded directly into the database rather than given its own interface, and the
consolidated reorder plan (FR-09) is deferred. These are recorded as Partial or
Not met in the Assignment 3 traceability matrix.
