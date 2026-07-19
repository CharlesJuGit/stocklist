"""
history_roll.py — stocks.json 的前期名單留存（P2-24 §2 資料端）

做什麼：把「上一版已發布的多方名單」滾進 stocks.json 的頂層 `history`，供前端顯示
「前三週入選・本週未續選」折疊區塊與「連續 ×N」徽章。

設計重點：
- **來源＝`git show HEAD:stocks.json`**（上一次已推上線的版本），不是本機暫存檔——
  這樣不依賴「先寫新檔還是先滾動」的執行順序，重跑也不會拿到已被覆寫的資料。
- **同日重跑不重複推入**：以 `updated` 日期為鍵，若上一版日期與本次相同（同一週重跑）或
  已存在於 history 中，直接跳過。
- **只留 id / name / mkt 三鍵**：其餘欄位一律剝除——history 是給「認得出是哪支股票」用的，
  不需要也不該帶其他欄位，檔案膨脹也最小。
- 最多保留 **3** 筆（新→舊）。

用法（在 stockweb 目錄，於產生新的 stocks.json 之後、push 之前）：
    python history_roll.py
"""
import json
import subprocess
import sys

STOCKS = "stocks.json"
KEEP = 3
FIELDS = ("id", "name", "mkt")


def _published_version():
    """讀 git HEAD 版本的 stocks.json（＝上一次已發布內容）；取不到回 None。"""
    try:
        out = subprocess.run(["git", "show", f"HEAD:{STOCKS}"],
                             capture_output=True, text=True, encoding="utf-8", timeout=30)
        if out.returncode != 0 or not out.stdout.strip():
            return None
        return json.loads(out.stdout)
    except Exception as e:
        print(f"⚠ 讀不到 HEAD 版本（{type(e).__name__}: {e}）——首次上線或非 git 環境時屬正常")
        return None


def _slim(rows):
    """只留 id/name/mkt 三鍵。"""
    return [{k: s[k] for k in FIELDS if k in s} for s in (rows or [])]


def roll(path=STOCKS):
    with open(path, encoding="utf-8") as f:
        cur = json.load(f)

    prev = _published_version()
    history = list(prev.get("history", []) if prev else cur.get("history", []))

    if prev and prev.get("updated") and prev.get("long"):
        pdate = prev["updated"]
        if pdate == cur.get("updated"):
            print(f"[history] 上一版日期與本次相同（{pdate}）＝同日重跑，不推入")
        elif any(h.get("date") == pdate for h in history):
            print(f"[history] {pdate} 已在 history 中，不重複推入")
        else:
            history.insert(0, {"date": pdate, "long": _slim(prev["long"])})
            print(f"[history] 推入上一版 {pdate}（{len(prev['long'])} 支）")
    else:
        print("[history] 無上一版可推入（首次上線）")

    history = history[:KEEP]
    cur["history"] = history
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=1)

    print(f"[history] 現有 {len(history)} 筆：" +
          "、".join(f"{h.get('date')}({len(h.get('long', []))}支)" for h in history))
    # 隱私自檢：history 內不得出現三鍵以外的欄位
    extra = {k for h in history for s in h.get("long", []) for k in s if k not in FIELDS}
    if extra:
        print(f"❌ history 出現非預期欄位 {extra}——應只有 {FIELDS}")
        return 1
    print("[history] 欄位自檢 OK（只有 id/name/mkt）")
    return 0


if __name__ == "__main__":
    sys.exit(roll())
