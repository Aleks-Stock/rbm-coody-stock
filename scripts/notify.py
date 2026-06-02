import os, csv, io, math, requests
from datetime import datetime

# ── CONFIG ──────────────────────────────────────────────────────────────────
SHEET_ID = "1RDBz-AZaEX9bqDIqEv1tKlZaOuIN9uTjo5e8abrvnyY"
THRESHOLD = int(os.environ.get("ORDER_THRESHOLD", "5"))
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

SHEETS = {
    "sales_us":  f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sales+2024-2026+USA",
    "sales_ca":  f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid=1819427614",
    "stock_us":  f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Stock_USA-China_ORDER",
    "stock_ca":  f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Stock-Canada",
}

def fetch(url):
    r = requests.get(url, timeout=20)
    return list(csv.reader(io.StringIO(r.text)))

def si(v):
    try: return max(0, int(str(v).strip()) or 0)
    except: return 0

def parse_sales(rows):
    """Parse sales sheet → {name: [v28,v29,v30]} (Mar,Apr,May 2026)"""
    result = {}
    if len(rows) < 2: return result
    # Find header with months
    header, header_idx = None, 0
    for i, row in enumerate(rows[:4]):
        if any(h and "2026" in h for h in row):
            header, header_idx = row, i
            break
    if not header: return result
    # Map month → col index
    RU = ["янв","февр","мар","апр","мая","июн","июл","авг","сент","окт","нояб","дек"]
    col_map = {}
    for i, h in enumerate(header):
        if not h: continue
        for yr in ["2026","2025"]:
            if yr in h:
                for mo_i, mo in enumerate(RU):
                    if mo in h.lower():
                        col_map[yr*100+(mo_i+1) if False else int(yr)*100+(mo_i+1)] = i
                        break
    c28 = col_map.get(202603, -1)  # Mar 2026
    c29 = col_map.get(202604, -1)  # Apr 2026
    c30 = col_map.get(202605, -1)  # May 2026
    for row in rows[header_idx+1:]:
        if len(row) < 2: continue
        name = row[1].strip()
        if not name: continue
        v28 = si(row[c28]) if c28>=0 and c28<len(row) else 0
        v29 = si(row[c29]) if c29>=0 and c29<len(row) else 0
        v30 = si(row[c30]) if c30>=0 and c30<len(row) else 0
        result[name] = (v28, v29, v30)
    return result

def calc_forecast(v28, v29, v30):
    """Same logic as dashboard calcAvg3"""
    nonzero = [x for x in [v28, v29, v30] if x > 0]
    if not nonzero: return 0
    if len(nonzero) == 1: return nonzero[0]
    first, last = nonzero[0], nonzero[-1]
    if last > first:  # growing → linear
        slope = last - first
        return max(last, last + slope)
    return round(sum(nonzero) / len(nonzero), 1)

def parse_stock_us(rows):
    """{name: {transit, stock, cn}}"""
    result = {}
    for row in rows[1:]:
        if len(row) < 5: continue
        name = row[1].strip()
        if not name: continue
        result[name] = {"transit": si(row[2]), "stock": si(row[3]), "cn": si(row[4])}
    return result

def parse_stock_ca(rows):
    """{name: {transit, stock}}"""
    result = {}
    for row in rows[1:]:
        if len(row) < 4: continue
        name = row[1].strip()
        if not name: continue
        result[name] = {"transit": si(row[2]), "stock": si(row[3])}
    return result

WUZHOU_PATTERNS = ["Panda", "UP-5", "UP-2", "Hexagon", "Cuboid", "Caminus", "Kamin", "Rain Fly", "Floor for Hexagon", "Floor for UP"]

def is_wuzhou(name):
    return any(p in name for p in WUZHOU_PATTERNS)


def compute_order(sales, stock, market, order_list=None):
    """Returns list of {name, qty, vel, days, factory} sorted by stock sheet order.
    market: 'US' or 'CA'. Per-product lead time: Wuzhou=120d/4mo, Coody=45d(US)/60d(CA)/2mo.
    """
    items = []
    all_names = set(sales.keys()) | set(stock.keys())
    for name in all_names:
        s = stock.get(name, {"transit": 0, "stock": 0, "cn": 0})
        sp = sales.get(name, (0, 0, 0))
        vel = calc_forecast(*sp)
        if vel == 0: continue
        wu = is_wuzhou(name)
        thresh = 120 if wu else (45 if market == "US" else 60)
        target_months = (4.0 if market == "US" else 4.5) if wu else (2.0 if market == "US" else 2.5)
        avail = s["stock"] + s["transit"]
        days = int(avail / (vel / 30)) if avail > 0 else 0
        if days >= thresh: continue
        target = math.ceil(vel * target_months)
        qty = max(0, target - avail)
        if qty == 0: continue
        items.append({"name": name, "qty": qty, "vel": round(vel, 1), "days": days, "wu": wu})
    # Sort by stock sheet order if provided, otherwise by days
    if order_list:
        order_idx = {name: i for i, name in enumerate(order_list)}
        items.sort(key=lambda x: (1 if x["wu"] else 0, order_idx.get(x["name"], 9999)))
    else:
        items.sort(key=lambda x: (1 if x["wu"] else 0, x["days"]))
    return items

def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    r = requests.post(url, json={
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML"
    }, timeout=15)
    return r.status_code == 200

def format_message(market, items, date_str):
    name_map = {"US": "США", "CA": "Канада"}
    lines = [f"📦 <b>ЗАКАЗ {name_map[market]} — {date_str}</b>", ""]
    last_wu = None
    num = 0
    for it in items:
        wu = it.get("wu", False)
        if last_wu is None or wu != last_wu:
            label = "🏭 Учжоу (120 дн):" if wu else "🏭 COODY (60 дн):"
            lines.append(f"<b>{label}</b>")
            last_wu = wu
        num += 1
        lines.append(f"{num}) {it['name']} — <b>{it['qty']} pcs</b>")
    lines.append("")
    lines.append(f"Всего товаров: {len(items)}")
    lines.append("🔗 rbm-coody-stock.onrender.com")
    return "\n".join(lines)

def main():
    today = datetime.now().strftime("%d.%m.%Y")
    print(f"[{today}] Fetching data...")

    try:
        rows_sus = fetch(SHEETS["sales_us"])
        rows_sca = fetch(SHEETS["sales_ca"])
        rows_stus = fetch(SHEETS["stock_us"])
        rows_stca = fetch(SHEETS["stock_ca"])
    except Exception as e:
        print(f"Fetch error: {e}")
        return

    sales_us = parse_sales(rows_sus)
    sales_ca = parse_sales(rows_sca)
    stock_us = parse_stock_us(rows_stus)
    stock_ca = parse_stock_ca(rows_stca)

    # Get product order from stock sheet
    stock_order = [row[1].strip() for row in rows_stus[1:] if len(row)>1 and row[1].strip()]
    order_us = compute_order(sales_us, stock_us, market="US", order_list=stock_order)
    order_ca = compute_order(sales_ca, stock_ca, market="CA", order_list=stock_order)

    print(f"US order: {len(order_us)} items | CA order: {len(order_ca)} items")

    sent = False
    if len(order_us) >= THRESHOLD:
        msg = format_message("US", order_us, today)
        ok = send_telegram(msg)
        print(f"Telegram US: {'OK' if ok else 'FAILED'}")
        sent = True

    if len(order_ca) >= THRESHOLD:
        msg = format_message("CA", order_ca, today)
        ok = send_telegram(msg)
        print(f"Telegram CA: {'OK' if ok else 'FAILED'}")
        sent = True

    if not sent:
        print(f"No alerts needed (US: {len(order_us)}, CA: {len(order_ca)}, threshold: {THRESHOLD})")

if __name__ == "__main__":
    main()
