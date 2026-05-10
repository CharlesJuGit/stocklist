"""
從 TAIFEX openapi 抓期貨與選擇權未平倉資料，存成 taifex_data.json。
由 GitHub Actions 每日自動執行，網頁直接讀取（無 CORS 問題）。
"""
import json
import urllib.request
from datetime import datetime, timezone


def fetch_csv(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()
    try:
        text = raw.decode("utf-8")
        if "\ufffd" in text:
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        text = raw.decode("big5", errors="replace")
    return text


def parse_rows(text):
    rows = []
    for line in text.strip().split("\n"):
        parts = [p.strip().strip('"') for p in line.split(",")]
        # 只留日期（8位數字）開頭的資料列
        if len(parts) > 3 and len(parts[0]) == 8 and parts[0].isdigit():
            rows.append(parts)
    return rows


def parse_futures(text):
    rows = parse_rows(text)
    if not rows:
        return None, {}

    # 依商品（col[1]）分組；順序固定：自營[0] 投信[1] 外資[2]
    groups, cur_prod, cur_group = [], None, []
    for row in rows:
        if row[1] != cur_prod:
            if cur_group:
                groups.append(cur_group)
            cur_prod, cur_group = row[1], [row]
        else:
            cur_group.append(row)
    if cur_group:
        groups.append(cur_group)

    def net(group, idx):
        row = group[idx] if idx < len(group) else None
        if not row:
            return 0
        lo = int(row[9].replace(",", "") or "0") if len(row) > 9 else 0
        so = int(row[11].replace(",", "") or "0") if len(row) > 11 else 0
        return lo - so

    tx  = groups[0]             # 臺股期貨（大台）
    mtx = groups[-1]            # 小型臺指期貨（小台）
    date = rows[0][0]
    return date, {
        "txF":  net(tx, 2),  "txT":  net(tx, 1),  "txD":  net(tx, 0),
        "mtxF": net(mtx, 2), "mtxT": net(mtx, 1), "mtxD": net(mtx, 0),
    }


def parse_options(text):
    rows = parse_rows(text)
    if not rows:
        return {}

    first_prod = rows[0][1]   # 第一個商品 = 臺指選擇權(TXO)
    bc = sc = bp = sp = 0
    for row in rows:
        if row[1] != first_prod:
            break
        t = row[2]            # "CALL" or "PUT"
        buy_oi  = int(row[10].replace(",", "") or "0") if len(row) > 10 else 0
        sell_oi = int(row[12].replace(",", "") or "0") if len(row) > 12 else 0
        if t == "CALL":
            bc += buy_oi;  sc += sell_oi
        elif t == "PUT":
            bp += buy_oi;  sp += sell_oi
    return {"bc": bc, "sc": sc, "bp": bp, "sp": sp}


FUT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate")
OPT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate")

fut_text = fetch_csv(FUT_URL)
opt_text = fetch_csv(OPT_URL)

date, futures = parse_futures(fut_text)
options       = parse_options(opt_text)

result = {
    "date":       date,
    "futures":    futures,
    "options":    options,
    "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}

with open("taifex_data.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"OK  date={date}  txF={futures.get('txF')}  bc={options.get('bc')}")
