"""P2-16 驗收 B1/B2/B3/B4：daily_summary 與 stale 旗標（純函式，不碰網路/不寫 taifex_data.json）。
🔴 B3 要求「模擬 inst 落後 → 實測觸發 stale=true」，不能只讀程式碼——本檔即該模擬。
"""
from datetime import datetime

import fetch_taifex as ft

# ── 測試替身：monkeypatch is_trading_day，不真的打 TWSE holidaySchedule ──
_HOLIDAYS = {"2026-10-10"}  # 假的國定假日一天，供 B4 用


def fake_is_trading_day(d):
    return d.weekday() < 5 and d.strftime("%Y-%m-%d") not in _HOLIDAYS


ft.is_trading_day = fake_is_trading_day

print("=== B2：延遲計算（已知真實案例回代）===")
# 2026-09-11（週五）16:53 首次見到同日 inst → 延遲 = 16:53-15:30 = 83 分
now1 = datetime(2026, 9, 11, 16, 53)
ds = ft.update_daily_summary([], now1, "2026-09-11", ft.compute_stale(now1, "2026-09-11"))
row = ds[0]
print(f"  2026-09-11 16:53：first_same_day_inst_at={row['first_same_day_inst_at']} "
      f"latency_min={row['latency_min']}（預期 83）")
assert row["latency_min"] == 83, f"B2 失敗：{row['latency_min']} != 83"
print("  ✅ 83 分，與案卡 B2 給的參照值相符")

print("\n=== B1：同日再跑不重複、不覆寫 first_same_day_inst_at ===")
now2 = datetime(2026, 9, 11, 18, 20)   # 同一天稍晚再跑一次（例如晚班）
ds = ft.update_daily_summary(ds, now2, "2026-09-11", ft.compute_stale(now2, "2026-09-11"))
row = ds[0]
print(f"  第二次執行（18:20）後：first_same_day_inst_at={row['first_same_day_inst_at']}"
      f"（應仍為 16:53）｜n_runs={row['n_runs']}（應為 2）｜列數={len(ds)}（應為 1）")
assert row["first_same_day_inst_at"] == "16:53", "B1 失敗：first_same_day_inst_at 被覆寫"
assert row["n_runs"] == 2, "B1 失敗：n_runs 未累加"
assert len(ds) == 1, "B1 失敗：同日產生了第二列"
print("  ✅ 不重複、不覆寫")

print("\n=== B3（🔴 要實測觸發）：模擬 inst 落後 → stale=true ===")
# 週五 2026-09-18、18:31（過 18:00）、inst 仍卡在前一交易日 09-17（尚未同日）
now3 = datetime(2026, 9, 18, 18, 31)
assert now3.weekday() < 5, "測試前提：09-18 須為平日"
stale3 = ft.compute_stale(now3, "2026-09-17")
print(f"  交易日 18:31、inst=09-17（落後 1 天）→ stale={stale3}")
assert stale3 is True, f"🔴 B3 失敗：應為 True，實得 {stale3}"
ds2 = ft.update_daily_summary([], now3, "2026-09-17", stale3)
print(f"  daily_summary 該列：{ds2[0]}")
assert ds2[0]["stale"] is True
print("  ✅ 實測觸發成功——這正是本案要偵測的『三大法人資料落後』情境")

print("\n=== B3 對照組：正常情況（inst 同日、時間已過 18:00）→ stale=false ===")
now4 = datetime(2026, 9, 18, 19, 0)
stale4 = ft.compute_stale(now4, "2026-09-18")
print(f"  交易日 19:00、inst=09-18（同日）→ stale={stale4}")
assert stale4 is False
print("  ✅ 正常時 false，無誤報")

print("\n=== B3 對照組：交易日但未到 18:00、inst 落後 → 仍 false（門檻未到不誤報）===")
now5 = datetime(2026, 9, 18, 17, 59)
stale5 = ft.compute_stale(now5, "2026-09-17")
print(f"  交易日 17:59（未過 18:00）、inst=09-17（落後）→ stale={stale5}")
assert stale5 is False
print("  ✅ 18:00 門檻生效")

print("\n=== 颱風臨時停市不誤報（Opus R 2026-09-17 覆審追加）===")
# holidaySchedule 是事先公告的行事曆，不含臨時停市 → is_trading_day 仍判 True；
# 但那天整個市場沒開，期貨(fut)也會同步落後 → 不該誤報「三大法人特別慢」
now_typhoon = datetime(2026, 9, 18, 20, 0)
stale_typhoon_no_fut_check = ft.compute_stale(now_typhoon, "2026-09-17")  # 舊呼叫（省略 fut）：向後相容，仍會誤報
stale_typhoon = ft.compute_stale(now_typhoon, "2026-09-17", "2026-09-17")  # 新呼叫：fut 也落後
print(f"  交易日 20:00、inst 落後、（省略 fut）→ stale={stale_typhoon_no_fut_check}（向後相容，維持舊行為）")
print(f"  交易日 20:00、inst 落後、fut 也落後（疑似臨時停市）→ stale={stale_typhoon}（應為 False）")
assert stale_typhoon_no_fut_check is True, "向後相容性破壞：省略 fut 時行為不應改變"
assert stale_typhoon is False, "🔴 颱風停市誤報修法失敗：fut 也落後時仍誤報 stale"
stale_normal_fut_ok = ft.compute_stale(now_typhoon, "2026-09-17", "2026-09-18")  # fut 是最新的，inst 才是真的慢
print(f"  交易日 20:00、inst 落後、但 fut 是當日（三大法人真的比期貨慢）→ stale={stale_normal_fut_ok}（應為 True）")
assert stale_normal_fut_ok is True, "🔴 修法過頭：fut 正常時不該被放過"
print("  ✅ fut 同步落後才視為疑似臨時停市不誤報；fut 正常但 inst 落後時照樣抓")

print("\n=== B4：假日不誤報（週六 ＋ 模擬國定假日，皆為交易日 inst 落後同款情境）===")
# 週六
now_sat = datetime(2026, 9, 19, 20, 0)   # 2026-09-19 是週六
assert now_sat.weekday() == 5, "測試前提：09-19 須為週六"
stale_sat = ft.compute_stale(now_sat, "2026-09-17")
print(f"  週六 20:00、inst 落後 → stale={stale_sat}")
assert stale_sat is False, "🔴 B4 失敗：週六誤報"
# 模擬國定假日（monkeypatch 的 _HOLIDAYS 集合）
now_hol = datetime(2026, 10, 10, 20, 0)   # 週六以外，用假的國定假日日期
stale_hol = ft.compute_stale(now_hol, "2026-10-08")
print(f"  模擬國定假日 20:00、inst 落後 → stale={stale_hol}")
assert stale_hol is False, "🔴 B4 失敗：假日誤報"
print("  ✅ 週六／假日皆不誤報")

print("\n全部通過（B1/B2/B3/B4，純函式測試、未碰網路、未寫 taifex_data.json）。")
