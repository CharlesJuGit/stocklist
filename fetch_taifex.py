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

    def _nums_all(html):
        """選擇權頁：取全部數字，不做截半。"""
        raw = re.findall(r'class="(?:blue|red)">\s*([-\d,]+)\s*</span>', html)
        return [int(n.replace(",", "")) for n in raw]

    def _date(html):
        m = re.search(r"(\d{4}/\d{2}/\d{2})", html)
        return m.group(1).replace("/", "") if m else None

    def _fut_nets(cid):
        """
        抓單一商品頁，回傳 (html, 自營淨OI, 投信淨OI, 外資淨OI)。
        頁面結構（2026-06-11 實證）：每機構 6 個數字
          [交易買口, 交易賣口, 交易淨口, 未平倉買口, 未平倉賣口, 未平倉淨口]
        淨OI索引：自營=5、投信=11、外資=17；全部數字的 index 40 為三大法人淨OI合計（驗算用）
        """
        html = _post("/cht/3/futContractsDate", {
            "queryStartDate": "", "queryEndDate": "", "commodityId": cid})
        nums = _nums_all(html)
        if len(nums) < 18:
            raise ValueError(f"{cid} 頁面數字不足（{len(nums)} 個）")
        d, t, f = nums[5], nums[11], nums[17]
        # 驗算：三者和應等於頁面的三大法人合計
        if len(nums) > 40 and d + t + f != nums[40]:
            print(f"scrape {cid} 驗算警告: 自營{d}+投信{t}+外資{f} != 合計{nums[40]}")
        return html, d, t, f

    # 期貨 TXF（大台）
    try:
        html_txf, txD, txT, txF = _fut_nets("TXF")
        date = _date(html_txf)
    except Exception as e:
        print(f"scrape TXF fail: {e}")
        return None, {}, {}

    # 期貨 MXF（小台）
    try:
        _, mtxD, mtxT, mtxF = _fut_nets("MXF")
    except Exception as e:
        print(f"scrape MXF fail: {e}")
        mtxD = mtxT = mtxF = 0

    # 期貨 TMF（微台）
    try:
        _, tmxD, tmxT, tmxF = _fut_nets("TMF")
    except Exception as e:
        print(f"scrape TMF fail: {e}")
        tmxD = tmxT = tmxF = 0

    # 選擇權 TXO（只取外資未平倉，與 institute/結算比一致）
    # 網頁數字序：CALL 表 3 機構各 6 欄(共18) + PUT 表 3 機構各 6 欄(共18)。
    # 外資為各表第 3 機構。實證對應索引：
    #   CALL 外資未平倉買=BC=nums[15]、賣=SC=nums[16]
    #   PUT  外資未平倉買=BP=nums[33]、賣=SP=nums[34]
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
        "txF": txF, "txT": txT, "txD": txD,
        "mtxF": mtxF, "mtxT": mtxT, "mtxD": mtxD,
        "tmxF": tmxF, "tmxT": tmxT, "tmxD": tmxD,
    }
    options = {"bc": bc, "sc": sc, "bp": bp, "sp": sp}
    print(f"scrape_taifex_web OK: date={date} txF={txF} "
          f"mtx(D/T/F)={mtxD}/{mtxT}/{mtxF} tmx(D/T/F)={tmxD}/{tmxT}/{tmxF} bc={bc} bp={bp}")
    return date, futures, options


# ── 期貨未平倉 ────────────────────────────────────────────────

def parse_futures(text):
    # API 回傳 JSON，ContractCode/Item 為乾淨中文（2026-06-14 實證）。
    # 依「商品名＋身份別」比對 OpenInterest(Net)，取代原本的固定位置索引，
    # 避免 TAIFEX 調整列順序或新增商品時整批錯位（沉默抓錯）。
    try:
        data = json.loads(text)
    except Exception:
        data = None

    if data and isinstance(data, list) and len(data) > 2:
        def net(product, investor):
            for row in data:
                if row.get("ContractCode") == product and investor in str(row.get("Item", "")):
                    val = row.get("OpenInterest(Net)", "0") or "0"
                    return int(str(val).replace(",", ""))
            return 0
        date = data[0].get("Date", "")
        return date, {
            "txF":  net("臺股期貨", "外資"),   "txT":  net("臺股期貨", "投信"),   "txD":  net("臺股期貨", "自營商"),
            "mtxF": net("小型臺指期貨", "外資"), "mtxT": net("小型臺指期貨", "投信"), "mtxD": net("小型臺指期貨", "自營商"),
            "tmxF": net("微型臺指期貨", "外資"), "tmxT": net("微型臺指期貨", "投信"), "tmxD": net("微型臺指期貨", "自營商"),
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
        "tmxF": find_net("微型臺指期貨", "外資"), "tmxT": find_net("微型臺指期貨", "投信"),
        "tmxD": find_net("微型臺指期貨", "自營"),
    }


# ── 選擇權未平倉 ──────────────────────────────────────────────

def parse_options(text):
    # 優先嘗試 JSON 格式（API 目前回傳 JSON，ContractCode 亂碼但位置固定）
    try:
        data = json.loads(text)
    except Exception:
        data = None

    if data and isinstance(data, list) and len(data) >= 6:
        # 只取「外資」身份別，與網頁爬蟲（主來源）一致；
        # 原本加總自營+投信+外資是三大法人合計，與外資策略/PC 標籤不符（量級約 3 倍）
        first_code = data[0].get("ContractCode", "")
        bc = sc = bp = sp = 0
        for row in data:
            if row.get("ContractCode", "") != first_code:
                break
            if "外資" not in str(row.get("Item", "")):
                continue
            cp = row.get("CallPut", "")
            lo = int(str(row.get("OpenInterest(Long)",  0) or 0).replace(",", ""))
            so = int(str(row.get("OpenInterest(Short)", 0) or 0).replace(",", ""))
            if cp == "CALL":
                bc += lo;  sc += so
            elif cp == "PUT":
                bp += lo;  sp += so
        return {"bc": bc, "sc": sc, "bp": bp, "sp": sp}

    # fallback: 舊版 CSV 格式（openapi 已改回 JSON，此路目前不會觸發；
    # 為 legacy 保留，未做外資過濾，若 API 退回 CSV 需重新確認身份別欄位）
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

def fetch_market_volume(n_days=45):
    """
    抓取上市（TWSE）＋上櫃（TPEx）每日成交金額，單位：億元。
    兩來源都是月表，抓「上月＋本月」避免月初只剩少數天數。
    來源偶發回空資料（無例外的沉默失敗），各月最多重試 3 次並印警告。
    TWSE: www.twse.com.tw/rwd FMTQIK
    TPEx: www.tpex.org.tw tradingIndex
    """
    import time as _time
    import ssl as _ssl
    from datetime import date as _date, timedelta as _td

    ctx = _ssl._create_unverified_context()
    today = _date.today()
    prev_month_day = today.replace(day=1) - _td(days=1)

    twse_by_date = {}
    for ym in (prev_month_day, today):
        url = (f"https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK"
               f"?date={ym.strftime('%Y%m01')}&response=json")
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    d = json.loads(resp.read().decode("utf-8", errors="replace"))
                rows = d.get("data", [])
                if not rows:
                    raise ValueError(f"回應無資料（stat={d.get('stat')}）")
                for r in rows:
                    # r[0]='115/05/27', r[2]=成交金額（元）
                    parts = r[0].split("/")
                    date_str = f"{int(parts[0])+1911}-{parts[1]}-{parts[2]}"
                    twse_by_date[date_str] = int(r[2].replace(",", "")) // 100_000_000
                break
            except Exception as e:
                print(f"TWSE volume {ym.strftime('%Y-%m')} 第{attempt+1}次失敗: {e}")
                _time.sleep(3)
    if not twse_by_date:
        print("TWSE volume 完全失敗（merge 後沿用既有資料）")

    tpex_by_date = {}
    for ym in (prev_month_day, today):
        roc = f"{ym.year - 1911}/{ym.month:02d}/01"
        url = f"https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex?date={roc}&response=json"
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    d = json.loads(resp.read())
                rows = d["tables"][0]["data"]
                if not rows:
                    raise ValueError("回應無資料")
                for r in rows:
                    parts = r[0].split("/")          # '115/05/27'
                    date_str = f"{int(parts[0])+1911}-{parts[1]}-{parts[2]}"
                    tpex_by_date[date_str] = int(r[2].replace(",", "")) * 1000 // 100_000_000
                break
            except Exception as e:
                print(f"TPEx volume {ym.strftime('%Y-%m')} 第{attempt+1}次失敗: {e}")
                _time.sleep(3)
    if not tpex_by_date:
        print("TPEx volume 完全失敗（merge 後沿用既有資料）")

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


def merge_market_volume(existing: list, fetched: list, keep: int = 30) -> list:
    """
    以日期合併新舊成交量記錄：新值非零才覆蓋，零或缺漏沿用舊值。
    單次抓取失敗（沉默回空/回零）不會再清掉整串歷史。
    """
    by_date = {r["date"]: dict(r) for r in existing if r.get("date")}
    for r in fetched:
        old = by_date.get(r["date"], {})
        twse = r["twse"] or old.get("twse", 0)
        tpex = r["tpex"] or old.get("tpex", 0)
        by_date[r["date"]] = {"date": r["date"], "twse": twse, "tpex": tpex, "total": twse + tpex}
    return [by_date[d] for d in sorted(by_date)][-keep:]


# ── FinMind 台指期 OHLC ──────────────────────────────────────

def fetch_tx_ohlc(n_days=25):
    """
    從 TAIFEX 官方期貨每日行情（www.taifex.com.tw/cht/3/futDataDown）抓台指期（TX）每日高低點。
    改用 TAIFEX 取代 FinMind：GitHub Actions 連 FinMind 硬失敗（2026-06 TX 波動無聲凍結即此因），
    而 www.taifex.com.tw 在 Actions 一直可連（同 scrape_taifex_web）。
    CSV「交易時段」：一般=日盤、盤後=夜盤；XQ date D = combine(日盤[D], 夜盤[D]) 取 max高/min低。
    口徑與原 FinMind 版逐日實證一致（2026-06-23，近25日 8/8 吻合）。
    沿用兩項修正：每日取「當天總量最大的單一近月合約」（6-15 跨合約污染）、
    需日盤+夜盤皆到齊才算完整日（6-21 跨 session 不完整）。
    """
    import time as _time, ssl as _ssl, collections
    import urllib.parse as _up
    from datetime import date as _date, timedelta as _td
    ctx = _ssl._create_unverified_context()

    def _fetch_batch(s, e):
        body = _up.urlencode({"down_type": "1", "commodity_id": "TX",
                              "queryStartDate": s, "queryEndDate": e}).encode()
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    "https://www.taifex.com.tw/cht/3/futDataDown", data=body,
                    headers={"User-Agent": "Mozilla/5.0",
                             "Content-Type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
                    return r.read().decode("big5", errors="replace")
            except Exception as ex:
                print(f"fetch_tx_ohlc TAIFEX {s}~{e} 第{attempt+1}次失敗: {ex}")
                _time.sleep(3)
        return ""

    # futDataDown 單次查詢上限約 22 天，分批往前抓再拼接（每批 20 天、往前數批覆蓋足夠交易日）
    vol_by = collections.defaultdict(int)   # (date, contract) -> 總量
    row_by = {}                             # (date, contract, session) -> (high, low)
    cur = _date.today()
    for _ in range(max(4, n_days // 6)):
        s = (cur - _td(days=20)).strftime("%Y/%m/%d")
        e = cur.strftime("%Y/%m/%d")
        for line in _fetch_batch(s, e).splitlines():
            p = [c.strip() for c in line.split(",")]
            if len(p) < 18 or p[1] != "TX":
                continue
            try:
                hi, lo, v = float(p[4]), float(p[5]), int(p[9])
            except ValueError:
                continue
            dt = p[0].replace("/", "-"); cd = p[2]; sess = p[17]
            vol_by[(dt, cd)] += v
            row_by[(dt, cd, sess)] = (hi, lo)
        cur = cur - _td(days=21)
        _time.sleep(0.3)

    best_contract = {}   # date -> 當天主力合約（總量最大，避免結算日跨月污染）
    for (dt, cd), v in vol_by.items():
        if dt not in best_contract or v > vol_by[(dt, best_contract[dt])]:
            best_contract[dt] = cd

    records = []
    skipped = []
    for dt in sorted(best_contract):
        cd = best_contract[dt]
        day   = row_by.get((dt, cd, "一般"))   # 日盤
        night = row_by.get((dt, cd, "盤後"))   # 夜盤
        # 完整交易日需日盤+夜盤皆到齊；只有單一 session（盤中/夜盤進行中）視為不完整，不輸出
        if day is None or night is None:
            skipped.append(dt)
            continue
        h, l = round(max(day[0], night[0])), round(min(day[1], night[1]))
        if h == 0 and l == 0:
            continue
        records.append({"date": dt, "high": h, "low": l, "range": h - l})

    if skipped:
        print(f"TX OHLC 略過不完整日（缺日盤或夜盤）：{', '.join(skipped[-3:])}")

    return records[-n_days:] if len(records) >= n_days else records


# ── 台指期正價差（近月/次月/季月 vs 加權指數現貨）──────────────
BASIS_MIN_VOL = 100  # 量 < 此值視為流動性薄，不顯示（避免舊掛單失真）

def fetch_basis(n_days=20):
    """近 n 交易日的台指期正價差：期貨各合約收盤 − 現貨加權指數。
    現貨＝TWSE FMTQIK 的發行量加權股價指數收盤（可靠，market_volume 同源）；
    期貨＝TAIFEX futDataDown 各到期月合約收盤（一般時段）。量薄合約不顯示。
    回傳 {date, spot, curve:[{label,basis}], history:[{date,spot,near,next,quarter}]}。"""
    import urllib.request as _u, urllib.parse as _up, collections, time as _time, ssl as _ssl
    ctx = _ssl._create_unverified_context()
    today = datetime.now()
    prev = today.replace(day=1) - timedelta(days=1)

    # 1) 現貨收盤（發行量加權股價指數 = r[4]）
    spot = {}
    for ym in (prev, today):
        url = (f"https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK"
               f"?date={ym.strftime('%Y%m01')}&response=json")
        for attempt in range(3):
            try:
                req = _u.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with _u.urlopen(req, timeout=15, context=ctx) as r:
                    j = json.loads(r.read().decode("utf-8", "replace"))
                for row in j.get("data", []):
                    p = row[0].split("/")
                    dt = f"{int(p[0])+1911}/{p[1]}/{p[2]}"
                    spot[dt] = float(row[4].replace(",", ""))
                break
            except Exception as e:
                print(f"basis 現貨 {ym.strftime('%Y-%m')} 第{attempt+1}次失敗: {e}")
                _time.sleep(2)

    # 2) 期貨各合約收盤＋量（一般時段、純月份合約）
    fut = collections.defaultdict(dict)   # date -> {month: (close, vol)}
    for b in range(2):
        e_b = today - timedelta(days=b * 20)
        s_b = e_b - timedelta(days=20)
        body = _up.urlencode({"down_type": "1", "commodity_id": "TX",
                              "queryStartDate": s_b.strftime("%Y/%m/%d"),
                              "queryEndDate": e_b.strftime("%Y/%m/%d")})
        raw = ""
        for attempt in range(3):
            try:
                req = _u.Request("https://www.taifex.com.tw/cht/3/futDataDown",
                                 data=body.encode(), headers={"User-Agent": "Mozilla/5.0"})
                with _u.urlopen(req, timeout=30, context=ctx) as r:
                    raw = r.read().decode("big5", "replace")
                break
            except Exception as e:
                print(f"basis 期貨批{b} 第{attempt+1}次失敗: {e}")
                _time.sleep(2)
        for ln in raw.strip().split("\n")[1:]:
            p = [c.strip() for c in ln.split(",")]
            if len(p) < 18 or p[1] != "TX" or p[17] != "一般" or "/" in p[2]:
                continue
            try:
                fut[p[0]][p[2]] = (float(p[6]), int(p[9]))
            except ValueError:
                continue
        _time.sleep(0.3)

    # 3) 每日 near/next/quarter 正價差（量薄→None）
    def basis_or_none(day, month):
        if month not in day:
            return None
        close, vol = day[month]
        return round(close - s) if vol >= BASIS_MIN_VOL else None

    history = []
    latest_curve, latest_dt, latest_spot = [], None, None
    for dt in sorted(fut):
        if dt not in spot:
            continue
        s = spot[dt]
        day = fut[dt]
        near_m = max(day, key=lambda m: day[m][1])          # 量最大＝近月主力
        months = sorted(m for m in day if m >= near_m)      # 近月及之後
        next_m = months[1] if len(months) > 1 else None
        quarter_m = next((m for m in months if m[4:6] in ("03", "06", "09", "12") and m > (next_m or near_m)), None)
        rec = {"date": dt, "spot": round(s),
               "near": basis_or_none(day, near_m),
               "next": basis_or_none(day, next_m) if next_m else None,
               "quarter": basis_or_none(day, quarter_m) if quarter_m else None}
        history.append(rec)
        # 最新一日的期限結構曲線（量足的合約）
        latest_dt, latest_spot = dt, round(s)
        latest_curve = [{"label": f"{m[4:6]}月" if m[:4] == str(today.year) else f"{m[2:4]}/{m[4:6]}",
                         "basis": round(day[m][0] - s)}
                        for m in sorted(day) if day[m][1] >= BASIS_MIN_VOL]

    history = history[-n_days:]
    if latest_dt is None:
        print("basis：無可用資料")
        return {}
    print(f"basis OK  {latest_dt}  spot={latest_spot}  近月價差={history[-1]['near']}  次月={history[-1]['next']}  曲線{len(latest_curve)}點")
    return {"date": latest_dt, "spot": latest_spot, "curve": latest_curve, "history": history}


# ── Yahoo Finance OHLC（NQ 期貨）────────────────────────────

def nq_front_contract(ref_date=None):
    """回傳 NQ 近月合約的 Yahoo 符號（如 NQU26.CME）。
    季月 H/M/U/Z = 3/6/9/12，到期=當月第三個週五；到期前 4 天起轉倉至次季月。
    用明確合約取代 NQ=F：每格交易日只含單一合約，避免 Yahoo 連續合約盤中換月把
    「前月低＋次月高」拼在同一天、灌大 range（2026-06-15 四巫日轉倉實證的污染）。
    """
    from datetime import date as _date, timedelta as _td
    d = ref_date or _date.today()
    code = {3: "H", 6: "M", 9: "U", 12: "Z"}

    def third_friday(y, m):
        first = _date(y, m, 1)
        return first + _td(days=(4 - first.weekday()) % 7) + _td(days=14)

    for yr in (d.year, d.year + 1):
        for m in (3, 6, 9, 12):
            if third_friday(yr, m) - _td(days=4) > d:
                return f"NQ{code[m]}{yr % 100:02d}.CME"
    return "NQ=F"   # 理論上不會到這


def fetch_yahoo_ohlc(symbol, n_days=25):
    """
    抓 NQ 期貨 1h K 棒，以台灣時間（UTC+8）每天凌晨 6:00 為分界分組
    （夏令 5PM EDT＝5AM TWN、冬令 5PM EST＝6AM TWN，6AM 兩種時制均涵蓋收盤）。
    週五的 K 棒跨越週末，包含到週一早上 6:00 前；週六/週日的 bar 一律歸入上週五。
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

_holidays_cache = None


def fetch_tw_holidays():
    """
    從 TWSE 取得本年度休市日，回傳 set('YYYY-MM-DD')，結果快取於模組層。
    清單中「開始交易日／最後交易日」為說明性條目（當天有開市），須排除。
    失敗時回傳空集合（結算日計算退回僅排除週末）。
    """
    global _holidays_cache
    if _holidays_cache is not None:
        return _holidays_cache
    try:
        import ssl as _ssl
        ctx = _ssl._create_unverified_context()
        url = "https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            d = json.loads(r.read().decode("utf-8", errors="replace"))
        days = set()
        for row in d.get("data", []):
            date_str, name = row[0], row[1]
            if "開始交易" in name or "最後交易" in name:
                continue
            days.add(date_str)
        _holidays_cache = days
        print(f"TW holidays loaded: {len(days)} days")
    except Exception as e:
        print(f"TW holidays fetch fail: {e}（退回僅週末判斷）")
        _holidays_cache = set()
    return _holidays_cache


def is_trading_day(d):
    """週一～週五且非台股休市日"""
    return d.weekday() < 5 and d.strftime("%Y-%m-%d") not in fetch_tw_holidays()


def get_settlement_date(ref_date=None):
    """
    取得台指期當月結算日（第三個週三；遇休市日順延至次一營業日）。
    若已過結算日則取下月。
    """
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
    # 結算日遇休市（國定假日）順延至次一營業日
    while not is_trading_day(settlement):
        settlement += timedelta(days=1)
    # 若今天已過結算日，取下月
    if d > settlement:
        if first.month == 12:
            next_month = first.replace(year=first.year + 1, month=1)
        else:
            next_month = first.replace(month=first.month + 1)
        return get_settlement_date(next_month)
    return settlement


def count_trading_days(from_date, to_date):
    """計算 from_date 到 to_date（含兩端）之間的交易日數（排除週末與國定假日）。"""
    from datetime import timedelta as _td
    count = 0
    d = from_date
    while d <= to_date:
        if is_trading_day(d):
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

    # 外資 PUT（與網頁爬蟲/今日 entry 一致；列序實證：0-2=買權自營/投信/外資，3-5=賣權自營/投信/外資）
    def get_put():
        rows = _get(f"https://api.finmindtrade.com/api/v4/data"
                    f"?dataset=TaiwanOptionInstitutionalInvestors&data_id=TXO&start_date={start}{tok_param}")
        by_date = {}
        for row in rows:
            by_date.setdefault(row["date"], []).append(row)
        result = {}
        for dt, day_rows in by_date.items():
            if len(day_rows) >= 6:
                foreign_put = day_rows[5]   # 賣權外資
                result[dt] = {"bp": foreign_put["long_open_interest_balance_volume"],
                              "sp": foreign_put["short_open_interest_balance_volume"]}
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
import os as _os

FUT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate")
OPT_URL = ("https://openapi.taifex.com.tw/v1/"
           "MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate")

# ── 全球指數距年高：OTC／小台 年高維護（P2-7，規格 INDEX_YTD_SPEC §5）────────
# Yahoo 7 標的年高由前端同呼叫取得，不需後端。OTC/小台 Yahoo 無可靠日史 → 後端維護當年最高。
# OTC＝FinMind TaiwanStockPrice/TPEx 當年 max（自癒）∪ mis 今高 ∪ 前值；小台＝MTX futDataDown 當年 max（tokenless）。跨年自動重置。
def _finmind_token():
    import os
    t = os.environ.get("FINMIND_TOKEN", "")
    if not t:
        for p in ("../stockematool/.env", ".env"):
            try:
                for ln in open(p, encoding="utf-8"):
                    if ln.startswith("FINMIND_TOKEN"):
                        t = ln.split("=", 1)[1].strip()
            except Exception:
                pass
    return t


def _otc_year_high_finmind(year):
    """FinMind TaiwanStockPrice data_id=TPEx（櫃買指數）當年每日最高的 max。token 有則用、無則嘗試免token。"""
    import ssl as _ssl, urllib.parse as _up
    q = {"dataset": "TaiwanStockPrice", "data_id": "TPEx", "start_date": f"{year}-01-01"}
    tok = _finmind_token()
    if tok:
        q["token"] = tok
    try:
        u = "https://api.finmindtrade.com/api/v4/data?" + _up.urlencode(q)
        data = json.loads(urllib.request.urlopen(u, timeout=30, context=_ssl._create_unverified_context()).read().decode())["data"]
        highs = [r["max"] for r in data if r.get("max")]
        return max(highs) if highs else None
    except Exception as e:
        print(f"index_ytd OTC FinMind 失敗: {e}")
        return None


def _mis_otc_today_high():
    """mis.twse 櫃買指數今日高 h（server-side 可連，補 cron 未跑到的盤中新高）。"""
    import ssl as _ssl
    try:
        u = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_o00.tw&json=1&delay=0"
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
        d = json.loads(urllib.request.urlopen(req, timeout=20, context=_ssl._create_unverified_context()).read().decode())
        h = d.get("msgArray", [{}])[0].get("h")
        return float(h) if h not in (None, "", "-") else None
    except Exception as e:
        print(f"index_ytd OTC mis 失敗: {e}")
        return None


def _mtx_year_high(year):
    """小型臺指 MTX（futDataDown，commodity_id=MTX）當年每日最高的 max。tokenless。
    取每日「總量最大的主力合約」的高點（同 fetch_tx_ohlc），避免薄量週/遠月合約異常價污染。"""
    import ssl as _ssl, time as _t, urllib.parse as _up, collections
    from datetime import date as _d, timedelta as _td
    ctx = _ssl._create_unverified_context()
    vol_by = collections.defaultdict(int)   # (day, contract) -> 總量
    hi_by = {}                              # (day, contract) -> 最高價
    cur, start = _d.today(), _d(year, 1, 1)
    while cur >= start:
        s = max(start, cur - _td(days=20)).strftime("%Y/%m/%d")
        e = cur.strftime("%Y/%m/%d")
        body = _up.urlencode({"down_type": "1", "commodity_id": "MTX",
                              "queryStartDate": s, "queryEndDate": e}).encode()
        try:
            req = urllib.request.Request("https://www.taifex.com.tw/cht/3/futDataDown", data=body,
                                         headers={"User-Agent": "Mozilla/5.0",
                                                  "Content-Type": "application/x-www-form-urlencoded"})
            txt = urllib.request.urlopen(req, timeout=30, context=ctx).read().decode("big5", "replace")
            for line in txt.splitlines():
                p = [c.strip() for c in line.split(",")]
                if len(p) < 10 or p[1] != "MTX":
                    continue
                try:
                    h, v = float(p[4]), int(p[9])
                except ValueError:
                    continue
                dt, cd = p[0], p[2]
                vol_by[(dt, cd)] += v
                hi_by[(dt, cd)] = max(hi_by.get((dt, cd), 0), h)
        except Exception as ex:
            print(f"index_ytd MTX {s}~{e} 失敗: {ex}")
        cur -= _td(days=21)
        _t.sleep(0.3)
    best = {}   # day -> 主力合約（總量最大）
    for (dt, cd), v in vol_by.items():
        if dt not in best or v > vol_by[(dt, best[dt])]:
            best[dt] = cd
    day_high = [hi_by[(dt, best[dt])] for dt in best]
    return max(day_high) if day_high else None


def update_index_ytd(existing):
    """OTC／小台 年高維護。回傳 index_ytd 區塊；抓失敗沿用前值、避免空資料覆蓋。整段包 try 不拖垮 cron。"""
    from datetime import date as _d
    try:
        return _update_index_ytd_inner(existing)
    except Exception as e:
        print(f"index_ytd 整段失敗，沿用既有: {e}")
        return (existing or {}).get("index_ytd", {})


def _update_index_ytd_inner(existing):
    from datetime import date as _d
    y = _d.today().year
    iy = (existing or {}).get("index_ytd") or {}
    otc_prev = iy.get("otc", {}).get("high") if iy.get("otc", {}).get("year") == y else None
    mxf_prev = iy.get("mxf", {}).get("high") if iy.get("mxf", {}).get("year") == y else None
    otc_cands = [v for v in (_otc_year_high_finmind(y), _mis_otc_today_high(), otc_prev) if v is not None]
    mxf_cands = [v for v in (_mtx_year_high(y), mxf_prev) if v is not None]
    out = {"year": y, "updated": _d.today().strftime("%Y-%m-%d")}
    out["otc"] = {"high": round(max(otc_cands), 2), "year": y} if otc_cands else iy.get("otc", {})
    out["mxf"] = {"high": round(max(mxf_cands)), "year": y} if mxf_cands else iy.get("mxf", {})
    print(f"index_ytd OK  OTC 年高={out['otc'].get('high')}  小台 年高={out['mxf'].get('high')}")
    return out


def main():
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
        import ssl as _ssl, time as _time
        from datetime import date as _d, timedelta as _td
        ctx = _ssl._create_unverified_context()   # 與 market_volume 一致，避免部分環境 TWSE 憑證問題
        today = _d.today()
        for i in range(10):
            d = today - _td(days=i)
            if d.weekday() >= 5:
                continue
            dt_str = d.strftime("%Y%m%d")
            url = (f"https://www.twse.com.tw/rwd/zh/fund/BFI82U"
                   f"?dayDate={dt_str}&weekDate=&monthDate=&type=day&response=json")
            # 單日 transient 失敗重試 3 次（比照 fetch_market_volume），三次皆敗才退往前一天，
            # 避免一次網路抖動就沉默退回昨日資料
            j = None
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
                        j = json.loads(r.read())
                    break
                except Exception as e:
                    print(f"institute {dt_str} 第{attempt+1}次失敗: {e}")
                    _time.sleep(3)
            if j is None:
                continue  # 三次皆 transient 失敗 → 換前一天（最後手段）
            rows = j.get("data", [])
            if not rows:
                continue  # 非交易日/尚無資料（非錯誤，不需重試）→ 換前一天
            # 依列首精準取值（startswith 避免「外資及陸資(不含外資自營商)」被子字串誤配）
            def comp(prefix):
                for row in rows:
                    if row[0].strip().startswith(prefix):
                        try:
                            return float(row[3].replace(",", "")) / 1e8
                        except (ValueError, IndexError):
                            return None
                return None

            def total_of(*prefixes):
                vals = [comp(p) for p in prefixes]
                if all(v is None for v in vals):
                    return None
                return round(sum(v or 0 for v in vals), 1)

            # 標準三大法人：自營商=自行買賣+避險、外資=外資及陸資+外資自營商、投信（對齊 TWSE 合計）
            dealer  = total_of("自營商(自行買賣)", "自營商(避險)")
            trust   = total_of("投信")
            foreign = total_of("外資及陸資", "外資自營商")
            if foreign is None and trust is None:
                continue
            total = round((foreign or 0) + (trust or 0) + (dealer or 0), 1)
            print(f"institute OK  date={dt_str}  foreign={foreign}  trust={trust}  dealer={dealer}  total={total}")
            return {"date": dt_str, "foreign": foreign, "trust": trust,
                    "dealer": dealer, "total": total}
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
        nq_sym = nq_front_contract()
        nq_records = fetch_yahoo_ohlc(nq_sym, 25)
        print(f"NQ OHLC OK  {nq_sym}  {len(nq_records)} days")
    except Exception as e:
        print(f"NQ OHLC FAIL: {e}")

    if not nq_records:
        print("NQ OHLC 抓失敗，沿用既有資料")
        nq_records = existing_json.get("volatility", {}).get("nq", {}).get("history", [])

    fetched_volume = []
    try:
        fetched_volume = fetch_market_volume(45)
        print(f"Market volume fetched {len(fetched_volume)} days  latest={fetched_volume[-1] if fetched_volume else None}")
    except Exception as e:
        print(f"Market volume FAIL: {e}")
    # 按日期合併既有資料，單次失敗不會清掉歷史
    market_volume = merge_market_volume(existing_json.get("market_volume", []), fetched_volume)
    print(f"Market volume merged → {len(market_volume)} days")

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

    # 更新紀錄：每次執行 append 一筆（含觸發方式與各資料抓到的日期），供前端「更新紀錄」顯示
    # 用於觀察定期/手動觸發後是否正確更新到當日，保留最近 12 筆
    tw_now = datetime.now(timezone.utc) + timedelta(hours=8)
    # institute.date / date 為 YYYYMMDD、tx/nq 為 YYYY-MM-DD，統一成 YYYY-MM-DD 供前端比較/顯示
    def _ymd(d):
        return f"{d[:4]}-{d[4:6]}-{d[6:]}" if d and len(d) == 8 else (d or "")
    update_log = existing_json.get("update_log", [])
    update_log.append({
        "at":      tw_now.strftime("%Y-%m-%d %H:%M"),
        "trigger": _os.getenv("TRIGGER_TYPE", "manual"),
        "inst":    _ymd(institute.get("date", "") if institute else ""),
        "fut":     _ymd(date or ""),
        "tx":      (tx_vol.get("yesterday") or {}).get("date", ""),
        "nq":      (nq_vol.get("yesterday") or {}).get("date", ""),
    })
    update_log = update_log[-12:]

    # 台指期正價差（近月/次月/季月 vs 加權指數現貨）；抓失敗沿用既有，避免空資料覆蓋
    basis = {}
    try:
        basis = fetch_basis()
    except Exception as e:
        print(f"basis FAIL: {e}")
    if not basis or not basis.get("history"):
        print("basis 抓失敗，沿用既有資料")
        basis = existing_json.get("basis", {})

    # 財報行事曆（AlphaVantage EARNINGS_CALENDAR，只取下次財報「日期」；每天抓一次，1 請求）
    # 無自設 key 時用 demo（CALENDAR 端點 demo 即可抓全市場），確保時間一定抓得到
    av_key = _os.getenv("ALPHAVANTAGE_KEY", "").strip()
    if av_key:
        print("[earnings] 使用自有 ALPHAVANTAGE_KEY")
    else:
        av_key = "demo"
        print("[earnings] ⚠ 未設 ALPHAVANTAGE_KEY，改用共享 demo key（可用性無保證，建議設 GitHub secret）")
    earnings = existing_json.get("earnings", {})
    if earnings.get("fetched") != tw_now.strftime("%Y-%m-%d"):
        try:
            WANT = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "TSM"]
            cal = urllib.request.urlopen(urllib.request.Request(
                f"https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={av_key}",
                headers={"User-Agent": "Mozilla/5.0"}), timeout=25).read().decode("utf-8", "replace")
            elist = []
            for line in cal.strip().split("\n")[1:]:
                p = line.split(",")
                if len(p) >= 3 and p[0] in WANT:
                    elist.append({"sym": p[0], "next": p[2]})
            elist.sort(key=lambda x: x["next"])
            if elist:
                earnings = {"fetched": tw_now.strftime("%Y-%m-%d"), "list": elist}
                print(f"earnings fetched: {len(elist)} 家")
        except Exception as e:
            print(f"earnings FAIL: {e}")

    result = {
        "date":               date,
        "futures":            futures,
        "options":            options,
        "institute":          institute,
        "settlement_date":    settlement_date.strftime("%Y-%m-%d"),
        "settlement_history": existing_history,
        "volatility":         {"tx": tx_vol, "nq": nq_vol},
        "market_volume":      market_volume,
        "basis":              basis,
        "update_log":         update_log,
        "earnings":           earnings,
        "index_ytd":          update_index_ytd(existing_json),
        "updated_at":         datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    with open("taifex_data.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print("taifex_data.json written OK")


if __name__ == "__main__":
    main()
