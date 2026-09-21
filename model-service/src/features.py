"""
Feature engineering for the IntelliStock demand-forecasting model.

The same functions are used at training time and at serving time, so the feature
vector the model is trained on is identical in shape to the one it is asked to
predict from. Drift between those two is the most common cause of a model that
scores well in a notebook and badly in production.
"""
import pandas as pd
import numpy as np

# candidate column names, in the order they are tried
COLUMN_CANDIDATES = {
    "date": ["date", "order_date", "sale_date", "day", "datetime", "invoice_date"],
    "product": ["product_id", "sku", "item_id", "product", "item", "product_name",
                "stock_code", "stockcode"],
    "units_sold": ["units_sold", "quantity", "qty", "sales", "units",
                   "quantity_sold", "sales_quantity"],
    "category": ["category", "product_category", "department", "family", "type"],
    "store": ["store_id", "store", "shop_id", "outlet", "branch"],
    "units_ordered": ["units_ordered", "restock", "units_restocked", "reorder_qty"],
}

# Columns deliberately excluded from the feature set, and why. Recorded here so
# the reasoning is visible in the code and can be cited in the documentation.
EXCLUDED_COLUMNS = {
    "demand": "Target leakage - a pre-computed estimate of the value being predicted.",
    "epidemic": "Not available at inference time; the live system has no such flag.",
    "weather_condition": "Not available at inference time without a weather feed (out of scope).",
    "competitor_pricing": "Not collected by IntelliStock; suppliers self-report their own prices.",
    "region": "Constant within a store, so it adds no signal beyond the store identifier.",
    "price": "Excluded from v1.0 - price effects need a dynamic-pricing model (out of scope).",
    "discount": "Excluded from v1.0 - promotions are not modelled in the current scope.",
    "promotion": "Excluded from v1.0 - promotions are not modelled in the current scope.",
    "seasonality": "Redundant - month and day-of-week features already capture this.",
    "inventory_level": "Supplied live from the StockItem table at inference, not learned from.",
}

ROLLING_WINDOWS = (7, 14, 30)
LABEL_HORIZON = 7          # predict mean daily demand over the next 7 days

FEATURE_COLUMNS = [
    "roll_mean_7", "roll_mean_14", "roll_mean_30",
    "roll_std_7", "roll_std_30",
    "trend_7_30",
    "day_of_week", "day_of_month", "month",
    "is_month_end_window",
    "days_since_restock",
    "category_code",
]


def resolve_columns(df):
    """Map whatever the dataset calls its columns onto the names we use."""
    lowered = {c.lower().strip().replace(" ", "_"): c for c in df.columns}
    resolved = {}
    for field, candidates in COLUMN_CANDIDATES.items():
        found = None
        for cand in candidates:
            if cand in lowered:
                found = lowered[cand]
                break
        if found is None:
            for key, original in lowered.items():
                if any(cand in key for cand in candidates):
                    found = original
                    break
        resolved[field] = found

    missing = [f for f in ("date", "product", "units_sold") if resolved[f] is None]
    if missing:
        raise ValueError(
            f"Dataset is missing required field(s): {', '.join(missing)}. "
            f"Columns present: {list(df.columns)}"
        )
    return resolved


def load_and_standardise(path):
    """Read a sales CSV and return a tidy frame: date, product, units_sold, category."""
    raw = pd.read_csv(path)
    cols = resolve_columns(raw)

    df = pd.DataFrame({
        "date": pd.to_datetime(raw[cols["date"]], errors="coerce"),
        "product": raw[cols["product"]].astype(str),
        "units_sold": pd.to_numeric(raw[cols["units_sold"]], errors="coerce"),
    })
    df["category"] = (raw[cols["category"]].astype(str)
                      if cols["category"] else "uncategorised")

    # A series is one product in one store. Grouping on product alone would merge
    # five stores' demand into a single series and blur the pattern the model
    # needs to learn.
    if cols["store"]:
        df["store"] = raw[cols["store"]].astype(str)
        df["series"] = df["store"] + "|" + df["product"]
    else:
        df["store"] = "single"
        df["series"] = df["product"]

    df["units_ordered"] = (pd.to_numeric(raw[cols["units_ordered"]], errors="coerce").fillna(0)
                           if cols["units_ordered"] else 0)

    df = df.dropna(subset=["date", "units_sold"])
    df["units_sold"] = df["units_sold"].clip(lower=0)

    # collapse to one row per series per day
    df = (df.groupby(["series", "store", "product", "date", "category"], as_index=False)
            .agg(units_sold=("units_sold", "sum"), units_ordered=("units_ordered", "sum"))
            .sort_values(["series", "date"])
            .reset_index(drop=True))
    return df


def build_features(df, for_training=True):
    """
    Add rolling, seasonal and recency features per product.

    for_training=True also adds the label (mean daily demand over the next
    LABEL_HORIZON days) and drops rows where it cannot be computed.
    """
    df = df.sort_values(["series", "date"]).copy()
    g = df.groupby("series")["units_sold"]

    # rolling history — shifted by one day so today's sales never leak into
    # the features used to predict today
    shifted = g.shift(1)
    for w in ROLLING_WINDOWS:
        df[f"roll_mean_{w}"] = (shifted.groupby(df["series"])
                                .rolling(w, min_periods=max(2, w // 3))
                                .mean().reset_index(level=0, drop=True))
    for w in (7, 30):
        df[f"roll_std_{w}"] = (shifted.groupby(df["series"])
                               .rolling(w, min_periods=max(2, w // 3))
                               .std().reset_index(level=0, drop=True))

    # is demand accelerating or slowing
    df["trend_7_30"] = df["roll_mean_7"] / df["roll_mean_30"].replace(0, np.nan)

    # seasonality
    df["day_of_week"] = df["date"].dt.dayofweek
    df["day_of_month"] = df["date"].dt.day
    df["month"] = df["date"].dt.month
    df["is_month_end_window"] = ((df["day_of_month"] >= 25) |
                                 (df["day_of_month"] <= 3)).astype(int)

    # recency: days since this series last received stock. Uses real restock
    # events where the dataset records them, else falls back to a rolling counter.
    if "units_ordered" in df.columns and df["units_ordered"].sum() > 0:
        restocked = df["units_ordered"] > 0
        grp = restocked.groupby(df["series"]).cumsum()
        df["days_since_restock"] = (df.groupby(["series", grp]).cumcount()).astype(int)
    else:
        df["days_since_restock"] = (df.groupby("series").cumcount() % 30).astype(int)

    df["category_code"] = df["category"].astype("category").cat.codes

    if for_training:
        df["label"] = (df.groupby("series")["units_sold"]
                         .shift(-1)
                         .groupby(df["series"])
                         .rolling(LABEL_HORIZON, min_periods=LABEL_HORIZON)
                         .mean().reset_index(level=0, drop=True))
        df = df.dropna(subset=["label"])

    df = df.dropna(subset=[c for c in FEATURE_COLUMNS if c.startswith("roll_mean")])
    df["trend_7_30"] = df["trend_7_30"].fillna(1.0)
    df["roll_std_7"] = df["roll_std_7"].fillna(0.0)
    df["roll_std_30"] = df["roll_std_30"].fillna(0.0)
    return df


def chronological_split(df, test_fraction=0.2):
    """
    Split by date, not at random.

    A random split would put future rows in the training set and inflate the
    measured accuracy, because the model would be learning from days it is
    later asked to predict. ETR-01 requires a chronologically held-out period.
    """
    cutoff = df["date"].quantile(1 - test_fraction)
    train = df[df["date"] <= cutoff]
    test = df[df["date"] > cutoff]
    return train, test, cutoff
