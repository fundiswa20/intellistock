"""
Generate db/init/02-seed.sql - realistic South African spaza-shop data.

Usage:
    python db/seed/generate_seed.py [--end 2026-09-27] [--days 120]

Everything is simulated day by day from a fixed random seed, so the output is
reproducible and internally consistent: every StockItem.QuantityOnHand equals the
sum of its Transaction rows, every Transaction.QuantityAfter is the running balance,
and every Alert was raised and resolved by the same rule the API applies (FR-05).

What the simulation models, so the screens and the model have something real to show:
- demand: Poisson around each item's base rate, busier on Friday/Saturday and around
  month-end payday and grant days (25th to 3rd)
- bread: delivered by the bakery every morning except Sunday
- everything else: bought at the wholesaler on Monday and Thursday mornings, in packs,
  except on public holidays (Youth Day 16 Jun, Women's Day observed 10 Aug, Heritage
  Day 24 Sep). The missed Heritage Day trip leaves several items low at the end.
- candles: spikes during load-shedding weeks; paraffin: higher in winter
- sales cannot exceed stock on hand (a stock-out loses the sale, as in a real shop)
- one item added two weeks before the end, so it has too little history (ETR-03)

All categories are 'Groceries': the model only knows five categories and spaza
stock is groceries (BUILD-JOURNAL O2).
"""
import argparse
import base64
import hashlib
import math
import os
import random
import struct
from datetime import date, datetime, time, timedelta

OUT = os.path.join(os.path.dirname(__file__), "..", "init", "02-seed.sql")

# Test credentials for every seeded user. Test data only - never a real password.
TEST_PASSWORD = "Spaza#2026"

HOLIDAYS = {date(2026, 6, 16), date(2026, 8, 10), date(2026, 9, 24)}
LOAD_SHEDDING = [(date(2026, 6, 8), date(2026, 6, 13)),
                 (date(2026, 7, 20), date(2026, 7, 26)),
                 (date(2026, 9, 15), date(2026, 9, 20))]
WEEKDAY_FACTOR = [0.9, 0.9, 0.95, 1.0, 1.25, 1.35, 0.8]   # Mon..Sun

USERS = [
    # id, email, full name, role
    (1, "nomvula@intellistock.test", "Nomvula Dlamini", "BusinessOwner"),
    (2, "sipho@intellistock.test", "Sipho Mokoena", "BusinessOwner"),
    (3, "orders@ubuntu-wholesale.test", "Ubuntu Wholesalers", "Supplier"),
    (4, "sales@kasi-cashcarry.test", "Kasi Cash & Carry", "Supplier"),
    (5, "info@mzansi-bulk.test", "Mzansi Bulk Traders", "Supplier"),
]
OWNERS = [
    (1, "Nomvula's Spaza", "Section 3, Khayelitsha, Cape Town", "021 555 0134"),
    (2, "Sipho's Tuck Shop", "Block L, Soshanguve, Pretoria", "012 555 0178"),
]
SUPPLIERS = [
    (3, "Ubuntu Wholesalers", "021 555 0190", "Khayelitsha, Mitchells Plain, Philippi"),
    (4, "Kasi Cash & Carry", "021 555 0122", "Cape Flats"),
    (5, "Mzansi Bulk Traders", "012 555 0145", "Tshwane North, Soshanguve"),
]

# name, unit, base demand/day, unit cost, selling price, reorder level, pack size, supply
#   supply: 'bakery' (daily delivery) or 'wholesale' (Mon/Thu trips)
#   extra keys: pattern ('candles' / 'paraffin'), start (date item was added)
NOMVULA_ITEMS = [
    ("Albany Brown Bread 700g", "loaf", 22, 16.50, 19.99, 6, 1, "bakery"),
    ("Sasko White Bread 700g", "loaf", 14, 18.00, 21.99, 5, 1, "bakery"),
    ("Iwisa Super Maize Meal 5kg", "bag", 2.2, 66.00, 79.99, 4, 10, "wholesale"),
    ("White Star Maize Meal 2.5kg", "bag", 3.5, 36.00, 44.99, 6, 10, "wholesale"),
    ("Selati White Sugar 2kg", "bag", 2.5, 38.00, 46.99, 4, 10, "wholesale"),
    ("Tastic Rice 2kg", "bag", 1.6, 36.00, 44.99, 3, 10, "wholesale"),
    ("Sunfoil Cooking Oil 750ml", "bottle", 2.4, 31.00, 39.99, 4, 12, "wholesale"),
    ("Clover Long Life Milk 1L", "carton", 6, 16.00, 19.99, 8, 12, "wholesale"),
    ("Large Eggs 6-pack", "box", 4, 20.00, 26.99, 6, 10, "wholesale"),
    ("Coca-Cola 2L", "bottle", 7, 23.00, 29.99, 8, 6, "wholesale"),
    ("Simba Chips 36g", "packet", 18, 7.20, 9.99, 20, 48, "wholesale"),
    ("Lucky Star Pilchards 400g", "tin", 2.8, 26.00, 32.99, 5, 12, "wholesale"),
    ("Koo Baked Beans 410g", "tin", 2.2, 15.00, 19.99, 4, 12, "wholesale"),
    ("Joko Tea 100 bags", "box", 0.8, 55.00, 69.99, 2, 6, "wholesale"),
    ("Knorrox Beef Stock Cubes 24", "box", 1.5, 22.00, 29.99, 3, 12, "wholesale"),
    ("Royco Soup Powder 50g", "sachet", 4.5, 7.00, 9.99, 8, 24, "wholesale"),
    ("Sunlight Bar Soap 175g", "bar", 1.8, 11.00, 14.99, 4, 12, "wholesale"),
    ("Lion Matches 10-pack", "pack", 1.2, 9.00, 12.99, 3, 10, "wholesale"),
    ("Household Candles 6-pack", "pack", 1.0, 22.00, 29.99, 4, 12, "wholesale", {"pattern": "candles"}),
    ("Paraffin 1L", "bottle", 2.5, 20.00, 26.99, 4, 20, "wholesale", {"pattern": "paraffin"}),
    ("Inkomazi Amasi 2L", "bottle", 2.6, 35.00, 42.99, 4, 6, "wholesale"),
    ("Fatti's & Moni's Spaghetti 500g", "packet", 1.8, 17.00, 22.99, 3, 10, "wholesale", {"start": date(2026, 9, 14)}),
]
SIPHO_ITEMS = [
    ("Albany Brown Bread 700g", "loaf", 15, 16.50, 19.99, 5, 1, "bakery"),
    ("Iwisa Super Maize Meal 5kg", "bag", 1.8, 67.00, 79.99, 3, 10, "wholesale"),
    ("Clover Long Life Milk 1L", "carton", 4, 16.50, 19.99, 6, 12, "wholesale"),
    ("Coca-Cola 2L", "bottle", 5, 23.50, 29.99, 6, 6, "wholesale"),
    ("Simba Chips 36g", "packet", 12, 7.20, 9.99, 15, 48, "wholesale"),
    ("Lucky Star Pilchards 400g", "tin", 2, 26.50, 32.99, 4, 12, "wholesale"),
]


def identity_v3_hash(password, rng):
    """ASP.NET Core Identity PasswordHasher v3: PBKDF2-HMAC-SHA512, 100,000 iterations."""
    salt = bytes(rng.getrandbits(8) for _ in range(16))
    subkey = hashlib.pbkdf2_hmac("sha512", password.encode(), salt, 100_000, 32)
    blob = b"\x01" + struct.pack(">III", 2, 100_000, len(salt)) + salt + subkey
    return base64.b64encode(blob).decode()


def plural(unit, n):
    if n == 1:
        return unit
    return {"loaf": "loaves", "box": "boxes", "each": "each"}.get(unit, unit + "s")


def poisson(rng, lam):
    """Knuth's method - fine for the small rates used here."""
    if lam <= 0:
        return 0
    if lam > 50:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def demand_rate(item, d):
    lam = item["rate"] * WEEKDAY_FACTOR[d.weekday()]
    if d.day >= 25 or d.day <= 3:
        lam *= 1.35                     # payday and grant days
    pattern = item.get("pattern")
    if pattern == "candles" and any(a <= d <= b for a, b in LOAD_SHEDDING):
        lam *= 6
    if pattern == "paraffin":
        lam *= {5: 1.2, 6: 1.6, 7: 1.6, 8: 1.3}.get(d.month, 0.8)
    return lam


def sql(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return f"'{v:%Y-%m-%d %H:%M:%S}'"
    if isinstance(v, date):
        return f"'{v:%Y-%m-%d}'"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def inserts(table, cols, rows, batch=500):
    out = []
    for i in range(0, len(rows), batch):
        values = ",\n".join("(" + ", ".join(sql(v) for v in r) + ")" for r in rows[i:i + batch])
        out.append(f"INSERT INTO `{table}` ({', '.join(cols)}) VALUES\n{values};")
    return out


def simulate_shop(owner_id, specs, first_item_id, start, end, rng):
    items, txns, alerts = [], [], []
    for n, spec in enumerate(specs):
        name, unit, rate, cost, price, reorder, pack, supply = spec[:8]
        extra = spec[8] if len(spec) > 8 else {}
        items.append({"id": first_item_id + n, "name": name, "unit": unit, "rate": rate,
                      "cost": cost, "price": price, "reorder": reorder, "pack": pack,
                      "supply": supply, "start": max(start, extra.get("start", start)),
                      "pattern": extra.get("pattern"), "on_hand": 0, "open_alert": None})

    def move(item, kind, change, when, note=None):
        item["on_hand"] += change
        txns.append((item["id"], kind, change, item["on_hand"], when, owner_id, note))
        # FR-05: raise at or below the reorder level, resolve when back above it
        if item["on_hand"] <= item["reorder"] and item["open_alert"] is None:
            alerts.append({"item": item["id"], "qty": item["on_hand"], "level": item["reorder"],
                           "created": when, "resolved": None,
                           "msg": f"{item['name']} is down to {item['on_hand']} "
                                  f"{plural(item['unit'], item['on_hand'])} (reorder level {item['reorder']})"})
            item["open_alert"] = alerts[-1]
        elif item["on_hand"] > item["reorder"] and item["open_alert"] is not None:
            item["open_alert"]["resolved"] = when
            item["open_alert"] = None

    def trip_gap(d):
        """Days until the next planned wholesaler trip after d. The owner plans on the
        normal Mon/Thu schedule; a holiday closure is only found out on the day."""
        n = 1
        while (d + timedelta(n)).weekday() not in (0, 3):
            n += 1
        return n

    d = start
    while d <= end:
        for it in items:
            if d < it["start"]:
                continue
            if d == it["start"]:
                opening = max(it["reorder"] + 1, round(it["rate"] * 5))
                if it["pack"] > 1:
                    opening = math.ceil(opening / it["pack"]) * it["pack"]
                move(it, "Adjustment", opening, datetime.combine(d, time(6, 0)), "Opening stock count")
                continue

            # morning deliveries
            if it["supply"] == "bakery" and d.weekday() != 6:
                target = math.ceil(it["rate"] * 1.4) + it["reorder"]
                if it["on_hand"] < target:
                    move(it, "Restock", target - it["on_hand"],
                         datetime.combine(d, time(6, 30)), "Bakery delivery")
            elif it["supply"] == "wholesale" and d.weekday() in (0, 3) and d not in HOLIDAYS:
                cover = trip_gap(d) + 3             # a few days' safety buffer
                target = it["reorder"] + math.ceil(it["rate"] * 1.2 * cover)
                if it["on_hand"] < target:
                    packs = math.ceil((target - it["on_hand"]) / it["pack"])
                    move(it, "Restock", packs * it["pack"],
                         datetime.combine(d, time(9, 15)), "Wholesaler trip")

            # sales, recorded as a midday and a closing tally
            demand = poisson(rng, demand_rate(it, d))
            midday = round(demand * rng.uniform(0.35, 0.5))
            for qty, t in ((midday, time(13, 0)), (demand - midday, time(19, 30))):
                qty = min(qty, it["on_hand"])      # a stock-out loses the sale
                if qty > 0:
                    move(it, "Sale", -qty, datetime.combine(d, t))
        d += timedelta(1)
    return items, txns, alerts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", default="2026-09-27", help="last day of history (inclusive)")
    ap.add_argument("--days", type=int, default=120)
    args = ap.parse_args()

    end = date.fromisoformat(args.end)
    start = end - timedelta(days=args.days - 1)
    rng = random.Random(20260928)

    shops = [(1, NOMVULA_ITEMS, 1, start), (2, SIPHO_ITEMS, 101, end - timedelta(days=59))]
    all_items, all_txns, all_alerts = [], [], []
    for owner_id, specs, first_id, shop_start in shops:
        items, txns, alerts = simulate_shop(owner_id, specs, first_id, shop_start, end, rng)
        all_items += [(owner_id, it) for it in items]
        all_txns += txns
        all_alerts += alerts
    all_txns.sort(key=lambda t: (t[4], t[0]))

    lines = [
        "-- IntelliStock seed data - GENERATED by db/seed/generate_seed.py, do not edit by hand.",
        f"-- History: {start} to {end} ({args.days} days) for Nomvula's Spaza; 60 days for Sipho's Tuck Shop.",
        f"-- Test login for every seeded user: password '{TEST_PASSWORD}' (test data only).",
        "--   nomvula@intellistock.test  - BusinessOwner, 22 items",
        "--   sipho@intellistock.test    - BusinessOwner, 6 items (proves owners only see their own stock)",
        "",
        "SET NAMES utf8mb4;",
        "USE intellistock;",
        "",
    ]
    lines += inserts("RegisteredUser", ["RegisteredUserId", "Email", "PasswordHash", "FullName", "Role", "CreatedAt"],
                     [(uid, email, identity_v3_hash(TEST_PASSWORD, rng), name, role,
                       datetime.combine(start - timedelta(days=7), time(10, 0)))
                      for uid, email, name, role in USERS])
    lines += inserts("BusinessOwner", ["RegisteredUserId", "BusinessName", "Location", "Phone"], OWNERS)
    lines += inserts("Supplier", ["RegisteredUserId", "CompanyName", "Phone", "DeliveryArea"], SUPPLIERS)
    lines += inserts("StockItem", ["StockItemId", "BusinessOwnerId", "Name", "Category", "Unit", "QuantityOnHand",
                                   "ReorderLevel", "UnitCost", "SellingPrice", "IsActive", "CreatedAt"],
                     [(it["id"], owner, it["name"], "Groceries", it["unit"], it["on_hand"], it["reorder"],
                       it["cost"], it["price"], 1, datetime.combine(it["start"], time(6, 0)))
                      for owner, it in all_items])
    lines += inserts("Transaction", ["StockItemId", "Type", "QuantityChange", "QuantityAfter", "OccurredAt",
                                     "RecordedByUserId", "Note"], all_txns)
    lines += inserts("Alert", ["StockItemId", "Type", "Message", "QuantityAtAlert", "ReorderLevel",
                               "CreatedAt", "ResolvedAt"],
                     [(a["item"], "LowStock", a["msg"], a["qty"], a["level"], a["created"], a["resolved"])
                      for a in sorted(all_alerts, key=lambda a: a["created"])])

    # supplier price lists: the same products at different prices and lead times
    listings = []
    seen = {}
    for _, it in all_items:
        seen.setdefault(it["name"], it)
    for sid, lead, markup in ((3, 1, 1.00), (4, 2, 0.96), (5, 3, 1.04)):
        for name, it in seen.items():
            if it["supply"] == "bakery" or rng.random() < 0.15:
                continue                       # not every supplier stocks everything
            pack = max(it["pack"], 1)
            price = round(it["cost"] * pack * markup * rng.uniform(0.95, 1.05), 2)
            listings.append((sid, name, "Groceries", pack, price, lead,
                             datetime.combine(end - timedelta(days=rng.randint(1, 20)), time(8, 0))))
    lines += inserts("SupplierListing", ["SupplierId", "ProductName", "Category", "PackSize", "PackPrice",
                                         "LeadTimeDays", "UpdatedAt"], listings)

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    below = [it["name"] for _, it in all_items if it["on_hand"] <= it["reorder"]]
    print(f"Wrote {os.path.relpath(OUT)}")
    print(f"  users {len(USERS)}, stock items {len(all_items)}, transactions {len(all_txns):,}, "
          f"alerts {len(all_alerts)} ({sum(a['resolved'] is None for a in all_alerts)} open), "
          f"supplier listings {len(listings)}")
    print(f"  at or below reorder level on {end}: {len(below)} - {', '.join(below)}")


if __name__ == "__main__":
    main()
