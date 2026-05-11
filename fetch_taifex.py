"""
從 TAIFEX openapi 抓期貨/選擇權未平倉，
從 Yahoo Finance 抓台加權指數(^TWII)和 Nasdaq 期貨(NQ=F) 波動資料。
由 GitHub Actions 每日自動執行，網頁直接讀取（無 CORS 問題）。
"""
import json
import urllib.request
from datetime import datetime, timezone, timedelta


# ── TAIFEX CSV 公用 ───────────────────────────────────────────

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
        if len(parts) > 3 and len(parts[0]) == 8 and parts[0].isdigit():
            rows.append(parts)
    return rows


# ── 期貨未平倉 ────────────────────────────────────────────────

def parse_futures(text):
    # API 目前回傳 JSON（英文欄位名），中文 ContractCode/Item 有亂碼
    # 固定位置索引（順序不變）：
    #   臺股期貨：    idx[0]=自營 [1]=投信 [2]=外資
    #   小型臺指期貨：idx[9]=自營 [10]=投信 [11]=外資
    try:
        data = json.loads(text)
    except Exception:
        data = None

    if data and isinstance(data, list) and len(data) > 2:
        def get_net(idx):
            row = data[idx] if idx < len(data) else {}
            val = row.get("OpenInterest(Net)", "0") or "0"
            return int(str(val).replace(",", ""))
        date = data[0].get("Date", "")
        return date, {
            "txF": get_net(2), "txT": get_net(1), "txD": get_net(0),
            "mtxF": get_net(11), "mtxT": get_net(10), "mtxD": get_net(9),
        }

    # fallback: 舊版 CSV 格式
    rows = parse_rows(text)
    if not rows:
        return None, {}
    def find_net(prod_kw, ident_kw):
        for row in rows:
            if prod_kw in row[1] and ident_kw in row[2]:
                lo = int(row[9].replace(",", "") or "0") if len(row) > 9 and row[9] else 0
                so = int(row[11].replace(",", "") or "0") if len(row) > 11 and row[11] else 0
                return lo - so
        return 0
    date = rows[0][0]
    return date, {
        "txF": find_net("臺股期貨", "外資"), "txT": find_net("臺股期貨", "投信"),
        "txD": find_net("臺股期貨", "自營"),
        "mtxF": find_net("小型臺指期貨", "外資"), "mtxT": find_net("小型臺指期貨", "投信"),
        "mtxD": find_net("小型臺指期貨", "自營"),
    }


# ── 選擇權未平倉 ──────────────────────────────────────────────

def parse_options(text):
    rows = parse_rows(text)
    if not rows:
        return {}
    first_prod = rows[0][1]
    bc = sc = bp = sp = 0
    for row in rows:
        if row[1] != first_prod:
            break
        t = row[2]
        buy_oi  = int(row[10].replace(",", "") or "0") if len(row) > 10 else 0
        sell_oi = int(row[12].replace(",", "") or "0") if len(row) > 12 else 0
        if t == "CALL":
            bc += buy_oi;  sc += sell_oi
        elif t == "PUT":
            bp += buy_oi;  sp += sell_oi
    return {"bc": bc, "sc": sc, "bp": bp, "sp": sp}


# ── FinMind 台指期 OHLC ──────────────────────────────────────

def fetch_tx_ohlc(token, n_days=25):
    """
    從 FinMind 抓台指期（TX）近月合約每日高低點。
    用 after_market session 的 max/min（含日盤+夜盤完整波動）。
    """
    from datetime import date as _date
    start = (_date.today() - timedelta(days=60)).strftime("%Y-%m-%d")
    url = (f"https://api.finmindtrade.com/api/v4/data"
           f"?dataset=TaiwanFuturesDaily&data_id=TX&start_date={start}&token={token}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    rows = data.get("data", [])
    # 只取近月合約（contract_date 為純 6 位數字，如 202605）的 after_market
    by_date = {}
    for row in rows:
        if (row["trading_session"] == "after_market"
                and len(row["contract_date"]) == 6
                and row["volume"] > 0):
            dt = row["date"]
            # 近月優先：取成交量最大的
            if dt not in by_date or row["volume"] > by_date[dt]["volume"]:
                by_date[dt] = row

    records = []
    for dt in sorted(by_date.keys()):
        r = by_date[dt]
        h, l = round(r["max"]), round(r["min"])
        records.append({"date": dt, "high": h, "low": l, "range": h - l})

    return records[-n_days:] if len(records) >= n_days else records


# ── Yahoo Finance OHLC（NQ 期貨）────────────────────────────

def fetch_yahoo_ohlc(symbol, n_days=25):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?interval=1d&range=60d")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    result = data["chart"]["result"][0]
    timestamps = result["timestamp"]
    q = result["indicators"]["quote"][0]

    records = []
    for i, ts in enumerate(timestamps):
        h = q["high"][i]
        l = q["low"][i]
        if h is None or l is None:
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        records.append({"date": dt, "high": round(h), "low": round(l), "range": round(h - l)})

    return records[-n_days:] if len(records) >= n_days else records


def classify(rng, avg):
    """依據與均值的比例分類：低/小/中/大/高"""
    if avg <= 0:
        return "—"
    ratio = rng / avg
    if ratio < 0.4:
        return "低"
    elif ratio < 0.7:
        return "小"
    elif ratio < 1.0:
        return "中"
    elif ratio <= 1.4:
        return "大"
    else:
        return "高"


def build_vol_data(records, label):
    if not records:
        return {}
    # 取前 20 天作為均值基礎（若不足 20 天就全用）
    # 排除最後一筆（昨日）以免影響到「昨天 vs 平均」的比較
    avg_days = records[:-1] if len(records) > 1 else records
    avg_days = avg_days[-20:]  # 最多 20 天
    avg = round(sum(r["range"] for r in avg_days) / len(avg_days)) if avg_days else 0

    yesterday = records[-1]
    cat = classify(yesterday["range"], avg)

    return {
        "yesterday": yesterday,
        "avg20":     avg,
        "category":  cat,
        "history":   records[-20:],  # 最近 20 天（含昨日）供彈出視窗
    }


# ── 主程式 ────────────────────────────────────────────────────
import os as _os, sys as _sys

FUT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate")
OPT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate")

# TAIFEX 未平倉
date, futures, options = None, {}, {}
try:
    fut_text = fetch_csv(FUT_URL)
    date, futures = parse_futures(fut_text)
    print(f"futures OK  date={date}  txF={futures.get('txF')}")
except Exception as e:
    print(f"futures FAIL: {e}")

try:
    opt_text = fetch_csv(OPT_URL)
    options = parse_options(opt_text)
    print(f"options OK  bc={options.get('bc')}")
except Exception as e:
    print(f"options FAIL: {e}")

# FinMind token
_TOKEN = _os.environ.get("FINMIND_TOKEN", "").strip()
if not _TOKEN:
    _sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '../stockematool'))
    try:
        from config import FINMIND_TOKEN as _TOKEN
    except Exception:
        _TOKEN = ""

# 波動資料：優先用 FinMind TX 期貨，失敗則 fallback 到 Yahoo ^TWII
twii_records = []
if _TOKEN:
    try:
        twii_records = fetch_tx_ohlc(_TOKEN, 25)
        print(f"TX OHLC OK (FinMind)  {len(twii_records)} days")
    except Exception as e:
        print(f"TX FinMind FAIL ({e}), trying Yahoo ^TWII fallback...")
        try:
            twii_records = fetch_yahoo_ohlc("^TWII", 25)
            print(f"TX OHLC OK (^TWII fallback)  {len(twii_records)} days")
        except Exception as e2:
            print(f"TX OHLC FAIL: {e2}")
else:
    try:
        twii_records = fetch_yahoo_ohlc("^TWII", 25)
        print(f"TX OHLC OK (^TWII, no token)  {len(twii_records)} days")
    except Exception as e:
        print(f"TX OHLC FAIL: {e}")

nq_records = []
try:
    nq_records = fetch_yahoo_ohlc("NQ=F", 25)
    print(f"NQ OHLC OK  {len(nq_records)} days")
except Exception as e:
    print(f"NQ OHLC FAIL: {e}")

tx_vol = build_vol_data(twii_records, "TX")
nq_vol = build_vol_data(nq_records,   "NQ")

result = {
    "date":       date,
    "futures":    futures,
    "options":    options,
    "volatility": {"tx": tx_vol, "nq": nq_vol},
    "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}

with open("taifex_data.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("taifex_data.json written OK")
