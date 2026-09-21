"""
Exploratory data analysis for the IntelliStock training dataset.

Reports the shape of the raw data and records which columns were kept as model
features and which were excluded, with the reason for each exclusion. The raw
CSV is never modified - every decision is made in code so the pipeline can be
re-run against the original download and reproduce the same result.

Usage:
    python src/eda.py data/sales_data.csv

Writes:
    ../evidence/eda-column-decisions.txt
    ../evidence/eda-demand-profile.png
"""
import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from features import (COLUMN_CANDIDATES, EXCLUDED_COLUMNS, FEATURE_COLUMNS,
                      load_and_standardise, resolve_columns)

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evidence")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    args = ap.parse_args()

    lines = []

    def out(s=""):
        print(s)
        lines.append(s)

    raw = pd.read_csv(args.dataset)
    cols = resolve_columns(raw)
    used_source_cols = {v for v in cols.values() if v}

    out("IntelliStock - exploratory data analysis and column decisions")
    out("=" * 70)
    out(f"Source file : {os.path.basename(args.dataset)}")
    out(f"Raw rows    : {len(raw):,}")
    out(f"Raw columns : {len(raw.columns)}")
    out()
    out("The raw file is used exactly as downloaded. Columns are selected and")
    out("excluded in code (features.py), never by editing the CSV, so the")
    out("pipeline reproduces the same result from the original download.")
    out()

    out("COLUMNS USED")
    out("-" * 70)
    for field, col in cols.items():
        if col:
            out(f"  {col:<24} -> {field}")
    out()

    out("COLUMNS EXCLUDED, WITH REASONS")
    out("-" * 70)
    for col in raw.columns:
        if col in used_source_cols:
            continue
        key = col.lower().strip().replace(" ", "_")
        reason = EXCLUDED_COLUMNS.get(key, "Not required by the v1.0 feature set.")
        out(f"  {col}")
        out(f"      {reason}")
    out()

    out("ENGINEERED FEATURES")
    out("-" * 70)
    out(f"  {len(FEATURE_COLUMNS)} features derived from the columns above:")
    for f in FEATURE_COLUMNS:
        out(f"    - {f}")
    out()

    df = load_and_standardise(args.dataset)
    out("DATA PROFILE AFTER STANDARDISATION")
    out("-" * 70)
    out(f"  Rows                : {len(df):,}")
    out(f"  Series (store+item) : {df['series'].nunique():,}")
    out(f"  Stores              : {df['store'].nunique():,}")
    out(f"  Products            : {df['product'].nunique():,}")
    out(f"  Categories          : {df['category'].nunique():,}")
    out(f"  Date range          : {df['date'].min().date()} to {df['date'].max().date()}")
    out(f"  Days                : {(df['date'].max() - df['date'].min()).days:,}")
    out()
    out("  Units sold per day:")
    d = df["units_sold"].describe()
    for k in ("mean", "std", "min", "25%", "50%", "75%", "max"):
        out(f"    {k:<6} {d[k]:10.2f}")
    zero_pct = (df["units_sold"] == 0).mean() * 100
    out(f"    zero-sales days : {zero_pct:.1f}%")
    out()

    out("  Mean daily units sold by category:")
    for cat, v in df.groupby("category")["units_sold"].mean().sort_values(ascending=False).items():
        out(f"    {cat:<22} {v:8.2f}")
    out()

    dow = df.assign(dow=df["date"].dt.day_name()).groupby("dow")["units_sold"].mean()
    order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    out("  Mean daily units sold by day of week:")
    for day in order:
        if day in dow.index:
            out(f"    {day:<22} {dow[day]:8.2f}")
    out()
    out("  These weekday and category differences are the patterns the rolling")
    out("  and seasonality features are designed to capture.")

    # chart
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axes = plt.subplots(1, 2, figsize=(12, 4.2))
        daily = df.groupby("date")["units_sold"].mean()
        axes[0].plot(daily.index, daily.values, lw=0.8, color="#2E75B6")
        axes[0].set_title("Mean units sold per day")
        axes[0].set_ylabel("units")
        axes[1].bar([d[:3] for d in order],
                    [dow.get(d, 0) for d in order], color="#2E75B6")
        axes[1].set_title("Mean units sold by day of week")
        fig.tight_layout()
        os.makedirs(EVIDENCE_DIR, exist_ok=True)
        fig.savefig(os.path.join(EVIDENCE_DIR, "eda-demand-profile.png"), dpi=150)
        plt.close(fig)
        out()
        out("Saved chart: evidence/eda-demand-profile.png")
    except Exception as e:
        out(f"(chart skipped: {e})")

    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(os.path.join(EVIDENCE_DIR, "eda-column-decisions.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\nSaved evidence/eda-column-decisions.txt")


if __name__ == "__main__":
    main()
