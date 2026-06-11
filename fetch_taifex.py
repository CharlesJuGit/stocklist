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
    import time
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read()
            try:
                text = raw.decode("utf-8")
                if "\ufffd" in text:
                    raise ValueError
            except (ValueError, UnicodeDecodeError):
                text = raw.decode("big5", errors="replace")
            return text
        except Exception as e:
            if attempt < 2:
                print(f"fetch_csv attempt {attempt+1} failed: {e}, retrying...")
                time.sleep(3)
            else:
                raise


def parse_rows(text):
    rows = []
    for line in text.strip().split("\n"):
        parts = [p.strip().strip('"') for p in line.split(",")]
        if len(parts) > 3 and len(parts[0]) == 8 and parts[0].isdigit():
            rows.append(parts)
    return rows


# ── TAIFEX 網頁爬蟲（比 openapi 更快更新）────────────────────

def scrape_taifex_web():
    """
    從 TAIFEX 網頁爬期貨/選擇權未平倉，比 openapi 更新更及時。
    回傳 (date_str, futures_dict, options_dict)，失敗回傳 (None, {}, {})
    """
    import re, urllib.parse as _up

    def _post(path, params):
        url = f"https://www.taifex.com.tw{path}"
        data = _up.urlencode(params).encode()
        req = urllib.request.Request(url, data=data, headers={
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/x-www-form-urlencoded",
        })
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode("utf-8", errors="replace")

    def _nums(html):
        """期貨頁：頁面有兩組相同數字（上下表），只取前半。"""
        raw = re.findall(r'class="(?:blue|red)">\s*([-\d,]+)\s*</span>', html)
        half = len(raw) // 2
        return [int(n.replace(",", "")) for n in raw[:half]]

    def _nums_all(html):
        """選擇權頁：取全部數字，不做截半。"""
        raw = re.findall(r'class="(?:blue|red)">\s*([-\d,]+)\s*</span>', html)
        return [int(n.replace(",", "")) for n in raw]

    def _date(html):
        m = re.search(r"(\d{4}/\d{2}/\d{2})", html)
        return m.group(1).replace("/", "") if m else None

    # 期貨 TXF
    try:
        html_txf = _post("/cht/3/futContractsDate", {
            "queryStartDate": "", "queryEndDate": "", "commodityId": "TXF"})
        date = _date(html_txf)
        txf_nums = _nums(html_txf)
        # 每機構9個數值，外資=第3組(idx18:27)，淨部位在 index 6 of each group
        # 結構: [買多口數,賣多口數,買多契約金額,賣多契約金額,買空口數,賣空口數,淨部位,...]
        # 外資淨部位 = txf_nums[17] (每組9個，外資第3組，第7個=index6)
        txF = txf_nums[17] if len(txf_nums) > 17 else 0
    except Exception as e:
        print(f"scrape TXF fail: {e}")
        return None, {}, {}

    # 期貨 MXF（小台）
    try:
        html_mxf = _post("/cht/3/futContractsDate", {
            "queryStartDate": "", "queryEndDate": "", "commodityId": "MXF"})
        mxf_nums = _nums(html_mxf)
        mtxF = mxf_nums[17] if len(mxf_nums) > 17 else 0
    except Exception as e:
        print(f"scrape MXF fail: {e}")
        mtxF = 0

    # 期貨 TMF（微台）
    try:
        html_tmf = _post("/cht/3/futContractsDate", {
            "queryStartDate": "", "queryEndDate": "", "commodityId": "TMF"})
        tmf_nums = _nums(html_tmf)
        tmxF = tmf_nums[17] if len(tmf_nums) > 17 else 0
    except Exception as e:
        print(f"scrape TMF fail: {e}")
        tmxF = 0

    # 選擇權 TXO
    # 網頁結構：CALL表(3機構×6欄) + PUT表(3機構×6欄) = 36個數字
    # 每機構6欄：[交易買口, 交易買金額, 交易賣口, 交易賣金額, 未平倉買口, 未平倉賣口]
    # 欄位 index 4=未平倉買口(BC/BP), 5=未平倉賣口(SC/SP)
    # 外資 = 第3行(row 2)，CALL: idx 2*6+4=16(BC), 2*6+5=17(SC)...
    # 等等，重新確認：6欄順序為[交易買口數, 交易賣口數, 交易買金額, 交易賣金額, 未平倉買口數, 未平倉賣口數]
    # 依用戶確認：BC=nums[15], SC=nums[16] (CALL外資 index 2*6+3, 2*6+4)
    # PUT外資：BP=nums[33], SP=nums[34] (index 18+2*6+3, 18+2*6+4)
    try:
        html_opt = _post("/cht/3/callsAndPutsDate", {
            "queryStartDate": "", "queryEndDate": "", "commodityId": "TXO"})
        opt_nums = _nums_all(html_opt)
        print(f"scrape TXO raw count={len(opt_nums)}: {opt_nums}")
        # CALL 外資（row 2）：6欄從 index 12 開始，未平倉買=idx 15, 未平倉賣=idx 16
        bc = opt_nums[15] if len(opt_nums) > 15 else 0
        sc = opt_nums[16] if len(opt_nums) > 16 else 0
        # PUT 外資（row 2）：6欄從 index 30 開始，未平倉買=idx 33, 未平倉賣=idx 34
        bp = opt_nums[33] if len(opt_nums) > 33 else 0
        sp = opt_nums[34] if len(opt_nums) > 34 else 0
    except Exception as e:
        print(f"scrape TXO fail: {e}")
        bc = sc = bp = sp = 0

    futures = {
        "txF": txF, "txT": 0, "txD": 0,
        "mtxF": mtxF, "mtxT": 0, "mtxD": 0,
        "tmxF": tmxF, "tmxT": 0, "tmxD": 0,
    }
    options = {"bc": bc, "sc": sc, "bp": bp, "sp": sp}
    print(f"scrape_taifex_web OK: date={date} txF={txF} mtxF={mtxF} tmxF={tmxF} bc={bc} bp={bp}")
    return date, futures, options


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


# ── 上市+上櫃 成交量（億元） ─────────────────────────────────

def fetch_market_volume(n_days=20):
    """
    抓取上市（TWSE）＋上櫃（TPEx）每日成交金額，單位：億元。
    TWSE: openapi.twse.com.tw/v1/exchangeReport/FMTQIK
    TPEx: www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex
    """
    from datetime import date as _date, timedelta as _td

    twse_by_date = {}
    try:
        import ssl as _ssl
        ctx = _ssl._create_unverified_context()
        url = "https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            d = json.loads(resp.read().decode("utf-8", errors="replace"))
        for r in d.get("data", []):
            # r[0]='115/05/27', r[2]=成交金額
            parts = r[0].split("/")
            date_str = f"{int(parts[0])+1911}-{parts[1]}-{parts[2]}"
            val = int(r[2].replace(",", "")) // 100_000_000
            twse_by_date[date_str] = val
    except Exception as e:
        print(f"TWSE volume fail: {e}")

    tpex_by_date = {}
    try:
        url = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            d = json.loads(resp.read())
        for r in d["tables"][0]["data"]:
            parts = r[0].split("/")          # '115/05/27'
            year = int(parts[0]) + 1911
            date_str = f"{year}-{parts[1]}-{parts[2]}"
            val = int(r[2].replace(",", "")) * 1000 // 100_000_000
            tpex_by_date[date_str] = val
    except Exception as e:
        print(f"TPEx volume fail: {e}")

    all_dates = sorted(set(twse_by_date) | set(tpex_by_date))
    records = []
    for dt in all_dates:
        if datetime.strptime(dt, "%Y-%m-%d").weekday() >= 5:
            continue
        twse = twse_by_date.get(dt, 0)
        tpex = tpex_by_date.get(dt, 0)
        if twse == 0 and tpex == 0:
            continue
        records.append({"date": dt, "twse": twse, "tpex": tpex, "total": twse + tpex})

    return records[-n_days:] if len(records) >= n_days else records


# ── FinMind 台指期 OHLC ──────────────────────────────────────

def fetch_tx_ohlc(n_days=25):
    """
    從 FinMind 抓台指期（TX）每日高低點。
    XQ 定義：一天 = 當日下午 3:00（夜盤開）到隔日下午 1:45（日盤收）
    對應 FinMind 兩個 session 取 max high / min low：
      - after_market：夜盤（3PM~5AM），日期 = 開始當天
      - position：日盤（8:45AM~1:45PM），日期 = 當天
    XQ date D = combine(after_market[D], position[D])
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

    # 分別取 after_market 和 position，近月合約（6位）成交量最大者
    am_by_date = {}   # after_market（夜盤）
    pos_by_date = {}  # position（日盤）

    for row in rows:
        session = row["trading_session"]
        if len(row["contract_date"]) == 6 and row["volume"] > 0:
            dt = row["date"]
            if session == "after_market":
                if dt not in am_by_date or row["volume"] > am_by_date[dt]["volume"]:
                    am_by_date[dt] = row
            elif session == "position":
                if dt not in pos_by_date or row["volume"] > pos_by_date[dt]["volume"]:
                    pos_by_date[dt] = row

    # 合併兩個 session：max high, min low
    all_dates = sorted(set(am_by_date) | set(pos_by_date))
    # 只取週一到週五
    all_dates = [d for d in all_dates if _dt.strptime(d, "%Y-%m-%d").weekday() < 5]

    records = []
    for dt in all_dates:
        am = am_by_date.get(dt)
        pos = pos_by_date.get(dt)
        if not am and not pos:
            continue
        highs = [r["max"] for r in [am, pos] if r]
        lows  = [r["min"] for r in [am, pos] if r]
        h, l = round(max(highs)), round(min(lows))
        if h == 0 and l == 0:
            continue
        records.append({"date": dt, "high": h, "low": l, "range": h - l})

    return records[-n_days:] if len(records) >= n_days else records


# ── Yahoo Finance OHLC（NQ 期貨）────────────────────────────

def fetch_yahoo_ohlc(symbol, n_days=25):
    """
    抓 NQ 期貨 1h K 棒，以台灣時間（UTC+8）每天凌晨 5:00 為分界分組。
    週五的 K 棒跨越週末，包含到週一早上 5:00（NQ 週日晚重新開盤後的那段）。
    週六/週日的 bar 一律歸入上週五。
    """
    from datetime import date as _date, timedelta as _td
    TW = timezone(timedelta(hours=8))

    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?interval=1h&range=60d")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    result = data["chart"]["result"][0]
    timestamps = result["timestamp"]
    q = result["indicators"]["quote"][0]

    day_high = {}
    day_low  = {}

    for i, ts in enumerate(timestamps):
        h = q["high"][i]
        l = q["low"][i]
        if h is None or l is None:
            continue

        tw_dt   = datetime.fromtimestamp(ts, tz=TW)
        tw_date = tw_dt.date()

        # 凌晨 6:00 前歸屬到前一天
        # NQ 每日收盤 5PM EDT（夏令=5AM TWN）/ 5PM EST（冬令=6AM TWN）
        # 用 6AM 作分界，確保兩種時制都能包含最後一根 bar
        if tw_dt.hour < 6:
            tw_date = tw_date - _td(days=1)

        # 週六 → 上週五，週日 → 上週五
        wd = tw_date.weekday()  # 0=Mon…6=Sun
        if wd == 5:
            tw_date = tw_date - _td(days=1)
        elif wd == 6:
            tw_date = tw_date - _td(days=2)

        d = tw_date.strftime("%Y-%m-%d")
        day_high[d] = max(day_high.get(d, 0), h)
        day_low[d]  = min(day_low.get(d, float('inf')), l)

    records = []
    for d in sorted(day_high):
        if datetime.strptime(d, "%Y-%m-%d").weekday() >= 5:
            continue
        h = round(day_high[d])
        l = round(day_low[d])
        records.append({"date": d, "high": h, "low": l, "range": h - l})

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
      opt_net >= 10000：pressure = abs(fut_net) + bp
      opt_net >  5000：pressure = abs(fut_net) + bp * 0.8
      否則：           pressure = abs(fut_net)
      ratio = pressure / 結算前剩餘交易日數（不含 from_date 當天，含結算日）
    settlement: datetime.date 結算日
    from_date:  計算起點（預設今天，回填歷史時傳入資料日期）
    回傳 dict {fut_net, opt_net, pressure, tdays, ratio}
    """
    from datetime import date as _date, timedelta as _td
    base = from_date or _date.today()
    fut_net = txF + mtxF / 4
    opt_net = bp - sp
    if opt_net >= 10000:
        bp_add = bp
    elif opt_net > 5000:
        bp_add = bp * 0.8
    else:
        bp_add = 0
    pressure = abs(fut_net) + bp_add
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

# TAIFEX 未平倉：優先用網頁爬蟲（更新更及時），失敗再用 openapi
date, futures, options = None, {}, {}
try:
    date, futures, options = scrape_taifex_web()
except Exception as e:
    print(f"scrape_taifex_web FAIL: {e}")

# 網頁爬蟲失敗，fallback 到 openapi
if not futures or not date:
    print("網頁爬蟲失敗，改用 openapi...")
    try:
        fut_text = fetch_csv(FUT_URL)
        date, futures = parse_futures(fut_text)
        print(f"openapi futures OK  date={date}  txF={futures.get('txF')}")
    except Exception as e:
        print(f"openapi futures FAIL: {e}")
    try:
        opt_text = fetch_csv(OPT_URL)
        options = parse_options(opt_text)
        print(f"openapi options OK  bc={options.get('bc')}")
    except Exception as e:
        print(f"openapi options FAIL: {e}")

# 若全部抓失敗，沿用既有資料（防止空資料覆蓋）
if not futures or not date:
    print("全部抓失敗，沿用既有資料")
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

if not tx_records:
    print("TX OHLC 抓失敗，沿用既有資料")
    tx_records = existing_json.get("volatility", {}).get("tx", {}).get("history", [])

nq_records = []
try:
    nq_records = fetch_yahoo_ohlc("NQ=F", 25)
    print(f"NQ OHLC OK  {len(nq_records)} days")
except Exception as e:
    print(f"NQ OHLC FAIL: {e}")

if not nq_records:
    print("NQ OHLC 抓失敗，沿用既有資料")
    nq_records = existing_json.get("volatility", {}).get("nq", {}).get("history", [])

market_volume = []
try:
    market_volume = fetch_market_volume(20)
    print(f"Market volume OK  {len(market_volume)} days  latest={market_volume[-1] if market_volume else None}")
except Exception as e:
    print(f"Market volume FAIL: {e}")
    market_volume = existing_json.get("market_volume", [])

tx_vol = build_vol_data(tx_records, "TX")
nq_vol = build_vol_data(nq_records, "NQ")

# ── 結算比歷史 ───────────────────────────────────────────────
existing_history = existing_json.get("settlement_history", [])

# 若歷史完全空白，用 FinMind 回填
if len(existing_history) == 0:
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
    mtxT = futures.get("mtxT", 0); mtxD = futures.get("mtxD", 0)
    tmxF = futures.get("tmxF", 0); tmxT = futures.get("tmxT", 0); tmxD = futures.get("tmxD", 0)
    bp   = options.get("bp", 0)
    sp   = options.get("sp", 0)
    bc   = options.get("bc", 0)
    sc   = options.get("sc", 0)
    sr   = calc_settlement_ratio(txF, mtxF, bp, sp, settlement_date, from_date=taifex_date)

    # 散戶淨部位
    mtx_retail = -(mtxF + mtxT + mtxD)
    tmx_retail = -(tmxF + tmxT + tmxD) / 5
    retail_total = round(mtx_retail + tmx_retail)

    # 外資選擇權策略
    THRESHOLD = 1000
    call_bias = "long" if bc > sc + THRESHOLD else ("short" if sc > bc + THRESHOLD else "neutral")
    put_bias  = "long" if bp > sp + THRESHOLD else ("short" if sp > bp + THRESHOLD else "neutral")
    if call_bias == "long"  and put_bias == "long":  opt_strategy = "雙買"
    elif call_bias == "short" and put_bias == "short": opt_strategy = "雙賣"
    elif call_bias == "long"  and put_bias == "short": opt_strategy = "看多"
    elif call_bias == "short" and put_bias == "long":  opt_strategy = "看空"
    else: opt_strategy = "中性"

    today_entry = {
        "date":         today_iso,
        "txF":          txF,
        "mtxF":         mtxF,
        "bp":           bp,
        "sp":           sp,
        "bc":           bc,
        "sc":           sc,
        "fut_net":      sr["fut_net"],
        "opt_net":      sr["opt_net"],
        "pressure":     sr["pressure"],
        "tdays":        sr["tdays"],
        "ratio":        sr["ratio"],
        "retail_total": retail_total,
        "opt_strategy": opt_strategy,
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
    "market_volume":      market_volume,
    "updated_at":         datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}

with open("taifex_data.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("taifex_data.json written OK")
