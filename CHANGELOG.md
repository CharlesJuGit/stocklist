# CHANGELOG — stockweb

格式：**[日期] 類型：說明**
- Request：使用者需求
- Fix：錯誤修正
- Feat：新功能
- 自 2026-06-11 起，條目加註執行模型，如 **Fix (Fable)** / **Feat (Sonnet)** / **Fix (Opus)**

---

## 2026-06-21（TX 波動：Actions 抓取停更 + 不完整當日剔除）

**Fix (Opus)：** `fetch_tx_ohlc` 加重試 3 次 + timeout 15→30（修 TX 波動在線上無聲停更）
- 現象：線上 taifex_data.json 中 volatility.tx 停在 6/11（停 10 天），但 institute/volume(TWSE)、NQ(Yahoo) 皆更新到 6/18~6/19
- 根因：main() 裡唯一每日呼叫 FinMind 的就是 TX；Actions 連 FinMind 偶發慢/回空→單次抓取失敗→main 沿用舊 history→TX 無聲凍結。本機（台灣）連 FinMind 正常、能到 6/18 → 典型 CI 環境差異
- 修正：比照 fetch_csv 既有重試模式，3 次重試、timeout 拉長到 30、回空也重試
- 註：Actions log 需 auth 無法從本機直證，根因為證據鏈推斷（唯一 FinMind 源、唯一停更）；線上既有 6/11~ 的歷史需另行補回最新



**Request：** review 台指波動功能

**Fix (Opus)：** `fetch_tx_ohlc` 只有單一 session 的不完整當日被當完整 K 棒
- 根因：原邏輯只要日盤或夜盤任一有資料就輸出整天。最新交易日若只有夜盤（盤中/夜盤進行中、或日盤資料未回補），會以「半天」的 high/low 算出低估的 range，且被 build_vol_data 當「昨日波動」顯示
- 實證（6/21 當下）：6/22 僅有 after_market（缺 position），原顯示昨日 range=891（半天）；修正後剔除 6/22、退回 6/18 完整日 range=1066
- 修正：要求同一主力合約「日盤+夜盤皆到齊」才輸出，否則略過並印日誌
- 附帶查證：6/19 缺資料=端午節休市（正常，非漏抓）；近20日 history（5/22~6/18）經缺口檢查連續完整無洞
- 與 6-15「結算日單一合約」為同函式的兩個獨立問題（前者跨合約、本次跨 session），第二遍 review 才發現

---

## 2026-06-15（重要事件行事曆）

**Request：** 加入像 investing.com 的重要事件行事曆（美/歐/日…），即時，放在成交量下方

**Feat (Opus)：** `index.html` 嵌入 investing.com 即時經濟行事曆 widget（A 案）
- 放在「上市+上櫃成交量」區塊下方，沿用 max-w-2xl 卡片樣式
- calType=week、importance=2,3（中+高）、開啟 datepicker/timezone/filters 控制項、timeZone=113（GMT+8 台北；原設 88 實為 GMT+9 東京、快一小時，2026-06-16 修正）、lang=英文（CPI/NFP 等標準名稱）
- 即時公布實際值（actual/forecast/previous），純靜態站可行（純前端 iframe，無後端）
- 限制：外觀為 widget 本身（淺色）、含 Investing.com 標註；時區/國家 ID 為數字，預設需驗證，使用者亦可在 widget 內自行切換

---

## 2026-06-15（TX 結算日換月污染修正）

**Request：** TX 每月第三週三結算換月，檢查是否有與 NQ 同款污染

**Fix (Opus)：** `fetch_tx_ohlc` 每日改取「單一主力合約」的日盤+夜盤
- 根因：結算日 after_market(結算前夜盤=舊月) + position(結算後日盤=新月) 被合併，max高/min低跨月配對污染 range（2026-05-20 實證：日盤202606、夜盤202605）
- 修正：每個日期先選當天總成交量最大的單一近月合約，再只取該合約兩個 session
- 影響本就小於 NQ（TX 月結算、近月次月價差於結算日已收斂到幾十點）；5/20 數值不變(810，因五月夜盤振幅已包住六月日盤)但現為單一合約、不再有跨月配對風險

---

## 2026-06-15（NQ 換月污染修正 + 快速捲動）

**Request：** ① NQ 四巫日換合約導致波動數據怪異 ② 網頁太長，想要快速回頂/到底

**Fix (Opus)：** NQ 改用明確近月合約符號取代 `NQ=F`（修換月盤中污染）
- 根因：Yahoo `NQ=F` 連續合約 2026-06-15 約 15:00 TWN「盤中」從六月(NQM26)切到九月(NQU26)，且 shortName 標籤仍錯寫「Jun 26」。該日 bucket 同時含六月低(29988)＋九月高(30628)→ range 灌成 640，實際單一合約僅約 350–440
- 實證：6/04~6/12 NQ=F=六月、6/15=九月；六月 30324/29907、九月 30628/30191，NQ=F 價格=九月（標籤騙人）
- 修正：新增 `nq_front_contract()`，依日期自動選當季合約（H/M/U/Z，到期前 4 天轉倉），`main()` 與 `fetch_nq_only.py` 改用之。每格交易日只含單一合約，無盤中換月污染；轉倉於日界發生
- **實證：** 修後 6/15 range 640 → 346（純九月）；整個 20 日視窗為單一合約、無跳階；NQU26.CME 有 71 天 1h 歷史足夠

**Feat (Opus)：** `index.html` 右側固定「↑ 回最上 / ↓ 到最下」浮動按鈕（inline onclick smooth scroll，未動 app.js）

---

## 2026-06-15（排程漏跑修正）

**Request：** 19:55 了資料還停在 6/12，按重新整理也沒更新

**診斷 (Opus)：** 後端與 Pages 皆正常（線上實測吐出 6/15）；根因是 **GitHub Actions 排程未觸發**——6/15 三個排程(17/18/20 TWN)全部沒跑，資料一整天卡在週五 6/12，直到手動 workflow_dispatch 才更新。Actions cron 為 best-effort，設在整點 `:00`（全球尖峰）最易被丟棄。

**Fix (Opus)：** `fetch-taifex.yml` cron 由整點移到 `:17`，並新增 21:17 保險時段
- `0 9/0 10/0 12` → `17 9/17 10/17 12`（17:17/18:17/20:17 TWN）+ 新增 `17 13`（21:17 TWN）
- 抓取邏輯本就合併/沿用，晚跑只會拿到更完整當日資料
- 仍漏的話備案：用外部 cron 服務打 workflow_dispatch（未做）

---

## 2026-06-15（PAT 儲存回退）

**Request：** 手機點「抓新資料」一直要求重輸 token

**Fix (Opus)：** GitHub PAT 改回 localStorage（回退 6-14 的 sessionStorage 改動）
- sessionStorage 在手機上分頁被回收即清除，導致頻繁重輸 → 對「手機常用」情境體驗差
- 個人單人儀表板、靜態網頁無使用者輸入，XSS 風險低，localStorage 持久記住較合適（先前安全性顧慮屬修過頭）
- 註：平常看數據用「↻ 重新整理」(不需 token)，「⬇ 抓新資料」才需 PAT

**Fix (Opus)：** bump `index.html` 的 app.js cache-buster（?v=20260612b → 20260615）
- 6-14/6-15 的 app.js 修正都沒更新版本號 → 已快取的瀏覽器仍讀舊檔，等於沒生效
- bump 後 T86 欄位/顏色/PC/PAT 等修正才真正送達瀏覽器
- 教訓：改 app.js 必同步更新 index.html 的 ?v= 參數

---

## 2026-06-14（Opus reviewer 第一輪：選擇權/三大法人口徑一致化）

**Request：** Opus 接手 reviewer，首次獨立稽核 stockweb 後端 fetch_taifex.py

**Fix (Opus)：** 選擇權 bc/sc/bp/sp 三條路徑定義不一致（A，沉默錯數字）
- 網頁爬蟲（主）只取外資；但 openapi fallback `parse_options` 與 FinMind 回填 `get_put` 卻加總自營+投信+外資（三大法人合計，量級約 3 倍）。dashboard 標籤是「外資策略/外資 P/C」，外資才是正解
- **實證斷層：** settlement_history 的 bp 在回填段(05/14~05/19 ≈ 64k~81k) vs 實抓段(05/20 起 ≈ 20k~32k)有 3.2 倍斷崖，純屬定義切換假象
- 修正：`parse_options` 改只取 Item 含「外資」者；`get_put` 改取賣權外資（列序 [5]，實證 0-2=買權自營/投信/外資、3-5=賣權同序）
- **實證對齊：** 修後三來源 06-10 外資 PUT 一致——FinMind 回填 bp/sp=25240/18877、taifex_data.json 實抓=25240/18877、openapi 06-12=26873/20925 與爬蟲一致

**Fix (Opus)：** 三大法人買賣超低估（B）
- `fetch_institute` 外資只取「外資及陸資(不含外資自營商)」、自營只取「自行買賣」，漏掉外資自營商與自營商(避險)
- **實證(6/12)：** 官方合計 518.66 億，原程式算出 457.6 億（少 61 億＝漏掉自營避險 61.03）
- 修正：自營=自行買賣+避險、外資=外資及陸資+外資自營商、依列首 startswith 精準比對（消除子字串順序風險）。修後 dealer=89.4 / trust=142.3 / foreign=286.9 / total=518.6 ＝官方合計

**Fix (Opus)：** `parse_futures` 改名稱比對取代固定位置索引
- 原本 idx[0,1,2]/[9,10,11]/[12,13,14] 純位置依賴，TAIFEX 改順序/加商品即整批錯位
- 實證 ContractCode/Item 已是乾淨中文，改以「商品名＋身份別」比對 OpenInterest(Net)；驗證 txF=-65039/mtxF=5734/tmxF=15432 不變

**Fix (Opus)：** 低優先清理
- 移除 `scrape_taifex_web` 內重構後已無人呼叫的 `_nums()` 死碼
- `fetch_institute` 補 unverified SSL context（與 market_volume 一致）
- 整理選擇權索引那段前後矛盾的註解；CSV fallback 加註 legacy 說明

**Fix (Opus)：** `app.js` 個股三大法人 modal（T86）欄位索引錯誤（沉默錯數字）
- `parseStockRow` 取 trust=row[7]、dealer=row[8]，但 T86 實際 [7]=外資自營商買賣超、[8]=投信「買進量」（非淨額）→ 個股「投信/自營商」兩欄一直顯示錯值（連正負都可能相反）
- **實證(6/12)：** 2330 修前顯示 投信=0/自營=173000，正確應為 投信=-149460/自營=-180577；修正為 foreign=row[4]+[7]、trust=row[10]、dealer=row[11]，三檔(2330/2317/2454)合計均=官方[18]三大法人買賣超
- 同步：外資改含外資自營商，與市場層三大法人 B 修正口徑一致

**Fix (Opus)：** `app.js` `chipRow` 顏色反置
- 1d 個股表三法人列用「正值=綠」，與同表合計列、5日表、台股慣例（買超紅/賣超綠）相反 → 改為正值紅、負值綠

**Fix (Opus)：** `app.js` P/C Ratio 門檻統一
- 顯示用 1.2/0.8（loadOptions）、評分用 1.5/0.7（loadSignalSummary）不一致 → 同一比值可能「顯示偏空恐慌卻不計分」
- 評分門檻改為 1.2/0.8，與顯示一致（如需調回評分敏感度可改此處）

**Fix (Opus)：** `app.js` GitHub PAT 改存 sessionStorage
- 原存 localStorage（持久、跨工作階段、易受 XSS/共用機器讀取）→ 改 sessionStorage，關閉瀏覽器即清除
- 代價：每個瀏覽器工作階段首次觸發抓取需重輸一次 token

**Fix (Opus)：** workflows / fetch_nq_only 健壯性（稽核第二批，低優先）
- 兩個 workflow 加共用 `concurrency: taifex-data-push`（cancel-in-progress: false），避免 fetch-taifex 與 update-nq 同時推送 taifex_data.json 撞車（原僅靠 rebase 重試化解）
- `fetch_nq_only.py` 改 `data.setdefault("volatility", {})["nq"]`，防 volatility 鍵不存在時 KeyError
- 已稽核未改（判斷後保留）：workflow 的 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`（移除有風險、需測）、`csv_to_json` 股名來源（非主板/未交易股名空白，純顯示）

**稽核完成：** 專案二全檔（fetch_taifex.py / app.js / 2 workflows / csv_to_json / fetch_nq_only / merged_to_json）已由 Opus 完整 review。

**注意：** settlement_history 既有的 05/14~05/19 斷崖 4 筆為舊定義產物，程式修好後不再產生，會隨每日 append 於約 4 個交易日後滾出近20天視窗（或可手動清重建，未做）。

---

## 2026-06-12（上市成交量歸零修正）

**Request：** 上市成交量顯示為 0

**Fix (Fable)：** `fetch_taifex.py` — 成交量抓取的沉默失敗＋整串覆寫缺陷
- 根因①：TWSE FMTQIK 偶發回空資料（不拋例外），Actions 6/11 21:59 那次就中招，
  整個 6 月的 twse 全變 0
- 根因②：market_volume 每次執行整串覆寫，一次壞抓取就清掉所有歷史；
  且月表只回當月，月初「近20天」縮水（6/11 時只剩 9 天）
- 修正：改抓「上月＋本月」兩個月表、各月重試 3 次、空資料視為失敗並印警告；
  新增 `merge_market_volume()` 按日期合併（新值非零才覆蓋、零/缺漏沿用舊值），保留 30 天
- 資料修復：本機重抓回補，5/14 起 29 天上市/上櫃值全部齊全（6/11 上市 13,385 億）

---

## 2026-06-12（結算日假日修正＋瀏覽人次診斷）

**Request：** 結算日要考慮國定假日；瀏覽人次顯示不正常，檢查邏輯

**Feat (Fable)：** `fetch_taifex.py` — 結算日與剩餘交易日納入台股休市日
- 新增 `fetch_tw_holidays()`：TWSE rwd holidaySchedule API，排除「開始/最後交易日」說明性條目，
  模組層快取；API 失敗時退回僅排除週末
- `get_settlement_date()`：第三個週三遇休市順延至次一營業日
  （實測 2026-02：2/18 春節休市 → 順延至 2/23 週一）
- `count_trading_days()`：剩餘交易日排除國定假日（影響結算比分母）

**Fix (Fable)：** 瀏覽人次顯示異常 — 兩層問題
- 根因①：GoatCounter counter API 全部回 403 → 後台未開啟
  「Allow adding visitor counts on your website」，需 Ball 登入 goatcounter.com 勾選
- 根因②：`index.html` 抓 `counter/index.html.json`，但網站路徑是 `/stocklist/`，
  該路徑永遠沒有計數 → 改用 `counter/TOTAL.json`（全站累計，符合「累計人次」本意）

**Fix (Fable)：** `app.js` — 移除前端死碼 `getNextSettlementDate()`/`daysUntilSettlement()`
（前端實際從 taifex_data.json 讀後端算好的 tdays，留著反而會與假日邏輯不同步）

---

## 2026-06-12（低風險缺陷清理）

**Request：** 處理 review 發現的低風險問題

**Fix (Fable)：** `fetch_taifex.py` — 主程式包進 `main()` 並加 `if __name__ == "__main__"` 保護
- 原本 `fetch_nq_only.py` 的 import 會誤觸整套抓取＋改寫 JSON（每天 6:30 NQ 排程都多跑一次全量）
- 已驗證：import 無副作用，`fetch_nq_only.py` 只更新 NQ

**Fix (Fable)：** favicon 回歸修復 — `index.html`/`links.html` 的 SVG data URI（Safari 不支援）
換回實體 `favicon.png`＋`shortcut icon`（5/30 修過但後來被蓋掉）

**Fix (Fable)：** `app.js` — P/C Ratio 改為數值比較（原為字串 vs 數字）；移除死碼 `getTwseDate()`；
`index.html` 更新 app.js 版本參數強制瀏覽器更新快取

**Fix (Fable)：** README 籌碼綜合評估說明改為與程式一致的正負分制
（原文件寫「滿分16、≥12強多」與實作不符）

**Fix (Fable)：** `fetch_yahoo_ohlc` docstring 日分界 5AM → 6AM（程式早已是 6AM，文件未同步）

---

## 2026-06-11（散戶期貨修正）

**Request：** 散戶期貨淨部位數值與實際不符，查明原因並修正

**Fix (Fable)：** `fetch_taifex.py` — 散戶淨部位只反映外資（投信/自營漏抓）
- 網頁爬蟲 `scrape_taifex_web()` 原只取外資淨OI（idx 17），投信/自營填 0；
  散戶 = −(自營+投信+外資)，自營在小台/微台部位龐大，漏掉後多空方向可能整個顛倒
  （6/11 實證：真實 +17,291 偏多 vs 原顯示 −7,396 偏空）
- 修正：每商品抓齊三法人淨OI（自營=idx5、投信=idx11、外資=idx17），
  並以頁面合計（idx 40）驗算，不符時印警告
- openapi fallback `parse_futures()` 同步補上微台（rows 12-14，以 FinMind 數值實證）

**Fix (Fable)：** `settlement_history` 散戶歷史回填 — 用 FinMind 三大法人資料
重算近 20 筆 `retail_total`（19 筆修正，含 10 筆原為空值）；
回填後顯示散戶 5/14 起持續偏多 +4,600～+24,900 口

---

## 2026-06-11

**Request：** 清除 git 歷史

**Fix (Fable)：** repo 歷史 squash 成單一 commit 後 force push
- 現有檔案內容完全不變，網站照常運作（Pages 自動重建）
- 程式演進記錄以本 CHANGELOG 為準（歷史清除後 git log 不再可考）

**Feat (Fable)：** 新增 `.gitignore`（排除本機工具與 `__pycache__/`）

---

## 2026-06-07

**Request：** 新增瀏覽人次顯示在 Buy Me a Coffee 按鈕上方

**Feat：** `index.html` — 加入 GoatCounter 計數器
- 追蹤 script：`gc.zgo.at/count.js`（`https://charlesju.goatcounter.com/count`）
- 顯示：JavaScript 呼叫 GoatCounter JSON API，將累計瀏覽人次顯示於頁面（`id="page-views"`）
- 取代原 hits.seeyoufarm.com（圖片顯示不穩定）

---

## 2026-06-03

**Request：** 散戶期貨淨部位與外資策略也要近20天歷史

**Feat：** `fetch_taifex.py` — `today_entry` 新增 `retail_total`（散戶小台當量合計）和 `opt_strategy`（外資策略文字）欄位，每日存入 `settlement_history`

**Feat：** `app.js` — `openRetailModal()`：散戶期貨淨部位近20天彈窗；`openStrategyModal()`：外資策略近20天彈窗（雙買/雙賣/看多/看空/中性色碼顯示）

**Feat：** `index.html` — 散戶淨部位列加「近20天 ▸」按鈕；外資策略列加「近20天 ▸」按鈕；新增兩個 modal

---

**Request：** 「抓新資料」按鈕 2 小時內都不觸發太嚴，希望縮短冷卻時間

**Fix：** `app.js` — `triggerFetch()` 冷卻從 120 分鐘縮短為 30 分鐘

---

**Request：** 上市成交量沒有顯示（twse 欄位為 0）

**Fix：** `fetch_taifex.py` — TWSE 成交量改用 `www.twse.com.tw/rwd/zh/afterTrading/FMTQIK`（原 `openapi.twse.com.tw` 在 GitHub Actions Linux 環境有 SSL 憑證問題）

---

## 2026-05-30

**Request：** 台股資料通常下午四五點出來，但五點後資料都太晚更新，希望 17:00、18:00、20:00 各更新一次

**Feat：** `fetch-taifex.yml` — 新增排程：
- 17:00 TWN（09:00 UTC）— 原有，三大法人通常已出來
- 18:00 TWN（10:00 UTC）— 補抓期貨/選擇權（較晚公布）
- 20:00 TWN（12:00 UTC）— 最終確認版

---

**Request：** NQ 每日更新應在收盤後（早上七點前）單獨跑一次

**Feat：** 新增 `fetch_nq_only.py` — 只讀取並更新 `taifex_data.json` 中的 NQ OHLC 部分

**Feat：** 新增 `.github/workflows/update-nq.yml` — 排程 22:30 UTC（= 6:30 AM TWN），夏令冬令均在 NQ 收盤後執行

---

**Request：** 確認 NQ 每日抓取的起訖時間，發現收盤後還跑一小時未被涵蓋

**Fix：** `fetch_taifex.py` — NQ 日分界從 `hour < 5` 改為 `hour < 6`（台灣時間）：
- 夏令（EDT）：NQ 4PM EDT = 4AM TWN（hour=4）→ 原本正確
- 冬令（EST）：NQ 4PM EST = 5AM TWN（hour=5）→ 原本被歸到隔天，現在修正
- 統一用 6AM TWN 作分界，兩種時制均正確包含最後一根 bar

---

**Request：** 台股（TX）波動起訖時間確認

- 起點：當日 15:00（夜盤開），終點：當日 13:45（日盤收）
- 合併 FinMind `after_market[D]` + `position[D]`，與 XQ 定義一致，無需修改

---

**Request：** Safari 手機/桌面版網頁沒有顯示 icon（顯示地球預設符號）

**Fix：** `index.html` — 移除 SVG data URI 格式（Safari 不支援），改為實體檔案：
- 新增 `favicon.png`（32×32，Python 純手工 PNG 生成）
- 新增 `apple-touch-icon.png`（180×180）
- `<link>` 加上 `sizes` 屬性、補上 `rel="shortcut icon"`

---

## 2026-05-28

**Request：** 台指期旁邊顯示最新資料日期（偵測資料是否過舊）

**Feat：** `index.html` — 台指期標題旁加 `<span id="tx-latest-date">`
**Feat：** `app.js` — `renderVol()` 讀取 `vol.history` 最後一筆日期並填入

---

**Request：** 新增近20天上市+上櫃成交量加總功能，顯示前一天的數值，含歷史彈窗

**Feat：** `fetch_taifex.py` — `fetch_market_volume()` 從 TWSE openapi + TPEx API 抓取每日成交金額（億元），存入 `market_volume` 陣列

**Feat：** `app.js` — `loadMarketVolume()` 讀取並顯示；`openVolumeModal()` 顯示近20天歷史

**Feat：** `index.html` — 新增成交量區塊（上市 / 上櫃 / 合計）及彈窗

---

**Fix：** GitHub Actions push 衝突導致 rebase 停住
- `fetch-taifex.yml` — `git pull --rebase` 改為 `git pull --rebase -X theirs`，衝突時 Actions 新資料優先

---

**Fix：** 結算比公式更新（分層計算 BP 加權）

原規則：BP-SP > 5000 才加入全部 BP

**Request：** 昨天結算口數來到 8000 多口，規則應調整為：
- BP-SP > 5000 且 < 10000：加 BP × 0.8
- BP-SP ≥ 10000：加完整 BP

**Fix：** `fetch_taifex.py` — `calc_settlement_ratio()` 第 446 行改為分層計算

---

## 2026-05-27

**Request：** 偵測到台指期資料只到 05/19，NQ 資料停滯

- TX：FinMind 有延遲，cron 時間點尚未更新，次日自動補上
- NQ：Yahoo Finance 在 Memorial Day（美國假日）缺少夜盤前幾個小時數據，屬資料源限制

---

## 2026-05-26

**Request：** NQ 週五的高低點要計算到週一早上 5 點收盤

**Feat：** `fetch_taifex.py` — `fetch_yahoo_ohlc()` 改用 1h bar，台灣時間 5AM 為日分界：
- 凌晨 5AM 前的 bar 歸屬前一天
- 週六/週日的 bar 一律歸入上週五
- 如此週五的一天含週五盤+週末夜盤到週一 5AM

---

**Request：** 散戶期貨需列出小台 + 微台（TMF），微台需要 ÷5 換算成小台當量

**Feat：** `fetch_taifex.py` — 新增 TMF scraping（commodityId=TMF），抓外資淨口數

**Feat：** `app.js` — 散戶 = 小台淨口 + 微台淨口÷5，顯示三欄：小台 / 微台(÷5) / 合計

---

**Request：** 偏多/偏空標記 — 散戶數值旁用括號顯示

**Feat：** `app.js` — `setRetailVal()` 加入偏多/偏空判斷，括號標示

---

**Request：** CALL/PUT 那一欄新增一列顯示目前外資策略狀態（雙買/雙賣/看多/看空）

**Feat：** `app.js` — 選擇權策略判斷（threshold=1000）：
- BC > SC + threshold 且 BP > SP + threshold → 雙買（Long Strangle）
- SC > BC + threshold 且 SP > BP + threshold → 雙賣（Short Strangle）
- BC > SC 且 SP > BP → 看多（Bullish）
- SC > BC 且 BP > SP → 看空（Bearish）
- 否則 → 中性
- 新增 `<div id="opt-strategy">` 顯示策略

---

**Request：** 新增 P/C Ratio（外資 PUT/CALL 未平倉比）

**Feat：** `app.js` — P/C Ratio = (BP+SP)/(BC+SC)：>1.2=偏空恐慌 / <0.8=偏多追漲
**Feat：** `index.html` — 新增 `<div id="opt-pc-ratio">` 顯示比值與標籤

---

**Request：** 根據三大法人買賣超、PUT/CALL、選擇權未平倉等，評估出整體狀態並列出

**Feat：** `app.js` — `loadSignalSummary()` 加權評分系統（滿分16）：
- 外資現貨 ×2、外資期貨 ×2、結算比方向 ×2、P/C Ratio ×1、選擇權策略 ×1、投信 ×1
- 輸出：評分 + 偏多/中性/偏空/強多/強空 + 各項細節
**Feat：** `index.html` — 新增「籌碼綜合評估」區塊（`signal-summary` + `signal-detail`）

---

## 2026-05-25

**Request：** 選擇權 BC/SC/BP/SP 數值錯誤（顯示 82681 而非正確的 9600）

**Fix：** `fetch_taifex.py` — 修正 `_nums_all()`：
- 原本 `_nums()` 只取前半段（誤以為重複），且加總所有機構；實際上 36 個數字 = CALL(18) + PUT(18)
- 外資（row 2）索引：BC=`opt_nums[15]`, SC=`opt_nums[16]`, BP=`opt_nums[33]`, SP=`opt_nums[34]`

---

## 2026-04-xx（早期版本）

**Feat：** 初始架構建立
- `index.html` + `app.js` + `fetch_taifex.py`
- 三大法人買賣超顯示
- 台指期外資淨口數
- 選擇權 CALL/PUT 未平倉

**Feat：** GitHub Actions 每日自動抓取
- cron `0 9 * * 1-5`（UTC）
- 抓取結果存入 `taifex_data.json` 並 commit/push

**Feat：** 波動分析區塊（TX + NQ，前日高低 vs 20日均值，低/小/中/大/高分類）

**Feat：** 結算比歷史追蹤（近20天趨勢彈窗）

**Feat：** 觸發更新按鈕（workflow_dispatch）

**Feat：** 加入 FinMind TX OHLC（日盤+夜盤合併，對應 XQ 定義）

**Fix：** 多次修正 GitHub Actions push 衝突、SSL 問題、CORS 問題

**Feat：** favicon ⚡（後因 Safari 不支援改為 PNG 實體檔）
