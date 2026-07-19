"""
enrich_stocks.py — 為 stocks.json 的 long/short 補「公開基本資料」（P2-10 ③ 的載體）

設計：讀已生成的 stocks.json（{updated, long:[{id,name}], short:[...]}），逐股補公開欄位後寫回。
本機跑（轉檔器性質），stocks.json 是公開檔——**只帶公開市場資料，絕不帶任何策略衍生欄位**。
🔴 大戶只放「最新週原始比例 big400 + 週日期」，**不放週間變化量/門檻/排名**。
   （何謂「策略衍生欄位」的完整定義刻意不在此列舉——見**本機**規格與帳本，公開檔不留清單。）

補的欄（任一來源失敗→該欄省略、其餘照出，不中斷）：
  mkt(twse/tpex)、ind(產業名)、rev_m/rev(億)/rev_yoy(%)、eps_q/eps、big400/big400_w
  ⚠ biz(主要經營業務/簡介)：t187ap03_L 與 FinMind 皆無此欄（spec gap）→ v1 省略，待 Ball/Fable 定案來源

各 openapi 表全表抓一次建字典再逐股查（不逐股打 API）；openapi 會 flaky，_get 內建重試。
用法：python enrich_stocks.py   （在 stockweb 目錄）
"""
import json
import ssl
import urllib.request
import urllib.parse as up

CTX = ssl._create_unverified_context()
STOCKS = "stocks.json"


def _get(url, timeout=30, retry=3):
    import time
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            return json.loads(urllib.request.urlopen(req, timeout=timeout, context=CTX).read().decode("utf-8", "replace"))
        except Exception as e:
            last = e
            time.sleep(2)
    raise last


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


def _roc_ym(s):
    """ROC 年月字串 '11506' → '2026-06'"""
    s = str(s).strip()
    if len(s) < 5:
        return None
    try:
        return f"{int(s[:-2]) + 1911}-{s[-2:]}"
    except ValueError:
        return None


def build_info():
    """FinMind TaiwanStockInfo → {id: {ind, mkt}}"""
    tok = _finmind_token()
    q = {"dataset": "TaiwanStockInfo"}
    if tok:
        q["token"] = tok
    try:
        data = _get("https://api.finmindtrade.com/api/v4/data?" + up.urlencode(q))["data"]
        out = {}
        for r in data:
            sid = r.get("stock_id")
            if sid and sid not in out:
                out[sid] = {"ind": r.get("industry_category"), "mkt": r.get("type")}
        return out
    except Exception as e:
        print(f"⚠ info(FinMind) 失敗: {e}")
        return {}


def build_rev():
    """月營收 TWSE t187ap05_L + TPEx → {id: {rev_m, rev(億), rev_yoy}}"""
    out = {}
    srcs = ["https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
            "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"]
    for url in srcs:
        try:
            for r in _get(url):
                sid = r.get("公司代號")
                cur = r.get("營業收入-當月營收")
                if not sid or cur in (None, ""):
                    continue
                try:
                    rev_yi = round(float(str(cur).replace(",", "")) / 100000, 2)  # 千元→億元
                except ValueError:
                    continue
                yoy = r.get("營業收入-去年同月增減(%)")
                try:
                    yoy = round(float(str(yoy).replace(",", "")), 1)
                except (ValueError, TypeError):
                    yoy = None
                out[sid] = {"rev_m": _roc_ym(r.get("資料年月")), "rev": rev_yi, "rev_yoy": yoy}
        except Exception as e:
            print(f"⚠ rev({url.split('/')[-1]}) 失敗: {e}")
    return out


def build_eps():
    """季 EPS TWSE t187ap14_L + TPEx → {id: {eps_q, eps}}（取最新年度季別）"""
    out = {}
    srcs = ["https://openapi.twse.com.tw/v1/opendata/t187ap14_L",
            "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O"]
    for url in srcs:
        try:
            for r in _get(url):
                sid = r.get("公司代號")
                eps = r.get("基本每股盈餘(元)")
                yr, q = r.get("年度"), r.get("季別")
                if not sid or eps in (None, "") or not yr or not q:
                    continue
                try:
                    eps_v = float(str(eps).replace(",", ""))
                    key = (int(yr), int(q))
                except ValueError:
                    continue
                if sid not in out or key > out[sid]["_k"]:
                    out[sid] = {"_k": key, "eps_q": f"{int(yr) + 1911}Q{int(q)}", "eps": eps_v}
        except Exception as e:
            print(f"⚠ eps({url.split('/')[-1]}) 失敗: {e}")
    for v in out.values():
        v.pop("_k", None)
    return out


def build_big400():
    """TDCC 全市場 400張大戶% 最新週（僅水位，無變化量）→ ({id: pct400}, week_date)"""
    try:
        import sys
        sys.path.insert(0, "../stockematool")
        from shareholding import fetch_week_csv, fetch_week_json
        try:
            wk, tdcc = fetch_week_csv()
        except Exception:
            wk, tdcc = fetch_week_json()
        return {s: round(v.get("pct400"), 2) for s, v in tdcc.items() if v.get("pct400") is not None}, wk
    except Exception as e:
        print(f"⚠ big400(TDCC) 失敗: {e}")
        return {}, None


def main():
    d = json.load(open(STOCKS, encoding="utf-8"))
    info, rev, eps = build_info(), build_rev(), build_eps()
    big400, big_wk = build_big400()
    big_wk_fmt = None
    if big_wk:
        s = str(big_wk)
        big_wk_fmt = f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else s

    n = 0
    for side in ("long", "short"):
        for e in d.get(side, []):
            sid = e["id"]
            # 只清基本資料欄、保留 id/name（防重跑殘留）
            for k in ("mkt", "ind", "rev_m", "rev", "rev_yoy", "eps_q", "eps", "big400", "big400_w"):
                e.pop(k, None)
            if sid in info:
                if info[sid].get("mkt"):
                    e["mkt"] = info[sid]["mkt"]
                if info[sid].get("ind"):
                    e["ind"] = info[sid]["ind"]
            if sid in rev:
                e.update({k: v for k, v in rev[sid].items() if v is not None})
            if sid in eps:
                e["eps_q"], e["eps"] = eps[sid]["eps_q"], eps[sid]["eps"]
            if sid in big400:
                e["big400"] = big400[sid]
                if big_wk_fmt:
                    e["big400_w"] = big_wk_fmt
            n += 1

    json.dump(d, open(STOCKS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    cov = lambda k: sum(1 for side in ("long", "short") for e in d[side] if k in e)
    print(f"enrich 完成：{n} 股｜mkt {cov('mkt')}/ind {cov('ind')}/rev {cov('rev')}/eps {cov('eps')}/big400 {cov('big400')}（big400 週={big_wk_fmt}）")
    print("⚠ biz(簡介) 欄未帶：t187ap03_L 與 FinMind 皆無此欄（spec gap，待定案來源）")


if __name__ == "__main__":
    main()
