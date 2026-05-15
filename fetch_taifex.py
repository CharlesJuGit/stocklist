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
    # 優先嘗試 JSON 格式（API 目前回傳 JSON，ContractCode 亂碼但位置固定）
    try:
        data = json.loads(text)
    except Exception:
        data = None

    if data and isinstance(data, list) and len(data) >= 6:
        first_code = data[0].get("ContractCode", "")
        bc = sc = bp = sp = 0
        for row in data:
            if row.get("ContractCode", "") != first_code:
                break
            cp = row.get("CallPut", "")
            lo = int(str(row.get("OpenInterest(Long)",  0) or 0).replace(",", ""))
            so = int(str(row.get("OpenInterest(Short)", 0) or 0).replace(",", ""))
            if cp == "CALL":
                bc += lo;  sc += so
            elif cp == "PUT":
                bp += lo;  sp += so
        return {"bc": bc, "sc": sc, "bp": bp, "sp": sp}

    # fallback: 舊版 CSV 格式
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

def fetch_tx_ohlc(n_days=25):
    """
    從 FinMind 抓台指期（TX）近月合約每日高低點。
    用 position session（日盤+夜盤合計的最高最低）。
    FinMind 的 position 日期 = 夜盤收盤日（XQ 慣例的隔天），需往前移一天。
    無 token 可正常取得資料；有 token 則附上以提升 quota。
    """
    from datetime import date as _date, datetime as _dt
    start = (_date.today() - timedelta(days=90)).strftime("%Y-%m-%d")
    url = (f"https://api.finmindtrade.com/api/v4/data"
           f"?dataset=TaiwanFuturesDaily&data_id=TX&start_date={start}")
    token = _os.getenv("FINMIND_TOKEN", "").strip()
    if token:
        url += f"&token={token}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    rows = data.get("data", [])
    # position session = 日盤+夜盤完整波動，近月合約（6位 contract_date）成交量最大者
    # FinMind 日期 = 夜盤結束日（比 XQ 慣例多一天）
    # 特殊：週五盤（3PM Fri→5AM Sat）FinMind 標為下週一；週日 entry 為轉換期資料
    # 統一做法：往前移一天，落到週六→再退一天(Fri)，落到週日→再退兩天(Fri)
    by_date = {}
    for row in rows:
        if (row["trading_session"] == "position"
                and len(row["contract_date"]) == 6
                and row["volume"] > 0):
            xq_dt = _dt.strptime(row["date"], "%Y-%m-%d") - timedelta(days=1)
            if xq_dt.weekday() == 5:    # 落到週六 → 退到週五
                xq_dt -= timedelta(days=1)
            elif xq_dt.weekday() == 6:  # 落到週日 → 退到週五
                xq_dt -= timedelta(days=2)
            xq_date = xq_dt.strftime("%Y-%m-%d")
            if xq_date not in by_date or row["volume"] > by_date[xq_date]["volume"]:
                by_date[xq_date] = row

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


# ── 結算日與交易日計算 ─────────────────────────────────────────

def get_settlement_date(ref_date=None):
    """取得台指期當月結算日（第三個週三）。若已過結算日則取下月。"""
    from datetime import date as _date
    d = ref_date or _date.today()
    # 找當月第三個週三
    first = d.replace(day=1)
    wednesdays = []
    for i in range(31):
        candidate = first.replace(day=1)
        try:
            candidate = _date(first.year, first.month, 1 + i)
        except ValueError:
            break
        if candidate.month != first.month:
            break
        if candidate.weekday() == 2:  # 週三
            wednesdays.append(candidate)
    settlement = wednesdays[2] if len(wednesdays) >= 3 else wednesdays[-1]
    # 若今天已過結算日，取下月
    if d > settlement:
        if first.month == 12:
            next_month = first.replace(year=first.year + 1, month=1)
        else:
            next_month = first.replace(month=first.month + 1)
        return get_settlement_date(next_month)
    return settlement


def count_trading_days(from_date, to_date):
    """計算 from_date 到 to_date（含兩端）之間的交易日數（週一到週五）。"""
    from datetime import timedelta as _td
    count = 0
    d = from_date
    while d <= to_date:
        if d.weekday() < 5:  # 0=Mon…4=Fri
            count += 1
        d += _td(days=1)
    return count


def calc_settlement_ratio(txF, mtxF, bp, sp, settlement, from_date=None):
    """
    結算比計算。
    公式：
      fut_net  = txF + mtxF/4
      opt_net  = bp - sp
      若 opt_net > 5000：pressure = abs(fut_net) + bp  ← 用總BP（非淨值）
      否則：            pressure = abs(fut_net)
      ratio = pressure / 結算前剩餘交易日數（不含 from_date 當天，含結算日）
    settlement: datetime.date 結算日
    from_date:  計算起點（預設今天，回填歷史時傳入資料日期）
    回傳 dict {fut_net, opt_net, pressure, tdays, ratio}
    """
    from datetime import date as _date, timedelta as _td
    base = from_date or _date.today()
    fut_net = txF + mtxF / 4
    opt_net = bp - sp
    pressure = abs(fut_net) + (bp if opt_net > 5000 else 0)
    tdays = count_trading_days(base + _td(days=1), settlement)
    ratio = round(pressure / tdays) if tdays > 0 else 0
    return {
        "fut_net":  round(fut_net),
        "opt_net":  opt_net,
        "pressure": round(pressure),
        "tdays":    tdays,
        "ratio":    ratio,
    }


# ── 結算比歷史資料（每日 append）────────────────────────────────

def fetch_settlement_history_backfill(n_days=30):
    """
    用 FinMind 一次性回填結算比歷史。
    TX/MTX 外資未平倉 + TXO 全機構 PUT BP/SP。
    """
    from datetime import date as _date, timedelta as _td, datetime as _dt
    start = (_date.today() - _td(days=n_days + 15)).strftime("%Y-%m-%d")

    def _get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read()).get("data", [])

    token = _os.getenv("FINMIND_TOKEN", "").strip()
    tok_param = f"&token={token}" if token else ""

    # 外資期貨
    def get_fut(ticker):
        rows = _get(f"https://api.finmindtrade.com/api/v4/data"
                    f"?dataset=TaiwanFuturesInstitutionalInvestors&data_id={ticker}&start_date={start}{tok_param}")
        by_date = {}
        for row in rows:
            by_date.setdefault(row["date"], []).append(row)
        result = {}
        for dt, day_rows in by_date.items():
            if len(day_rows) >= 3:
                r = day_rows[2]  # 外資
                result[dt] = r["long_open_interest_balance_volume"] - r["short_open_interest_balance_volume"]
        return result

    # 全機構 PUT
    def get_put():
        rows = _get(f"https://api.finmindtrade.com/api/v4/data"
                    f"?dataset=TaiwanOptionInstitutionalInvestors&data_id=TXO&start_date={start}{tok_param}")
        by_date = {}
        for row in rows:
            by_date.setdefault(row["date"], []).append(row)
        result = {}
        for dt, day_rows in by_date.items():
            put_rows = day_rows[3:6] if len(day_rows) >= 6 else []
            bp = sum(r["long_open_interest_balance_volume"] for r in put_rows)
            sp = sum(r["short_open_interest_balance_volume"] for r in put_rows)
            result[dt] = {"bp": bp, "sp": sp}
        return result

    tx  = get_fut("TX")
    mtx = get_fut("MTX")
    put = get_put()

    # 去除週末重複（FinMind 節假日沿用前一天數值）
    all_days = sorted(set(tx) & set(mtx))
    prev = None
    records = []
    for d in all_days:
        cur = (tx[d], mtx[d])
        if cur == prev:
            continue
        prev = cur
        dt_obj = _dt.strptime(d, "%Y-%m-%d")
        if dt_obj.weekday() >= 5:  # 六日跳過
            continue
        o = put.get(d, {})
        txF  = tx[d]
        mtxF = mtx.get(d, 0)
        bp   = o.get("bp", 0)
        sp   = o.get("sp", 0)
        d_date     = _dt.strptime(d, "%Y-%m-%d").date()
        row_settle = get_settlement_date(d_date)
        sr   = calc_settlement_ratio(txF, mtxF, bp, sp, row_settle, from_date=d_date)
        records.append({
            "date":     d,
            "txF":      txF,
            "mtxF":     mtxF,
            "bp":       bp,
            "sp":       sp,
            "fut_net":  sr["fut_net"],
            "opt_net":  sr["opt_net"],
            "pressure": sr["pressure"],
            "tdays":    sr["tdays"],
            "ratio":    sr["ratio"],
        })

    return records[-n_days:]


def build_settlement_history(existing: list, today_entry: dict) -> list:
    """
    將今日 TAIFEX openapi 的資料 append 到歷史陣列。
    若今日已存在則覆蓋（重跑時更新），最多保留 60 筆。
    """
    today = today_entry["date"]
    history = [r for r in existing if r["date"] != today]
    history.append(today_entry)
    history.sort(key=lambda r: r["date"])
    return history[-60:]


# ── 主程式 ────────────────────────────────────────────────────
import os as _os, sys as _sys

FUT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate")
OPT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate")

# ── 讀取既有 JSON（後面若抓失敗可 fallback）────────────────────
existing_json = {}
try:
    with open("taifex_data.json", "r", encoding="utf-8") as f:
        existing_json = json.load(f)
except Exception:
    pass

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

# 若期貨/選擇權抓失敗，沿用既有資料（防止空資料覆蓋）
if not futures or not date:
    print("futures 抓失敗，沿用既有資料")
    futures = existing_json.get("futures", {})
    date    = existing_json.get("date")
if not options or options.get("bc", 0) + options.get("sp", 0) == 0:
    print("options 抓失敗或為零，沿用既有資料")
    options = existing_json.get("options", {})

# ── 三大法人（TWSE，存入 JSON 供前端讀取，繞過 CORS）──────────
def fetch_institute():
    from datetime import date as _d, timedelta as _td
    today = _d.today()
    for i in range(10):
        d = today - _td(days=i)
        if d.weekday() >= 5:
            continue
        dt_str = d.strftime("%Y%m%d")
        url = (f"https://www.twse.com.tw/rwd/zh/fund/BFI82U"
               f"?dayDate={dt_str}&weekDate=&monthDate=&type=day&response=json")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                j = json.loads(r.read())
            rows = j.get("data", [])
            if not rows:
                continue
            def find(kw1, kw2=None):
                for row in rows:
                    if kw1 in row[0] or (kw2 and kw2 in row[0]):
                        return round(float(row[3].replace(",", "")) / 1e8, 1)
                return None
            foreign = find("外資及陸資(不含外資自營商)", "外資")
            trust   = find("投信")
            dealer  = find("自營商(自行買賣)", "自營商")
            if foreign is None and trust is None:
                continue
            total = round((foreign or 0) + (trust or 0) + (dealer or 0), 1)
            print(f"institute OK  date={dt_str}  foreign={foreign}  trust={trust}  dealer={dealer}")
            return {"date": dt_str, "foreign": foreign, "trust": trust,
                    "dealer": dealer, "total": total}
        except Exception as e:
            print(f"institute {dt_str} FAIL: {e}")
            continue
    return {}

institute = {}
try:
    institute = fetch_institute()
except Exception as e:
    print(f"institute FAIL: {e}")

if not institute:
    print("institute 抓失敗，沿用既有資料")
    institute = existing_json.get("institute", {})

# 波動資料：TX 用 FinMind position session（日盤+夜盤完整），NQ 用 Yahoo Finance
tx_records = []
try:
    tx_records = fetch_tx_ohlc(25)
    print(f"TX OHLC OK  {len(tx_records)} days  latest={tx_records[-1] if tx_records else None}")
except Exception as e:
    print(f"TX OHLC FAIL: {e}")

nq_records = []
try:
    nq_records = fetch_yahoo_ohlc("NQ=F", 25)
    print(f"NQ OHLC OK  {len(nq_records)} days")
except Exception as e:
    print(f"NQ OHLC FAIL: {e}")

tx_vol = build_vol_data(tx_records, "TX")
nq_vol = build_vol_data(nq_records, "NQ")

# ── 結算比歷史 ───────────────────────────────────────────────
existing_history = existing_json.get("settlement_history", [])

# 若歷史不足 5 筆，用 FinMind 回填
if len(existing_history) < 5:
    print("settlement_history 不足，執行 FinMind 回填...")
    try:
        existing_history = fetch_settlement_history_backfill(30)
        print(f"FinMind 回填完成：{len(existing_history)} 筆")
    except Exception as e:
        print(f"FinMind 回填失敗：{e}")

# 今日 TAIFEX openapi 資料（只在有期貨資料時 append）
settlement_date = get_settlement_date()
print(f"settlement date: {settlement_date}")

if futures and date:
    today_iso = f"{date[:4]}-{date[4:6]}-{date[6:]}"
    from datetime import date as _date2
    taifex_date = _date2(int(date[:4]), int(date[4:6]), int(date[6:]))
    txF  = futures.get("txF", 0)
    mtxF = futures.get("mtxF", 0)
    bp   = options.get("bp", 0)
    sp   = options.get("sp", 0)
    sr   = calc_settlement_ratio(txF, mtxF, bp, sp, settlement_date, from_date=taifex_date)
    today_entry = {
        "date":     today_iso,
        "txF":      txF,
        "mtxF":     mtxF,
        "bp":       bp,
        "sp":       sp,
        "fut_net":  sr["fut_net"],
        "opt_net":  sr["opt_net"],
        "pressure": sr["pressure"],
        "tdays":    sr["tdays"],
        "ratio":    sr["ratio"],
    }
    existing_history = build_settlement_history(existing_history, today_entry)
    print(f"settlement_history updated: {len(existing_history)} 筆, latest={today_iso}, ratio={sr['ratio']}")

result = {
    "date":               date,
    "futures":            futures,
    "options":            options,
    "institute":          institute,
    "settlement_date":    settlement_date.strftime("%Y-%m-%d"),
    "settlement_history": existing_history,
    "volatility":         {"tx": tx_vol, "nq": nq_vol},
    "updated_at":         datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}

with open("taifex_data.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("taifex_data.json written OK")
