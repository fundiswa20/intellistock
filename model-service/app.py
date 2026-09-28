"""
ReorderPredictionService - FastAPI wrapper around the trained demand model.

Endpoints (as in the submitted sequence diagram):
    POST /predict        predicted mean daily demand for one stock item   (FR-08)
    GET  /health         liveness, and which models are loaded
    GET  /models/{id}    the stored evaluation metrics of a model artefact

The serving feature vector is built by features.build_features(), the same
function train.py uses, so training and serving cannot drift apart.

Run locally:
    uvicorn app:app --port 8000
"""
import os
import re
import sys
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from features import build_features  # noqa: E402

MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(__file__), "models"))
DEFAULT_MODEL_ID = os.environ.get("DEFAULT_MODEL_ID", "v1.0-base")

MIN_HISTORY_DAYS = 30          # ETR-03: fewer than this and the 30-day features are not meaningful
MAX_HISTORY_DAYS = 730         # only the last 31 days are used; this bounds the payload
CONFIDENCE_THRESHOLD = 0.6     # ETR-03: below this the caller applies the threshold fallback
CONFIDENCE_WINDOW = 30         # days of recent demand the confidence heuristic looks at

MODEL_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")

# loaded artefacts, keyed by model id - each .joblib is read from disk once
_models: dict = {}


def load_model(model_id):
    """Return the artefact for model_id, loading and caching it on first use."""
    if model_id in _models:
        return _models[model_id]
    # the id becomes a file name, so refuse anything that could leave MODEL_DIR
    if not MODEL_ID_PATTERN.fullmatch(model_id) or ".." in model_id:
        raise HTTPException(status_code=404, detail=f"Unknown model '{model_id}'")
    path = os.path.join(MODEL_DIR, f"{model_id}.joblib")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Unknown model '{model_id}'")
    _models[model_id] = joblib.load(path)
    return _models[model_id]


@asynccontextmanager
async def lifespan(_app):
    # load the default model before the first request, so it does not pay the load cost
    try:
        load_model(DEFAULT_MODEL_ID)
    except HTTPException:
        pass  # /health reports it as not loaded
    yield


app = FastAPI(title="IntelliStock ReorderPredictionService", version="1.0", lifespan=lifespan)


class PredictRequest(BaseModel):
    stockItemId: int
    category: str
    dailySales: Annotated[list[Annotated[float, Field(ge=0)]],
                          Field(max_length=MAX_HISTORY_DAYS,
                                description="Units sold per day, oldest first, ending the day before asOfDate")]
    daysSinceRestock: Annotated[int, Field(ge=0)]
    modelId: Optional[str] = None
    asOfDate: Optional[date] = Field(default=None, description="Day being predicted; defaults to today")


class PredictResponse(BaseModel):
    predictedDailyDemand: float
    confidence: float
    lowConfidence: bool
    modelVersion: str
    sufficientHistory: bool


def confidence_from_history(daily_sales):
    """
    Confidence heuristic: 1 / (1 + CV) over the last CONFIDENCE_WINDOW days,
    where CV is the coefficient of variation (std / mean) of daily demand.

    This is NOT a probability and NOT a calibrated prediction interval. It is a
    0-1 score that falls as recent demand becomes more erratic, because erratic
    demand is where a point forecast is least trustworthy. CV = 0 gives 1.0,
    CV = 1 gives 0.5, and the 0.6 threshold corresponds to CV of about 0.67.
    An item with no recent sales scores 0.
    """
    recent = np.asarray(daily_sales[-CONFIDENCE_WINDOW:], dtype=float)
    mean = recent.mean()
    if mean <= 0:
        return 0.0
    cv = recent.std() / mean
    return float(1.0 / (1.0 + cv))


def serving_features(req, as_of, artefact):
    """
    Build the single-row feature vector for as_of using features.build_features().

    The history is laid out as consecutive days ending the day before as_of, and a
    placeholder row is added for as_of itself. build_features() shifts sales by one
    day before rolling, so the placeholder's own units_sold is never read - its
    features come only from the supplied history, exactly as in training.
    """
    n = len(req.dailySales)
    dates = pd.date_range(end=pd.Timestamp(as_of) - pd.Timedelta(days=1), periods=n, freq="D")
    frame = pd.DataFrame({
        "series": str(req.stockItemId),
        "date": list(dates) + [pd.Timestamp(as_of)],
        "units_sold": list(req.dailySales) + [0.0],
        "category": req.category,
        "units_ordered": 0,
    })
    df = build_features(frame, for_training=False, cat_map=artefact.get("category_map", {}))
    row = df[df["date"] == pd.Timestamp(as_of)].copy()
    # the API derives this from the transaction log, which is more accurate than
    # the counter build_features() falls back to when there are no restock rows
    row["days_since_restock"] = req.daysSinceRestock
    return row[artefact["feature_columns"]]


# FR-08: reorder prediction, called by the API's StockController
@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    # ETR-03: too little history is a 422, not a guess
    if len(req.dailySales) < MIN_HISTORY_DAYS:
        return JSONResponse(status_code=422, content={"error": "insufficientHistory"})

    artefact = load_model(req.modelId or DEFAULT_MODEL_ID)
    as_of = req.asOfDate or date.today()

    X = serving_features(req, as_of, artefact)
    demand = max(0.0, float(artefact["model"].predict(X)[0]))
    confidence = confidence_from_history(req.dailySales)

    return PredictResponse(
        predictedDailyDemand=round(demand, 3),
        confidence=round(confidence, 3),
        # ETR-03: flagged, not acted on - the caller applies the threshold fallback
        lowConfidence=confidence < CONFIDENCE_THRESHOLD,
        modelVersion=artefact.get("version", req.modelId or DEFAULT_MODEL_ID),
        sufficientHistory=True,
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "defaultModel": DEFAULT_MODEL_ID,
        "defaultModelLoaded": DEFAULT_MODEL_ID in _models,
        "modelsLoaded": sorted(_models),
    }


@app.get("/models/{model_id}")
def model_info(model_id: str):
    artefact = load_model(model_id)
    return {
        "modelId": model_id,
        "version": artefact.get("version"),
        "trainedAt": artefact.get("trained_at"),
        "featureColumns": artefact.get("feature_columns"),
        "categories": sorted(artefact.get("category_map", {})),
        "metrics": artefact.get("metrics", {}),
    }
