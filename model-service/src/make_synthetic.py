"""
Generate a synthetic daily sales dataset with the same shape as the Kaggle
retail inventory dataset.

Purpose: unblock the training pipeline before the real dataset is in place, and
provide the seed data for the MySQL Transaction table later in the build.

Usage:
    python src/make_synthetic.py            # 20 products, 400 days
    python src/make_synthetic.py 30 540     # 30 products, 540 days
"""
import sys
import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)

CATALOGUE = [
    ("Maize meal 10kg", "Staples", 12.0), ("White bread", "Bakery", 26.0),
    ("Full cream milk 2L", "Dairy", 14.0), ("Eggs (tray of 30)", "Dairy", 7.0),
    ("Cooking oil 2L", "Staples", 8.0), ("Rice 2kg", "Staples", 9.0),
    ("Sugar 2.5kg", "Staples", 7.5), ("Tea bags (100s)", "Beverages", 5.0),
    ("Instant coffee 200g", "Beverages", 4.0), ("Cold drink 2L", "Beverages", 18.0),
    ("Bottled water 5L", "Beverages", 6.0), ("Washing powder 2kg", "Household", 5.5),
    ("Dishwashing liquid", "Household", 6.0), ("Toilet paper (9s)", "Household", 8.0),
    ("Bath soap", "Toiletries", 9.0), ("Toothpaste 100ml", "Toiletries", 4.5),
    ("Airtime voucher R20", "Airtime", 22.0), ("Paraffin 1L", "Household", 3.5),
    ("Chips (multipack)", "Snacks", 11.0), ("Sweets (assorted)", "Snacks", 13.0),
    ("Canned beans", "Staples", 6.5), ("Peanut butter 400g", "Staples", 3.0),
    ("Frozen chicken 2kg", "Meat", 5.0), ("Polony 1kg", "Meat", 6.0),
    ("Margarine 500g", "Dairy", 5.5), ("Cereal 500g", "Staples", 3.5),
    ("Juice concentrate 2L", "Beverages", 7.0), ("Candles (6s)", "Household", 4.0),
    ("Matches (10s)", "Household", 3.0), ("Baby nappies", "Baby", 2.5),
]


def generate(n_products=20, n_days=400, start="2025-06-01"):
    products = CATALOGUE[:n_products]
    dates = pd.date_range(start=start, periods=n_days, freq="D")
    rows = []

    for pid, (name, category, base) in enumerate(products, start=1):
        # each product has its own weekly shape and trend
        weekday_factor = RNG.uniform(0.7, 1.4, size=7)
        weekday_factor[4] *= 1.25          # Friday
        weekday_factor[5] *= 1.35          # Saturday
        trend = RNG.uniform(-0.0004, 0.0010)
        noise_scale = RNG.uniform(0.15, 0.35)
        stock = base * 20

        for i, d in enumerate(dates):
            demand = base
            demand *= weekday_factor[d.weekday()]
            demand *= (1 + trend * i)
            # month-end payday lift
            if d.day >= 25 or d.day <= 3:
                demand *= 1.30
            # december lift
            if d.month == 12:
                demand *= 1.20
            demand *= RNG.normal(1.0, noise_scale)
            units = max(0, int(round(demand)))

            # simple restock behaviour so inventory_level is realistic
            restock = 0
            if stock < base * 5:
                restock = int(base * 18)
                stock += restock
            stock = max(0, stock - units)

            rows.append({
                "date": d.date().isoformat(),
                "product_id": f"P{pid:03d}",
                "product_name": name,
                "category": category,
                "units_sold": units,
                "inventory_level": int(stock),
                "units_restocked": restock,
                "unit_price": round(base * RNG.uniform(1.8, 2.6), 2),
            })

    return pd.DataFrame(rows)


if __name__ == "__main__":
    n_products = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    n_days = int(sys.argv[2]) if len(sys.argv) > 2 else 400
    df = generate(n_products, n_days)
    out = "data/synthetic_sales.csv"
    df.to_csv(out, index=False)
    print(f"Wrote {out}")
    print(f"  rows     : {len(df):,}")
    print(f"  products : {df['product_id'].nunique()}")
    print(f"  date range: {df['date'].min()} to {df['date'].max()}")
    print()
    print(df.head(8).to_string(index=False))
