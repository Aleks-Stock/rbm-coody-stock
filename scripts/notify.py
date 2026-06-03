import os, csv, io, math, requests
from datetime import datetime

# ── CONFIG ────────────────────────────────────────────────────────────────
SHEET_ID = "1RDBz-AZaEX9bqDIqEv1tKlZaOuIN9uTjo5e8abrvnyY"
THRESHOLD = int(os.environ.get("ORDER_THRESHOLD", "5"))
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

SHEETS = {
    "sales_us": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sales+2024-2026+USA",
    "sales_ca": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid=1819427614",
    "stock_us": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Stock_USA-China_ORDER",
    "stock_ca": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Stock-Canada",
}

def fetch(url):
    r = requests.get(url, timeout=20)
    return list(csv.reader(io.StringIO(r.text)))

def si(v):
    try: return max(0, int(str(v).strip()) or 0)
    except: return 0

def parse_sales(rows):
    """Parse sales sheet → {name: (v28,v29,v30,cur)} where cur = current month raw."""
    result = {}
    if len(rows) < 2: return result
    header, header_idx = None, 0
    for i, row in enumerate(rows[:4]):
        if any(h and "2026" in h for h in row):
            header, header_idx = row, i
            break
    if not header: return result
    RU = ["янв","февр","мар","апр","мая","июн","июл","авг","сент","окт","нояб","дек"]
    col_map = {}
    for i, h in enumerate(header):
        if not h: continue
        for yr in ["2026", "2025"]:
            if yr in h:
                for mo_i, mo in enumerate(RU):
                    if mo in h.lower():
                        col_map[int(yr)*100+(mo_i+1)] = i
                        break
    now = datetime.now()
    cur_key = now.year * 100 + now.month
    # Last 3 complete months (exclude current)
    complete = sorted([k for k in col_map if k < cur_key], reverse=True)[:3]
    if len(complete) < 3: return result
    c28, c29, c30 = col_map[complete[2]], col_map[complete[1]], col_map[complete[0]]
    c_cur = col_map.get(cur_key, -1)  # current month column
    days_elapsed = now.day

    for row in rows[header_idx+1:]:
        if len(row) < 2: continue
        name = row[1].strip()
        if not name: continue
        v28 = si(row[c28]) if c28 >= 0 and c28 < len(row) else 0
        v29 = si(row[c29]) if c29 >= 0 and c29 < len(row) else 0
        v30 = si(row[c30]) if c30 >= 0 and c30 < len(row) else 0
        cur_raw = si(row[c_cur]) if c_cur >= 0 and c_cur < len(row) else 0
        # Normalize current month to monthly rate
        cur_norm = round(cur_raw * (30 / days_elapsed), 1) if days_elapsed > 0 else 0
        result[name] = (v28, v29, v30, cur_norm)
    return result

def calc_forecast(v28, v29, v30, cur_norm=0):
    """Mirror of dashboard calcAvg3WithCurrent."""
    may = v30  # most recent complete month
    # Use current month if it projects higher than last complete month
    if cur_norm > 0 and cur_norm > may:
        vals = [v29, may, cur_norm]
        trend = round(sum(vals) / 3, 1)
        return trend if trend > 0 else may
    # Otherwise: calcAvg3 logic
    months = [v28, v29, v30]
    start = 0
    while start < len(months) and months[start] == 0:
        start += 1
    active = months[start:]
    if not active: return 0
    if active[-1] == 0:
        return round(sum(active) / len(active), 1)
    if len(active) == 1: return active[0]
    if len(active) == 2: return active[-1]
    if active[0] > 0 and active[1] > active[0] and active[2] > active[1]:
        slope = (active[2] - active[0]) / 2
        return max(active[2], round(active[2] + slope, 1))
    return round(sum(active) / len(active), 1)

def parse_stock_us(rows):
    """{name: {transit, stock, cn, ordered, category}}"""
    result = {}
    cur_cat = ""
    for row in rows[1:]:
        if len(row) < 2: continue
        if row[0].strip() and not row[1].strip():
            cur_cat = row[0].strip()
            continue
        name = row[1].strip()
        if not name: continue
        result[name] = {
            "transit":  si(row[2]) if len(row) > 2 else 0,
            "stock":    si(row[3]) if len(row) > 3 else 0,
            "cn":       si(row[4]) if len(row) > 4 else 0,
            "ordered":  max(0, si(row[5])) if len(row) > 5 else 0,
            "category": cur_cat,
        }
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

WUZHOU_PATTERNS = ["Panda","UP-5","UP-2","Hexagon","Cuboid","Caminus","Kamin","Rain Fly","Floor for Hexagon","Floor for UP"]

def is_wuzhou(name):
    return any(p in name for p in WUZHOU_PATTERNS)

def classify_abc(vel, group_vels):
    """A/B/C based on velocity vs group median."""
    if vel <= 2:
        return "C"
    if not group_vels:
        return "B"
    med = sorted(group_vels)[len(group_vels) // 2]
    return "A" if vel > 2 and vel >= med * 1.2 else "B"

def compute_order(sales, stock, market, order_list=None):
    """Compute order with ABC per-category and current-month forecast."""
    all_names = set(sales.keys()) | set(stock.keys())

    # Build per-category velocity groups
    cat_vels = {}
    name_vel = {}
    for name in all_names:
        sp = sales.get(name, (0, 0, 0, 0))
        vel = calc_forecast(*sp)
        if vel <= 0: continue
        name_vel[name] = vel
        cat = stock.get(name, {}).get("category", "")
        cat_vels.setdefault(cat, []).append(vel)

    items = []
    for name in all_names:
        s = stock.get(name, {"transit": 0, "stock": 0, "cn": 0, "ordered": 0, "category": ""})
        vel = name_vel.get(name, 0)
        if vel == 0: continue
        cat = s.get("category", "")
        abc = classify_abc(vel, cat_vels.get(cat, []))
        wu = is_wuzhou(name)

        if abc == "A":
            thresh = 60 if market == "US" else 75
            target_months = 2.0 if market == "US" else 2.5
        elif abc == "C":
            thresh = 30 if market == "US" else 45
            target_months = 1.0 if market == "US" else 1.5
        else:
            thresh = 45 if market == "US" else 60
            target_months = 1.5 if market == "US" else 2.0

        ordered_factory = max(0, s.get("ordered", 0))
        avail = s["stock"] + s["transit"] + ordered_factory
        days = int(avail / (vel / 30)) if avail > 0 else 0
        if days >= thresh: continue
        target = math.ceil(vel * target_months)
        qty = max(0, target - avail)
        if qty == 0: continue
        items.append({"name": name, "qty": qty, "vel": round(vel, 1),
                      "days": days, "wu": wu, "abc": abc})

    if order_list:
        order_idx = {n: i for i, n in enumerate(order_list)}
        items.sort(key=lambda x: (1 if x["wu"] else 0, order_idx.get(x["name"], 9999)))
    else:
        items.sort(key=lambda x: (1 if x["wu"] else 0, x["days"]))
    return items

def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    r = requests.post(url, json={"chat_id": TELEGRAM_CHAT_ID,
                                  "text": message, "parse_mode": "HTML"}, timeout=15)
    return r.status_code == 200

def format_message(market, items, date_str):
    name_map = {"US": "США", "CA": "Канада"}
    lines = [f"📦 <b>ЗАКАЗ {name_map[market]} — {date_str}</b>", ""]
    last_wu = None
    num = 0
    for it in items:
        wu = it.get("wu", False)
        if last_wu is None or wu != last_wu:
            label = "🏭 Учжоу (60 дн):" if wu else "🏭 COODY (60 дн):"
            lines.append(f"<b>{label}</b>")
            last_wu = wu
        num += 1
        abc_tag = f" [{it['abc']}]" if it.get("abc") else ""
        lines.append(f"{num}) {it['name']}{abc_tag} — <b>{it['qty']} pcs</b>")
    lines.append("")
    lines.append(f"Всего товаров: {len(items)}")
    lines.append("🔗 rbm-coody-stock.onrender.com")
    return "\n".join(lines)

def main():
    today = datetime.now().strftime("%d.%m.%Y")
    print(f"[{today}] Fetching data...")
    try:
        rows_sus  = fetch(SHEETS["sales_us"])
        rows_sca  = fetch(SHEETS["sales_ca"])
        rows_stus = fetch(SHEETS["stock_us"])
        rows_stca = fetch(SHEETS["stock_ca"])
    except Exception as e:
        print(f"Fetch error: {e}"); return

    sales_us = parse_sales(rows_sus)
    sales_ca = parse_sales(rows_sca)
    stock_us = parse_stock_us(rows_stus)
    stock_ca = parse_stock_ca(rows_stca)

    stock_order = [row[1].strip() for row in rows_stus[1:] if len(row)>1 and row[1].strip()]
    order_us = compute_order(sales_us, stock_us, market="US", order_list=stock_order)
    order_ca = compute_order(sales_ca, stock_ca, market="CA", order_list=stock_order)
    print(f"US: {len(order_us)} items | CA: {len(order_ca)} items")

    sent = False
    if len(order_us) >= THRESHOLD:
        ok = send_telegram(format_message("US", order_us, today))
        print(f"Telegram US: {'OK' if ok else 'FAILED'}"); sent = True
    if len(order_ca) >= THRESHOLD:
        ok = send_telegram(format_message("CA", order_ca, today))
        print(f"Telegram CA: {'OK' if ok else 'FAILED'}"); sent = True
    if not sent:
        print(f"No alerts (US:{len(order_us)}, CA:{len(order_ca)}, thresh:{THRESHOLD})")

if __name__ == "__main__":
    main()
