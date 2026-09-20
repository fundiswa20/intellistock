"""
Inspect a retail sales CSV and report whether it can train the IntelliStock model.

Usage:
    python src/inspect_dataset.py data/<file>.csv

Writes a short report to evidence/dataset-inspection.txt so the findings can be
quoted in Assignment 3, Question 4.2.
"""
import sys
import os
import pandas as pd

REQUIRED = {
    "date": ["date", "order_date", "sale_date", "day", "datetime", "invoice_date"],
    "product": ["product_id", "sku", "item_id", "product", "item", "product_name",
                "stock_code", "stockcode"],
    "units_sold": ["units_sold", "quantity", "qty", "sales", "units", "demand",
                   "quantity_sold", "sales_quantity"],
}
OPTIONAL = {
    "category": ["category", "product_category", "department", "family", "type"],
    "inventory": ["inventory_level", "stock", "units_in_stock", "on_hand", "inventory"],
    "price": ["price", "unit_price", "selling_price"],
    "store": ["store_id", "store", "shop_id", "outlet"],
}


def match(columns, candidates):
    lowered = {c.lower().strip().replace(" ", "_"): c for c in columns}
    for cand in candidates:
        if cand in lowered:
            return lowered[cand]
    for key, original in lowered.items():
        for cand in candidates:
            if cand in key:
                return original
    return None


def main(path):
    if not os.path.exists(path):
        print(f"File not found: {path}")
        sys.exit(1)

    df = pd.read_csv(path)
    lines = []

    def out(s=""):
        print(s)
        lines.append(s)

    out("IntelliStock - dataset inspection")
    out("=" * 60)
    out(f"File        : {os.path.basename(path)}")
    out(f"Rows        : {len(df):,}")
    out(f"Columns     : {len(df.columns)}")
    out()
    out("Columns found:")
    for c in df.columns:
        nulls = df[c].isna().sum()
        out(f"  {c:<28} {str(df[c].dtype):<10} nulls={nulls}")
    out()

    out("Required field mapping:")
    mapping, missing = {}, []
    for field, cands in REQUIRED.items():
        col = match(df.columns, cands)
        mapping[field] = col
        if col:
            out(f"  {field:<12} -> {col}")
        else:
            out(f"  {field:<12} -> NOT FOUND")
            missing.append(field)
    out()

    out("Optional field mapping (improve accuracy if present):")
    for field, cands in OPTIONAL.items():
        col = match(df.columns, cands)
        mapping[field] = col
        out(f"  {field:<12} -> {col if col else '-'}")
    out()

    if missing:
        out(f"VERDICT: UNUSABLE - missing {', '.join(missing)}.")
        out("Find another dataset, or map the column manually in features.py.")
    else:
        dcol, pcol = mapping["date"], mapping["product"]
        try:
            dates = pd.to_datetime(df[dcol], errors="coerce")
            span = (dates.max() - dates.min()).days
            out(f"Date range  : {dates.min().date()} to {dates.max().date()} ({span} days)")
        except Exception:
            span = None
            out("Date range  : could not parse the date column")
        n_products = df[pcol].nunique()
        out(f"Products    : {n_products:,}")
        out()
        if span is not None and span < 120:
            out("VERDICT: USABLE BUT SHORT - under 120 days limits the 30-day rolling")
            out("features and leaves little for a held-out test period.")
        else:
            out("VERDICT: USABLE - required fields present with sufficient history.")

    os.makedirs("../evidence", exist_ok=True)
    with open("../evidence/dataset-inspection.txt", "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\nSaved to evidence/dataset-inspection.txt")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python src/inspect_dataset.py data/<file>.csv")
        sys.exit(1)
    main(sys.argv[1])
