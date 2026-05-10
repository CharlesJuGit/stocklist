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

    # 用中文名稱比對（Python 伺服器端執行，無編碼問題）
    # col[1]=商品名稱, col[2]=身份別
    def find_net(prod_kw, ident_kw):
        for row in rows:
            if prod_kw in row[1] and ident_kw in row[2]:
                lo = int(row[9].replace(",", "") or "0") if len(row) > 9 and row[9] else 0
                so = int(row[11].replace(",", "") or "0") if len(row) > 11 and row[11] else 0
                return lo - so
        return 0

    date = rows[0][0]
    return date, {
        "txF":  find_net("臺股期貨",   "外資"),
        "txT":  find_net("臺股期貨",   "投信"),
        "txD":  find_net("臺股期貨",   "自營"),
        "mtxF": find_net("小型臺指期貨", "外資"),
        "mtxT": find_net("小型臺指期貨", "投信"),
        "mtxD": find_net("小型臺指期貨", "自營"),
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
