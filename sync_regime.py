"""
sync_regime.py — 把市況燈號（顏色/名稱/emoji）同步進 stocks.json（P2-27）

只取 {light, name, emoji} 三個顯示用欄位寫入公開檔，不帶行動建議文字
（那段文字屬本機端另一套系統的內部細節，Ball 2026-07-25 明確裁示：
只上傳燈號本身，不含行動建議）。

判定邏輯完全來自本機端既有、已驗證的單一函式，這裡只讀其輸出、
不重寫、不複製其計算方式。直接讀 CSV 而非呼叫既有的載入函式：
該函式用相對路徑解析，會相對執行時的 CWD（stockweb 目錄）解析、
指向錯誤位置，故改用絕對路徑讀取再把資料傳進純函式判定。

用法：python sync_regime.py   （在 stockweb 目錄，於 /weekly 步驟 7 產生 stocks.json 之後執行）
"""
import sys
import os
import json
import pandas as pd

_STOCKEMATOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "stockematool")
sys.path.insert(0, _STOCKEMATOOL)
import market_breadth as mb   # noqa: E402  （僅用其燈號判定函式，不匯入其餘計算模組）

HISTORY_CSV = os.path.join(_STOCKEMATOOL, "output", "breadth_history.csv")


def sync(stocks_json_path="stocks.json", date=None):
    history = pd.read_csv(HISTORY_CSV)
    r = mb.regime_light(history, date)
    with open(stocks_json_path, encoding="utf-8") as f:
        d = json.load(f)
    d["regime"] = {"light": r["light"], "name": r["name"], "emoji": r["emoji"]}
    with open(stocks_json_path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    print(f"[sync_regime] 已寫入 {stocks_json_path}：{r['emoji']} {r['name']}（{r['light']}）")
    return d["regime"]


if __name__ == "__main__":
    sync()
