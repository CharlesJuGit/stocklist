"""
fetch_nq_only.py
只更新 taifex_data.json 中的 NQ OHLC 部分。
由 update-nq.yml 於每日 6:30 AM TWN 執行（NQ 收盤後）。
"""
import json
from datetime import datetime, timezone
from fetch_taifex import fetch_yahoo_ohlc, build_vol_data

with open("taifex_data.json", encoding="utf-8") as f:
    data = json.load(f)

nq_records = fetch_yahoo_ohlc("NQ=F", 25)
if not nq_records:
    print("NQ fetch 失敗，不更新")
    raise SystemExit(1)

nq_vol = build_vol_data(nq_records, "NQ")
data["volatility"]["nq"] = nq_vol
data["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

with open("taifex_data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

latest = nq_records[-1] if nq_records else None
print(f"NQ updated: {len(nq_records)} days, latest={latest}")
