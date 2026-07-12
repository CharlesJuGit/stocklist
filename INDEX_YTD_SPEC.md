# INDEX_YTD_SPEC — 全球指數距年高% 功能規格（給 implementer）

> **狀態**：Ball 2026-07-07 核准開工｜規格作者：Fable｜對應帳本：REVIEW_HANDOFF.md P2-7
> **Ball 已拍板（勿重開）**：架構採 **A（Cloudflare Worker 自建 CORS 代理）**；NQ 用**期貨 NQ=F**；
> 年高＝**盤中最高**；標的加入**櫃買 OTC 與台指期（小台 MXF）**。

## 1. 目標

stockweb 首頁新增「全球指數距年高」區塊：9 個標的的 現價／今年盤中最高／距年高%，
頁面載入自動抓＋手動刷新鈕＋開頁期間每 60s 自動更新（`visibilitychange` 隱藏時暫停）。

## 2. 標的與資料源（全部 2026-07-07 實測驗證過）

| 標的 | 符號 | 即時價來源 | 年高來源 |
|---|---|---|---|
| 韓國 KOSPI | `^KS11` | Yahoo | Yahoo（同一呼叫） |
| 日經 225 | `^N225` | Yahoo | 同上 |
| 台股加權 | `^TWII` | Yahoo | 同上 |
| 那斯達克期貨 | `NQ=F` | Yahoo | 同上 |
| 道瓊 | `^DJI` | Yahoo | 同上 |
| SP500 | `^GSPC` | Yahoo | 同上 |
| 費城半導體 | `^SOX` | Yahoo | 同上 |
| 櫃買指數 OTC | `otc_o00.tw` | **mis.twse**（Yahoo ^TWOII 資料壞掉：269 vs 官方 419，勿用） | **後端維護**（見 §5） |
| 台指期小台 | `MXF{月碼}{年碼}-F` | **mis.taifex**（Yahoo 無台指期） | **後端維護**（見 §5） |

- **Yahoo 7 標的**：`GET query1.finance.yahoo.com/v8/finance/chart/{sym}?range=ytd&interval=1d`
  ——**一次呼叫**同時回 `meta.regularMarketPrice`（最新價）＋逐日 `indicators.quote[0].high`（取 max＝年高，
  自動含今日盤中）。跨年自動歸零（range=ytd 天生如此）。實測 ^TWII 45479.11 與 TWSE 官方分毫一致。
- **OTC 即時**：`GET mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_o00.tw&json=1&delay=0`
  → `msgArray[0].z`（最新）`h`（今日高）。
- **小台即時**：`POST mis.taifex.com.tw/futures/api/getQuoteDetail`，body `{"SymbolID":["MXFG6-F"]}`
  → `CLastPrice/CHighPrice/CDate/CTime`。實測：MXFG6-F 最新 45759、高 47188（20260707 134459）。
  - 符號組法：`MXF` + 月碼（A=1月…G=7月…L=12月）+ 年尾碼（2026→6）+ `-F`（日盤）/`-M`（夜盤）。
  - **近月切換**：用 taifex_data.json 既有 `settlement_date`——今日 > 結算日則跳下月（站內已有同款邏輯）。
  - **盤別**：日盤時段顯示 `-F`，收盤後改抓 `-M`（夜盤）並在 UI 標「夜盤」。
  - 註：大小台同標的價格幾乎相同（實測差 16 點/0.03%），Ball 指定小台。

## 3. Cloudflare Worker（架構核心）

前端直連上述三源全被 CORS 擋（2026-07-07 實測：Yahoo 無標頭、corsDomain 後門已封、mis 兩站皆無、
公共代理 allorigins=520/corsproxy=403 不可靠）→ 自建 Worker 代理，免費額度 100k req/day 綽綽有餘。

**Worker 規格**（~40 行）：
- 路由：`/yahoo/{symbol}?range=…`、`/twse?ex_ch=…`、`/taifex`（POST 透傳）
- **上游白名單寫死**：只允許 query1.finance.yahoo.com / mis.twse.com.tw / mis.taifex.com.tw——不做開放代理
- 回應加 `Access-Control-Allow-Origin: *`（或鎖定 GitHub Pages 網域，擇一；建議鎖網域）＋處理 OPTIONS preflight
- **快取 30s**（Cache API 或 `cf: {cacheTtl:30}`）：保護上游、防 Yahoo 限流；60s 自動刷新配 30s 快取剛好
- 無任何 secret（指數為公開資料，無策略外洩疑慮）
- Worker URL 放前端常數；**附 Ball 部署指引**：註冊免費 CF 帳號 → dashboard 建 Worker → 貼程式 → 取得 `*.workers.dev` URL（全程約 10 分鐘，不需信用卡）

## 4. 前端（app.js + index.html）

- 新區塊「全球指數距年高」，建議放參考連結區之前；表格欄：名稱｜現價｜距年高%｜年高｜時間
- 距年高% ＝ `(現價 − 年高) / 年高 × 100`（恆 ≤0，貼近 0 = 創高附近）
- 色彩建議（站內台灣慣例紅多綠空）：≥−3% 紅（貼近年高）、−3%~−10% 黃、<−10% 綠（深回檔）；實作可與 Ball 微調
- 每列顯示報價時間（美股在台灣夜間才動、台股日盤時段才動，時間戳避免誤讀）
- 手動刷新鈕＋60s 自動更新（頁面隱藏時暫停）；**bump cache-buster**（帳本規則 5）
- 任一標的失敗顯示「—」不擋其他標的（Promise.allSettled）

## 5. 後端（fetch_taifex.py）：OTC／小台的年高維護

Yahoo 7 標的年高由前端同呼叫取得，**不需後端**。OTC 與小台 Yahoo 沒有可靠日史 → 後端維護 running max：

- taifex_data.json 新增區塊：
  `"index_ytd": {"otc": {"high": x, "year": 2026}, "mxf": {"high": y, "year": 2026}}`
- 每次 cron 執行：抓當日高（OTC：mis 或 TPEx 官方日資料；小台：TAIFEX futDataDown MXF 近月，
  同站內 fetch_tx_ohlc 模式、換 commodity_id）→ `high = max(high, 當日高)`；`year` 變更時重置（跨年歸零）
- **一次性 seed**：實作時抓 2026-01 至今的日史算出初始年高（OTC：TPEx 指數日資料端點，實作時確認；
  小台：futDataDown MXF 連續近月）；seed 值與來源記 CHANGELOG
- 前端 OTC／小台的「距年高%」＝ mis 即時價 vs `max(index_ytd.high, 今日盤中高)`（今日高從 mis 的 `h`/`CHighPrice` 取，
  彌補 cron 未跑到的盤中新高）

## 6. 邊角案例

1. **Yahoo 限流**（429）：Worker 30s 快取為主防線；前端對 429 顯示上次值＋「稍後再試」
2. **時區**：mis.taifex 的 CDate/CTime 為台灣時間；Yahoo `regularMarketTime` 為 epoch——統一轉台灣時間顯示
3. **NQ=F 期貨換月**：Yahoo 連續近月自動處理，年高含換月價差屬期貨連續序列固有性質，不調整（聲明即可）
4. **小台結算日當天**：結算日 13:30 前仍用當月，之後跳下月（與站內 settlement 邏輯一致）
5. **休市日**：顯示最後報價＋時間戳，不特別處理
6. **Worker 掛掉**：前端 fetch 逾時 10s → 整區顯示「資料源暫不可用」＋刷新鈕仍可重試

## 7. 驗證要求（硬性規則）

- 上線後同一時刻交叉核對：^TWII（Yahoo經Worker） vs mis.twse `t00` 應一致（2026-07-07 已驗 45479.11 兩源相同）；
  小台 vs 期交所行情頁一致；至少一個美股指數 vs 任一行情網站一致
- OTC／小台 seed 年高寫 CHANGELOG（含來源與數值）；距年高% 抽 2 標的手算對照
- 實測參考值（2026-07-07）：KOSPI −18.4%、日經 −6.3%、加權 −5.7%、NQ=F −4.3%、道瓊 −0.01%、
  SP500 −1.1%、費半 −12.0%（實作完成後數字會變，核對計算邏輯用）

## 8. 範圍控制

- 不做：歷史距年高走勢圖、告警通知、更多標的——先上線核心表格，擴充另議
- Worker 程式碼放 repo（`worker/index-proxy.js` 之類）納版控；部署仍由 Ball 手動（CF 帳號在 Ball 手上）
