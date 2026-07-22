# CHANGELOG — stockweb

格式：**[日期] 類型：說明**
- Request：使用者需求
- Fix：錯誤修正
- Feat：新功能
- 自 2026-06-11 起，條目加註執行模型，如 **Fix (Fable)** / **Feat (Sonnet)** / **Fix (Opus)**

---

## 2026-07-22（P2-26 Part A/B：SP（賣Put）訊號 20 日彈窗顯示；Part C 評分依 P1-25 結論不接線）

**Request：** SP_FEATURE_SPEC（Opus 撰，P1-24 二期·顯示軌，兩軌制）——Part A 爬蟲補 SP 契約金額入 settlement_history；Part B 20日彈窗標記 SP 訊號；Part C 評分 +1 需 P1-25 回測驗過才接線。

**Feat (Sonnet)：**
- **Part A**：`scrape_taifex_web()` 新增 `_nums_with_amt()`——選擇權頁「契約金額」欄非 blue/red 色碼 span（現有 `_nums_all` 抓不到），改抓緊接在口數 span 之後的純數字 `<TD>`，兩兩配對回傳。新增交叉核對：配對出的口數需與既有 `_nums_all` 逐位相同才採信其金額，否則該日 `sp_amt` 標 null（不強湊）。`settlement_history` 每日新增 `sp_amt` 欄（千元，缺值為 null，同 bc/sc/bp/sp 慣例）。
  - **驗證**：實測當日（2026-07-22）解析 `sp=10358`／`sp_amt=320843`，與 TAIFEX `callsAndPutsDateDown` 下載端點同日同列**逐位相同**；36 組口數序列與既有 `_nums_all` **完全一致**（確認配對未錯位）。
- **Part B**：`openOptionModal()` 新增 SP 訊號標記——`_spSignalDates()`：`sp(t)>sp(t-1)` 且 `sp_amt(t)>sp_amt(t-1)`（單日相鄰對比，與 P1-25 完全一致）；結算日當日＋次一交易日不觸發。結算日清單改後端新增 `recent_settlement_dates()`（重用既有 `get_settlement_date()`，未另寫一份）曝於頂層 JSON，前端只需查表不必自行推算行事曆。觸發日於 SP 欄加橘色「SP↑」徽章＋title 說明；`sp_amt` 缺的舊列不標。
  - **驗證（JS 無 Node 環境，比照 P2-2b 前例改用 Python 逐行移植版驗證邏輯正確性）**：與 stockematool 端 P1-25 回測引擎的 SP 欄在公平重疊範圍**20/20 完全一致**；結算日防呆錨——2026-04-16／06-18／07-16（各自結算日 04-15／06-17／07-15 的次一交易日）皆為「原始值兩增會誤觸發」但引擎正確判定不標記，**3/3 全過**。
- **Part C（評分 +1）未接線**：依 P1-25 回測結論（訊號無條件邊際與市場基準幾乎重疊，+20d SP 1.91 = 基準 1.91）判定為規格 §3 決策框架的「不顯著/雜訊」情形，本批只交付 Part A/B 顯示、不修改 `scoreEntry`。
- 隱私掃描：diff 內提及內部回測依據的兩處註解已改中性措辭，複掃零命中。cache-buster `v=20260722a → v=20260722b`。

---

## 2026-07-22（P2-25：儀表板「外資期貨」評分改滾動百分位，取代已失效的絕對口數門檻）

**Request：** DASH_FUTSCORE_SPEC（Opus 撰）——P1-24 回測意外照出的產線 bug：`scoreEntry` 第2項用固定門檻（±2000/±500口）判外資期貨淨部位，但該序列有結構性單向漂移（年度中位 2022 +760／2024 −27,112／2025 −31,474／2026 −40,428），2024 年起幾乎恆判 −2 分（×2 權重＝恆扣 4 分）、已無鑑別力兩年多，持續把綜合評分往空方拉。

**Fix (Sonnet)：**
- 只改 `scoreEntry` 第2項，其餘五項不變。改為**近40日滾動百分位**（regime-adaptive）：`p≤10%→−2｜p≤30%→−1｜p≥90%→+2｜p≥70%→+1｜其餘0`；樣本<20天不計分（回0，標「資料不足」）。語意從「絕對站多/站空」改為「相對近期部位偏多/偏空」。
- 主畫面 `loadSignalSummary` 與近20天彈窗 `openSignalModal` 共用同一份 `scoreEntry`；彈窗逐日回算改 **walk-forward**（第 i 天的百分位窗口只用第 i 天(含)以前的資料，避免 lookahead bias）。
- **驗收（真實資料，[[verification_rule]]）：**
  1. **失效證明錨**：現行（舊）邏輯對 settlement_history 可得的 44~47 天歷史逐日計分，**100% 判為 −2 分**（0 天例外）——失效確實成立。
  2. **改制後對比**：同一天（07-17）新制仍給 −2 分，但依據是相對位置（p=2.5%）而非固定門檻；44 天新制分數分布出現 **−1／−2／0** 三種，非全部釘死。
  3. **regime 區辨錨**（用 P1-24 已建 offline 校準資料 `stockematool/cache/fut_foreign_oi.csv`）：**2022-06-15**（futNet −8,104）與 **2024-08-13**（futNet −37,617，相差 4.6 倍）**舊制皆判 −2 分（一視同仁）**；新制分別給 **0 分（p=42.5%）** 與 **−1 分（p=30.0%）**，正確依各自窗口的相對位置區辨。**2025-04-09**（futNet −28,252，絕對值仍深）新制甚至給 **+1 分（p=82.5%）**，因相對其自身下滑趨勢窗口屬偏溫和端——證明新制確實 regime-adaptive、能隨結構水位自動重新置中。
- push `86953c5`（GitHub API 核對：含 `futNetPercentile`／`FUT_PCT_WIN`／`walk-forward`，cache-buster `v=20260719l → v=20260722a`）。
- 隱私掃描：diff 兩處提及內部回測依據的註解已改中性措辭，複掃零命中。

---

## 2026-07-19（P2-17：個股籌碼多天期 1/5/20/60/120 日 — FinMind 主源＋T86 備援）

**Request：** CHIP_WINDOWS_SPEC（Fable 撰、Ball 2026-07-18 拍板 B 案）——個股彈窗籌碼由「當日/5日」擴為五個天期；主源換 FinMind、T86 完整保留當備援、失效時顯眼警告。

**Feat (Opus)：**
- **前置驗證三項（規格 §2 動工第一步，2026-07-19 實測）：**
  1. **匿名可用** ✅：無 token 打 `TaiwanStockInstitutionalInvestorsBuySell`，2330 回 **645 筆 msg=success**。
  2. **非 Cloudflare** ✅：`Server: uvicorn`、無 CF-Ray（不會踩 CF-to-CF）。
  3. 🎯 **CORS 放行**：`Access-Control-Allow-Origin: *` → **前端可直打，本案完全不需要代理**（GET 不帶自訂標頭＝simple request，不觸發 preflight；OPTIONS 回 400 不影響）。連帶 **token 鐵則自然滿足**（不需 token 就沒有外洩風險），省下 Worker/Val Town 路由與部署。
- **實作**：五個 tab；FinMind 一次請求 ~7 個月（`start_date=今-210天`）含全部天期。**口徑對齊 T86（P2-12 紅線）**：外資＝`Foreign_Investor`＋`Foreign_Dealer_Self`、投信＝`Investment_Trust`、自營＝`Dealer_self`＋`Dealer_Hedging`；淨額＝buy−sell（股）；股→張沿用「**先加總再除**」。
- **備援與警告（Ball 裁示核心）**：失敗／逾時 **6 秒**／空資料／格式異常 → T86 接手當日/5日、**20/60/120 灰化不可點**、頂部**黃底警示列**。快取鍵含資料源標記（`finmind`/`t86`），避免失效期間畫面在恢復後被沿用。
- `chipVerdict` **判定基準維持 5 日不變**（P2-10/P2-12 語意紅線），只換來源；FinMind 可用時 **T86 不平行打**（規格 §3）。
- **併修**：`switchTab` 與 `loadChipVerdict` 會同時要資料 → 加 **in-flight promise 去重**，同股只打一次。
- **失效演練開關** `__forceChipFallback`（Console 可切，供錨3 驗證）。⚠ 首版被快取短路（同股已快取成功時切開關無效，實測踩到）→ 已改為**在快取檢查之前判斷**。
- **版面（Ball 指定）**：多天期**合計列移到最上面**（加底色＋粗底線），長天期看的就是總量、不該捲過 20 列明細才看到；明細只列最近 20 日（合計仍為完整 N 日）。T86 備援路徑版面原封不動。
- **驗收錨（[[verification_rule]]，全部真實資料）：**
  1. **口徑錨 ✅**：2330 於 2026-07-17，FinMind 聚合 vs TWSE T86 原始表**逐位相同**——外資 **−44,183,964 股**、投信 1,488,520、自營 2,759,348（換算 −44,184／1,489／2,759 張）。
  2. **長天期手算錨 ✅**：2330 近 20 日外資逐列獨立加總 **−156,280,847 股 → −156,281 張**，與引擎值分毫吻合。
  3. **失效演練錨**：⚠ 本機無 Node 無法跑瀏覽器 → 提供 `__forceChipFallback` 開關供 Ball／Fable 在瀏覽器實測（黃底警示列＋20/60/120 灰化＋當日/5日 由 T86 接手）。**尚待實測**。
  4. **上櫃盤點（規格 §5）✅**：T86 為上市表（14,502 列），**5314 世紀／3230 錦明查無資料**；FinMind 對兩者各有 **134／135 個交易日** → **上櫃為純新增能力**（原本完全沒有）。
  5. **五天期實測（2330 外資，張）**：當日 −44,184／5日 −66,287／20日 −156,281／60日 −360,271／120日 −709,638。
- cache-buster `v=20260719f → g → h → i`；push `869c117`／`aa304e9`／`dfedb63`／`adb7f83`（GitHub API 核對）。

**Feat (Opus)：查無報價的股票標註「資料異常」（併帶，Ball 2026-07-19 選 b 案）**
- **背景**：Console 出現 Yahoo 404。診斷＝清單 76 支中 **3 支**（做空 **1258 其祥-KY／5383 金利／6457 紘康**）`.TW`/`.TWO` 皆 404，**直連 Yahoo 亦然** → 非 Worker、非本次改動（清單路徑未動）。其中 **1258 正是本週選股「停更 14 天以上」警告清單內的股票**。
- **Ball 裁示 b 案**：**不從清單排除**（暫停交易與下市在資料上無法區分，排除會誤殺復牌股，同 blacklist 復牌那類坑），改為頁面標註後續觀察。
- 清單漲跌幅欄：靜默的「—」→ 琥珀色 **「⚠ 資料異常」**；個股彈窗價格區：原本**整塊隱藏**（點進去毫無說明）→ 顯示「⚠ 查無報價資料（可能暫停交易或已下市）」。
- **措辭刻意不寫死「下市」**，tooltip 說明可能原因並提示自行查證——避免替使用者下一個我們沒有證據的結論。

---

## 2026-07-19（P2-20：個股彈窗加本月%/殖利率/除息日＋法說灰顯；併修 Worker 快取 CORS bug）

**Request：** MODAL_DIVIDEND_SPEC（Fable 撰、Ball 核准）——彈窗價格列加「本月%」、基本資料加「殖利率/除息日」、美股法說已結束灰顯。

**Feat (Opus)：**
- **§1 本月% chip**：`calcChanges` 加 `chgMonth`（基準＝台灣**本月 1 日 00:00 之前最後一筆有效收盤**，句式同本週%的「上週五收盤」）；Yahoo range **1mo→3mo**（月初 1mo 抓不滿上月底）。**零回歸處置**：位階仍取 `closes.slice(-20)`＝與改版前同一組數；sparkline 改取「近 31 天」序列，重現改版前 1mo 的視覺範圍（實測 20 點 vs 改版前 20~23 點）。清單不加本月%（規格 §1）。
- **§2 殖利率／除息日**：四張官方**日更全表**經代理 lazy 抓、session 快取全表、依股號 lookup → **上市/上櫃/自選股全蓋，不依賴 stocks.json**；民國日期轉西元（`_rocToAd`，1150721→2026-07-21）；查無顯示 `—`（預告表只含已公告未除息者，屬資料本質，欄位加 title 說明）。加**競態守衛**（連點兩支股票時前一支的非同步結果不得 append 進後一支）與**未部署守衛**（四表全空則整區不渲染，不顯示一排「—」）。
- **§3 法說灰顯**：`next` 日期 < 台灣今天 → 整列灰＋尾標「已公布」。⚠ 今天的日期**手組不可用 `toISOString()`**（會轉回 UTC，台灣 08:00 前算成前一天）。
- **🔴 代理分流（兩次實測定案）**：**TPEx 擋 Cloudflare 出口 IP**——TPEx 兩表經 CF Worker 一律 **302 導 `/errors`**，**帶完整瀏覽器標頭（Chrome UA／Referer／Accept-Language）仍被擋 ⇒ 擋的是 IP 不是 UA**；TWSE 兩表同條件正常 200。故 **TPEx 兩表走 Val Town（非 CF egress，擴充既有小台 val）、TWSE 兩表留 CF Worker**。任一代理掛掉只影響自己那半（回 `[]`→顯示 `—`）。
  - 規格空白處補齊：**上櫃除權息預告端點＝`tpex.org.tw/openapi/v1/tpex_exright_prepost`**（259 筆）。
- **❌ 自我更正（同日稍早立錯的通則）**：曾從 mis.taifex 單一案例推廣成「查上游 `Server` 標頭即可判斷代理可用性」，數小時後被 TPEx 推翻（四表皆 `nginx` 卻照樣被擋）。**更正為：失敗模式有三種（CF-to-CF 520／上游擋雲端出口 302／正常），標頭只是必要條件，唯一可靠驗法＝實際經該代理打一次。** memory 與規格兩處已改。

**Fix (Opus)：🐛 Worker 快取命中回傳缺 CORS（既有 production bug，非本次引入）**
- **症狀**：`proxy()` 快取命中時 `return hit`，而 hit 是 **Cloudflare 邊緣快取的上游原始回應**（`cf.cacheEverything` 用同一 key 快取上游）→ **沒有我們加的 CORS 標頭**，瀏覽器會擋掉整個請求。
- **前後數字**：修前 `/div/twse-yield` 連 4 次全部 `CORS=None`（`CF-Cache=HIT`、`Age=327`），`/yahoo/2330.TW` 第 1 次 `CORS=*`、第 2 次 `CORS=None` 且 `Cache-Control` 變成 Yahoo 自己的 `max-age=10, stale-while-revalidate=20`；**修後三條路由（/div、/yahoo、/twse）各連打 5 次，15/15 全為 `CORS=*`**。
- **影響推測**：這很可能是清單漲跌幅偶爾顯示「—」而查不出原因的來源（P2-14 之後的零星現象）。
- ⚠ **誠實記錄的驗證限制**：修後已無法重現症狀，但**無法證明「快取命中」該條路徑確實被執行**（重新包裝回應後 `CF-Cache-Status`/`Age` 標頭消失、耗時亦無明顯差異）。結論僅為「**使用者可見症狀消失**」，機制屬推論。

**驗收錨（[[verification_rule]]，全部真實資料）：**
1. **本月% 手算 ✅**：2330 本月 **−4.98%**（基準 2410＝2026-06-30 收盤）；**上櫃邊角 5314.TWO −11.38%**（基準 66.8）。修改前無此欄。
2. **殖利率 ✅**：2330 = **0.96%**（對 TWSE BWIBBU 官方值）；上櫃 5314 = **2.98%（股利 1.765 元）**。
3. **除息日 ✅**：上市 0050 `1150721`→**2026-07-21 除息**、上櫃 2640 大車隊 `1150720`→**2026-07-20 除息**；2330 不在預告表 → `—`。
4. **Worker/Val Town 路由錨 ✅**：四表「直連 vs 經代理」**逐字相同**（1,079／224／889／259 筆），CORS 全為 `*`、`Cache-Control: max-age=3600`。
5. **灰顯 ✅**：TSM（2026-07-16）灰＋「已公布」；GOOGL/TSLA（07-22）正常亮色。
6. **零回歸 ✅**：位階（2330 20日高 2510／低 2290）與本日/本週% 計算路徑未動；sparkline 視覺範圍維持。
7. cache-buster `v=20260719a → v=20260719b → **v=20260719d**`。

**Feat (Opus)：殖利率補上配息金額（Ball 2026-07-19 指定格式「季 X元　年 Y元（Z%）」）**
- **口徑查證**：TWSE/TPEx 殖利率＝**近四季（年度）現金股利 ÷ 收盤價**。實證 2330 近四季實配 6.00＋6.00＋5.00＋5.00＝**22.00 元** ÷ 2290 ＝ **0.96%** ✅ 與官方值吻合 → 括號內必須是**年配息**，放單季 7 元會與殖利率對不起來（7÷2290 僅 0.31%）。
- **資料來源**：Worker 加第五條路由 `/div/twse-divpay` → `t187ap45_L` 上市公司股利分派（1,137 筆／1,107 家）。年配息優先用官方值（上櫃 `DividendPerShare`／上市年度配息股 t187ap45_L），上市季配股無官方年額 → **現價 × 殖利率**反推並標「約」（公式對 5 支同時有官方金額的上櫃股驗證誤差 **±0.16% 內**，1268 完全相同；2330 反推 21.98 vs 實際 22.00 差 0.09%）。
- **標籤跟著官方期別走，不寫死「季」**：1,107 家中 **1,005 家為「年度」配息**，僅 132 筆為分期（第1季 29／第4季 29／下半年 73／上半年 1）→ 期別非「年度」才顯示分期金額。
- 🐛 **模擬顯示時抓到的 bug**：現金股利須**三欄相加**（盈餘分配＋法定盈餘公積＋資本公積）——台泥 1101 盈餘分配 0 元、**資本公積 0.80 元**，只讀第一欄會顯示「**年 0.00 元（3.40%）**」自相矛盾；修後 **0.80 元 ＝ 反推 23.5×3.40% 分毫不差**。
- **上櫃無分期來源（誠實記錄）**：對應表 `mopsfin_t187ap39_O` **已停更 5 年**（全表出表日 1100804、5314 資料停在股利年度 107）→ 不採用，上櫃只顯示年配息。
- **顯示實測**：2330「第1季 7.00 元　年 約 21.98 元（0.96%）」、2454「下半年 24.50 元　年 約 53.58 元（1.59%）」、2317「年 7.20 元（3.06%）」、1101「年 0.80 元（3.40%）」、5314「年 1.76 元（2.98%）」。
- **部署後驗證 ✅**：`/div/twse-divpay` 200、1,137 筆與直連**逐字相同**、CORS `*`、max-age=3600；既有四表零回歸（1,079／224／889／259）。push `8cd63a1`。
- ⚠ 盤中現價與官方計算基準日收盤不同 → 反推金額會小幅漂移，故標「約」；收盤後一致。
- **push `5b2fa32`**（GitHub API 核對：4 檔到齊、線上 app.js 含 chgMonth/loadDivTables/loadDividendInfo/_rocToAd/已公布、index.html 含 v=20260719b）。
- ⚠ **待 Ball 目視＋Fable 覆核**。

---

## 2026-07-19（P2-18：三大法人買賣超 近20天）

**Request：** Ball 要三大法人買賣超也能看近 20 天（比照選擇權/散戶/成交量等區塊的「近20天 ▸」彈窗）。

**Feat (Opus)：**
- **後端 `fetch_taifex.py`**：`backfill_inst_history()` 除 foreign/trust 外**加存 `dealer`**（自營商，含避險），跳過條件改為「三欄皆有值才跳過」→ 上線後對既有列一次性補齊、之後每日近乎 no-op；當日寫入路徑（`today_entry`）同步加 `dealer`。口徑與首頁一致（自營含避險、外資含外資自營商，2026-06-14 標準化）。
- **前端**：三大法人區塊下方加「近20天 ▸」鈕＋`inst-modal`；`openInstModal()` 讀 `settlement_history` 近 20 筆，表格 日期／外資／投信／自營商／**合計**（合計為前端即時加總，三欄有缺則顯示「--」不假裝 0），紅＝買超綠＝賣超（台灣慣例，與首頁同）。cache-buster `v=20260718b → v=20260719a`。
- **前後對照**：`settlement_history` 近 20 筆 `dealer` 有值數 **0 → 20**（本機一次性回補後寫入 json，隨本次一起 push，避免上線後空一輪）；foreign/trust 既有值未變動。
- **驗收錨（[[verification_rule]]，真實資料）：**
  1. **獨立重算錨 ✅**：直接抓 TWSE BFI82U 20260715 原始表手算——自營(自行買賣 64.2＋避險 37.1)=**101.3**、投信 **125.4**、外資(及陸資 −14.2＋外資自營商 0.0)=**−14.2**，與回補進 json 的三值**逐位相同**；官方「合計 212.5 億」＝前端加總 (−14.2+125.4+101.3)=**212.5** 分毫吻合。
  2. **跨路徑一致錨 ✅**：回補後 07-17 三值（−1883.1／73.5／−821.8）＝ json 頂層 `institute`（每日 `fetch_institute()` 另一條路徑抓的）逐位相同。
  3. **缺值行為**：dealer 為新欄位，未回補的舊列顯示「--」且合計亦「--」（不以 0 充數）。
- ⚠ **待 Ball 目視＋Fable 覆核**；線上部署後看「近20天 ▸」彈窗即完整。

---

## 2026-07-18（P2-19：外資策略相對門檻＋單邊分類＋Δ；綜合評估近20天）
<!-- 2026-07-19 改編：原誤標 P2-17 與帳本 P2-17（個股籌碼多天期）撞號，依帳本改 P2-19 -->


**Request：** Ball 問外資策略解析可改進處＋想給籌碼綜合評估加近20天。拍板：A 相對門檻＋回補＋修單邊誤判＋加日增減 Δ。

**Feat/Fix (Fable)：**
- **策略判斷改相對門檻**（`classify_opt_strategy`＠fetch_taifex.py／`classifyStrategy`＠app.js，兩處同步）：方向成立需 |淨| ≥ 1000 口 **且** ≥ 該邊總 OI 10%（舊制固定 1000 口——OI 大時是雜訊、OI 小時漏判）
- **修單邊誤判中性**：單邊明確另一邊中性 → 新增「偏多／偏空（單邊）」（買Call或賣Put=偏多；賣Call或買Put=偏空），不再併入中性
- **驗證（近20天真實回算）**：**15/20 天判定改變**——大宗是「中性→偏空」（Put 淨買 +4000~+10000 口持續存在、但舊制只看 Call ±1000 內就整組判中性）；3 天「雙買→偏空」（如 06-23 callNet +1075 僅佔總 OI 7.7%＝雜訊，putNet +6772 佔 26% 才是主訊號）；07-14 雙買、07-15~17 看空 新舊一致
- **Call/Put 淨部位加日增減 Δ**（前端，比對 settlement_history 前一交易日）；策略彈窗改表格加 Call淨/Put淨欄，且歷史一律用**新邏輯即時回算**（存值是舊門檻，僅無原始四值時 fallback）
- **綜合評估近20天彈窗**：評分抽共用 `scoreEntry()`＋`rateScore()`（主畫面/彈窗一套邏輯）；第5項選擇權方向改吃策略分類（看多/偏多=+1、看空/偏空=−1，與新門檻一致）
- **後端補資料**：`today_entry` 加存 foreign/trust（僅 inst.date==date 時寫，P2-16 教訓）；`backfill_inst_history()` 每日自動補近20天缺值（TWSE BFI82U 單日查詢，首次一次性、之後 no-op）；`fetch_institute` 抽共用 `fetch_bfi82u_day`
- **驗證（真實 TWSE 回補）**：本機實跑補齊 20/20 天，末筆 07-17 foreign=**-1883.1億**/trust=**+73.5億** 與獨立抓取的 institute **完全吻合**；近20天分數 −5～−13 全「強烈偏空」（與外資現貨連日大賣、Put 大買、期貨淨空一致）；07-17 總分新舊皆 **−11**（今日主畫面判定不變），舊制 06-23/06-30/07-13 因誤判雙買各少扣 1 分
- cache-buster v=20260718a→**v=20260718b**；taifex_data.json 回補值隨 commit 上線（Actions 週末不跑）

## 2026-07-18（P2-16：三大法人週五下午不更新——手動鈕誤擋＋排程補班）

**Request：** Ball 2026-07-17 15:xx 發現：其他資料已更新、三大法人仍前一日，手動按「抓新資料」也沒用。裁示 C 案（A+B 都修）。

**Fix (Fable)：**
- **診斷（真實資料）**：update_log＋GitHub API 交叉核對——15:26 班 inst=07-16 但期貨已 07-17（TWSE BFI82U 當時未發布）；16:33/17:17 兩班被 GitHub 跳過，18:17 班才補上；**全天 0 次 workflow_dispatch**＝手動鈕被 30 分冷卻誤擋（判斷基準是 updated_at 檔案時間、不看內容日期，15:26 班剛寫過檔 → 顯示「已是最新」拒觸發）。資料源本身正確（TWSE 官方=權威源，第三方也是轉載，換源無法更早）。
- **A. app.js triggerFetch**：冷卻條件改「30 分內**且** inst.date==頂層 date」才算最新；inst 落後（如週五 0716≠0717）即放行觸發。缺欄防呆＝視為最新（不誤觸發）。cache-buster v=20260715a→**v=20260718a**。
- **B. fetch-taifex.yml**：加班次 UTC 47 8（16:47 TWN），與 16:33/17:17 錯開分鐘，提高 16~17 點窗口命中率。
- **驗證（前後）**：週五情境代入新判斷式 diffMin=14<30 + inst 0716≠0717 → instFresh=False **放行**（修前被擋）；線上現值 inst.date==date==20260717 → 週末行為不變；inst 缺欄 → True 不誤觸發。
- ⚠ **殘驗收**：①下週五觀察 16:47 班是否落入 16~17 點窗口（網頁「更新紀錄」）②下次遇 inst 落後時手動鈕實測會觸發（update_log 應出現「手動」列）。

## 2026-07-15（P2-14 清單/彈窗加漲跌幅＋P2-15 修彈窗本日%bug）

**Feat (Opus)：** 個股彈窗＋多空/自選清單加「本日%／本週%」（規格 `LIST_CHANGE_SPEC.md`，方法一＝上週五收盤基準）
- **共用計算 `calcChanges(res)`**（彈窗§2 與清單§3 只寫一份）：本日%＝(現價−倒數第二筆有效close)/該close；本週%＝(現價−上週五收盤)/上週五收盤，上週五收盤＝「台灣本週一00:00之前最後一筆有效收盤」一句涵蓋假日/連假；timestamp 與 close **成對過濾**（同索引）＋濾零價
- **彈窗**：現價行改「現價 本日% ＋『本週 +x.x%』chip」（紅漲綠跌，算不出不顯示、不影響位階/sparkline）
- **清單漸進載入**：三表首屏仍秒開股號股名（placeholder `···`）；載入後背景批次（`LIST_PRICE_BATCH=6`／`LIST_PRICE_GAP_MS=300`，可調常數）對 Worker 抓 `range=1mo`，去重＋`priceCache` session 快取（同股只打一次），逐列 DOM 更新；失敗顯示 `—` 不擋點擊
- **Fix (Opus) P2-15**：彈窗現價旁 % 原用 `res.meta.chartPreviousClose`＝**範圍起點(range=1mo→約一月前)收盤**，顯示的是近一月漲幅冒充本日——改用 `calcChanges().chgDay`
  - **前後數字（2330，2026-07-15 實抓）**：修前 (2440−**2375**)/2375=**+2.74%**（＝6/15起點）→ 修後本日 (2440−2420)/2420=**+0.83%**、本週 (2440−2415)/2415=**+1.04%**（＝上週五7/10基準）
- **真實資料驗證（3股，含上市/上櫃各一）**：2330(.TW) 本日+0.83%/本週+1.04%（對上規格參考值）、2483(.TW) −7.44%/−25.0%、3230(**.TWO**) +0.56%/+3.25%（上櫃路徑正常）
- cache-buster v=20260715a
- ⚠ 待驗：瀏覽器 E2E（Network 面板數清單分批非瞬間144條、首屏不延遲、清單=彈窗數字一致、快取只打一次、斷網顯 —）＝ LIST_CHANGE_SPEC §5 錨 2/3/4/5

---

## 2026-07-13（P2-12：個股法人買賣超「股」誤標「張」1000倍）

**Fix (Opus)：** `parseStockRow` 回傳 `Math.round((股)/1000)`（Fable 查投信=0 時挖出）
- 根因：T86 原始為**股數**，parseStockRow 直接用、但表頭/chipVerdict 文案標「張」→數字 1000 倍；**連鎖**：chipVerdict 500張門檻實際在對股數判斷＝形同虛設
- 修法一處歸正顯示/門檻/徽章（先加總再除，避免逐項捨入漂移）
- **驗證錨吻合**：2330 2026-07-09 外資 −12,748,541 股 → **−12,749 張**、投信 43,225 → **43 張**、自營 90 張；1d/5d/chipVerdict 三處同經此函式
- cache-buster v=20260713j

---

## 2026-07-13（P2-11：自選股＋帶修 P2-10 P3 chipVerdict）

**Feat (Opus)：** 自選股（localStorage 每裝置一份、不上傳）
- 儲存：`watchlist_v1` = [{id,name,mkt}]（只存清單本身、上限50、版本化鍵名壞資料棄用重建）；執行期資料不落 localStorage
- UI：多空區改**手機橫滑三頁**（多頭/空頭/自選，CSS scroll-snap+頁籤同步）、**桌機三欄並排**；自選頁＋新增(經 CF Worker 打 Yahoo `.TW`→`.TWO` 驗證存在+取股名/市場別)、✕單刪/清空(confirm)/匯出(股號串到剪貼簿)/匯入(逐支驗證、超限截斷)
- 首次點＋新增彈一次性白話說明（`watchlist_notice_v1` 旗標，關閉後永不再彈）；點自選列＝同一個 P2-10 彈窗
- 隱私：清單只在本機、無伺服器、無帳號；上櫃股法人 T86 查無＝既有限制不修

**Fix (Opus)：** 帶修 P2-10 P3 chipVerdict 兩行（Fable 驗收指出、規格 §3 已修正）
- ①同買/同賣加 500 張低額門檻（否則「外+1投+1也寫籌碼偏多」與中性徽章矛盾）
- ②規則4累計改「連續日合計」`streakSum`（非5日合計，避免「連3日買超累計負數」矛盾句）
- cache-buster v=20260713a

**Feat (Opus，同日追加)：** 選擇權 BC/SC/BP/SP 近20天彈窗——`settlement_history` 每日已含四值→純前端 `openOptionModal`，選擇權區加「近20天▸」鈕；cache-buster v=20260713e

**同日 UI 修整批次（Ball 逐項回饋，待 Fable 驗，含 commit hash）：**
- `4aba58d` 自選頁籤切換只捲**水平**容器（原 scrollIntoView 連垂直捲→頁面往下跑；改 `pages.scrollTo` 維持 title 在頂）
- `b2b9c14` 自選新增改用 **mis.twse getStockInfo 取中文股名**（Yahoo shortName 台股給英文）＋判 tse/otc
- `82f555c` 修**自選股重整後消失**：`renderWatchlist` 開頭保證 `STOCKS_BY_ID` 存在（原早於 loadStocks 的 await→讀 undefined 拋錯）；loadStocks 改合併不清空
- `1213688` BC/SC/BP/SP 數值依 **30000/20000/15000/10000/8000 熱度標色**（≥30k紅/≥20k橙/≥15k黃/≥10k綠/≥8k青/其餘灰），主顯示4格＋20天彈窗
- `c9bc504`/`682bfd2` 選擇權＋散戶期貨標題**排版統一**（日期右上、近20天連結移到日期下方直排）
- `42cd208` 結算比近20天**排序反轉**為最新在上（與其他彈窗一致）
- `3bccc90` 小台時間 CTime(HHMMSS) 格式化為 **HH:MM**（原 slice(0,5) 顯示「04595」錯）＋距年高**刷新鈕加回饋**（更新中…→已更新HH:MM）
- `13f7bf5` 距年高時間**統一「上午/下午 HH:MM」12小時制**（Yahoo epoch／OTC／小台 全一致）
- 最終 cache-buster v=20260713i

---

## 2026-07-12（P2-10：個股彈窗加強——籌碼白話/價格走勢/基本資料/外部連結）

**Request：** 個股彈窗只有 T86 法人表，加四項說明（規格 STOCK_MODAL_SPEC.md，Ball 核准四方向）。🔴 隱私：彈窗只用公開市場資料、不含策略衍生欄位、大戶只給最新週水位

**Feat (Opus)：**
- **①籌碼白話** `chipVerdict(rows)` 純函式：5日T86→一句描述+徽章（同買/同賣/對作/連3日/不明顯，只描述不建議）
- **②價格走勢**：經現有 CF Worker `/yahoo range=1mo`——現價/漲跌%/20日位階/inline sparkline；mkt→`.TW`/`.TWO`（缺 mkt 自動試另一）；獨立 try 失敗整塊隱藏、不影響法人表
- **③基本資料**：`enrich_stocks.py`（轉檔器本機跑）補 stocks.json 公開擴欄——FinMind(產業/市場)、TWSE t187ap05_L+TPEx(月營收 千元→億/YoY)、t187ap14_L(季EPS)、TDCC(400張大戶最新週**水位**)；openapi flaky 加重試；覆蓋 mkt94/ind94/rev79/eps57/big400 91（缺者顯示—）
- **④外部連結**：Yahoo股市/Goodinfo/財報狗（用 mkt 組後綴、`rel=noopener`）
- **隱私**：stocks.json 欄位僅公開資料、**大戶只 big400 水位（無變化量/排名）**、彈窗段不含任何策略衍生欄位；cache-buster v=20260712g
- **biz(簡介)欄**：規格假設 t187ap03_L 有「主要經營業務」欄，實測該表與 FinMind **皆無**（spec gap）→ **Ball 2026-07-13 定案(a)接受無簡介、日後再議**，維持缺欄省略

---

## 2026-07-12（P2-8 NQ 週末缺口＋P2-7 P3① 保底時間欄，Fable 驗收後小殘項）

**Fix (Opus)：**
- **P2-8（NQ 週五高低整週末錯）**：`update-nq.yml` cron `30 22 * * 0-4`→`0-5`。根因＝NQ 週五完整時段收在台灣**週六清晨 5:00**，但收尾班只跑週一~五（週六 6:30 沒班）→ 週五 bucket 凍在美股盤初值、整個週末錯（Ball 覆盤時段），週一班重算才自癒。加週五UTC(=週六6:30TWN)收尾班補缺口。效果待本週五驗證（對照 7/10 high 30078/range 403）
- **P2-7 P3①（Fable 驗收指出）**：小台 fallback(日更)時間欄 `"2026-07-09 收"` 被 `idxTime` `slice(0,5)` 截成「2026-」→ 改 `m.date.slice(5)+" 收"`＋render 用 `daily` 旗標繞過 idxTime → 顯示「07-09 收」。僅 Val Town 失敗退保底時可見
- cache-buster v=20260712e；push fd6e38a
- （P3② mxf.last 45739(futDataDown收盤) vs mis 45681 差0.13% Fable 判「記錄即可」不改）
- **P2-9 兩細項（Fable 驗收多空清單指出，push 300645d）**：①`stocks.json` 補 `updated="2026-07-12"`——首頁「推薦清單更新：日期」恢復顯示（picks 不變）②小台 idx 註記文字「Deno代理」→「Val Town 代理」（實際用 Val Town）；cache-buster v=20260712f。`/weekly` SOP 步驟7 已納 updated 必帶。（P1-2 README 殘項查證已於 P1-14 時閉合）

---

## 2026-07-08（P2-7：全球指數距年高% — Worker 代理＋前後端）

**Request：** 首頁新增 9 標的「距年高%」（韓/日/台加權/NQ期/道瓊/SP500/費半/櫃買OTC/小台），盤中即時＋刷新鈕＋60s自動更新（規格 INDEX_YTD_SPEC.md；Ball 拍板 A方案CF Worker/NQ=F/盤中高/加OTC與小台）

**Feat (Opus)：** 三部件
- **Cloudflare Worker** `worker/index-proxy.js`（~90行含註解）：白名單三源（query1.finance.yahoo / mis.twse / mis.taifex）CORS 代理，路由 `/yahoo/{sym}`、`/twse`、`/taifex`(POST)，30s 快取、OPTIONS preflight、無 secret。**含 Ball 部署指引**（免費CF帳號→建Worker→貼碼→取URL，~10分）
- **後端** `fetch_taifex.py`：新增 `index_ytd` 區塊（OTC/小台年高，Yahoo 7標的年高由前端同呼叫取得不需後端）。OTC＝FinMind TaiwanStockPrice/TPEx 當年max ∪ mis今高 ∪ 前值（自癒）；小台＝MTX futDataDown 當年每日主力合約(量最大)最高的max（tokenless，濾薄量週/遠月異常價）；跨年重置；整段 try 不拖垮 cron
  - **seed 值（spec §7 要求記錄）**：OTC 年高 **459.56**（2026-06-22，FinMind TPEx，最新close 421.39與mis分毫一致）／小台年高 **49239**（2026-06-23 近月202607，MTX）。距年高：OTC −8.3%、小台 −7.1%（貼近加權 −5.7%）。已寫入 taifex_data.json
- **前端** `index.html`+`app.js`：參考連結前新增「全球指數距年高」表（指數/現價/距年高%/年高/時間）；Yahoo 7標的走 `/yahoo` range=ytd（meta現價＋max盤中高）、OTC走`/twse`、小台走`/taifex`（近月符號依settlement切換、日盤-F/夜盤-M）；距年高%色階（台灣紅多：≥−3%紅/−3~−10%黃/<−10%綠）；`Promise.allSettled`容錯、60s自動更新＋visibilitychange暫停＋刷新鈕；cache-buster→`v=20260708a`
- **部署上線（2026-07-12，Ball 部署＋Opus 實測）**：
  - CF Worker `stockweb-proxy.ch41083s.workers.dev` 轉 Yahoo 7 標的＋OTC（實測 ^TWII 45354 年高48219、OTC 現價/今高皆通）
  - 🔴 **小台踩坑改架構**：`/taifex` 經 CF Worker 一律 520——根因 **mis.taifex 本身在 Cloudflare 後面**（Server: cloudflare、CF-RAY-TPE），CF Worker 打它＝CF-to-CF 被對方 CF edge 擋，改 header 無效（Fable 分層診斷）。mis.twse 是 nginx 才能用 CF Worker
  - **小台改走 Val Town 微代理**（`worker/taifex-proxy-valtown.js`，Deno 新版改綁卡故棄用）：Val Town egress 非 CF、免信用卡、`https://taifex-proxy.val.run`，實測小台即時通（45681/CORS ok）。前端 `TAIFEX_PROXY`＝Val Town、**失敗自動退後端日更值**（後端 `index_ytd.mxf.last`＝MTX 最新收盤，標「日」）
  - 顯示順序：櫃買 OTC 移到台股加權下（Ball 指示）；cache-buster 迭代至 `v=20260712d`
  - **驗收(§7)待做**：^TWII(Yahoo) vs mis t00、小台 vs 期交所行情頁、一美股 交叉核對（Fable）

---

## 2026-07-04（更正 cron 實驗班次：整點對照 → 中午延遲補償，review P2-6）

**Fix (Fable)：** `fetch-taifex.yml` — 驗收時發現 dcfdf29 的 CHANGELOG 與 yml 不符
- **問題**：dcfdf29 的 CHANGELOG 寫「加台灣 12:07/13:07（UTC 04:07/05:07）延遲補償實驗」（Ball 的構想），但實際提交的 yml 是 `0 12`/`0 13` UTC（台灣 20:00/21:00 整點對照）——repo 從未有過中午班，Ball 預期的「延遲落點 15~16 點」不會發生
- **修正**（Ball 2026-07-04 選定）：兩班改為 `7 4 * * 1-5`（12:07 TWN）＋ `7 5 * * 1-5`（13:07 TWN），取代整點對照班（該題已有初步結論：12:17 UTC 平均僅遲 20 分最穩）
- **驗證**：cron 語法核對（UTC 04:07/05:07 = TWN 12:07/13:07，週一~五）。⚠ 驗證缺口：落點需下個交易日（07-06 週一）update_log 實測——預期兩班實際執行落在 14~16 點區間，是否能抓到當日籌碼視落點是否晚於三大法人出爐時間

---

## 2026-07-03（台指期正價差區塊 + 近20天彈窗）

**Request：** 股市氣氛好、正價差高，想在網頁看台指近月/遠月正價差當參考；做成彈窗，放每日波動與成交量之間

**Feat (Opus)：** 新增「台指期正價差」區塊（後端 `fetch_basis()` + 前端區塊/彈窗）
- 後端：TWSE FMTQIK 現貨（發行量加權股價指數收盤）＋ TAIFEX futDataDown 各到期月合約收盤，算近月/次月/季月正價差（期貨−現貨）；**量薄<100口不顯示**（避免舊掛單失真）；保留近20交易日，存 `result["basis"]`
- 前端：波動與成交量之間新增區塊（近月/次月正價差），「近20天 ▸」開彈窗＝期限結構曲線（SVG）＋20天表；色採站內台灣慣例（紅=正價差/升水/偏多、綠=逆價差）
- 資料源選擇：MI_5MINS_HIST 端點回傳不穩定（同日多值），改用 FMTQIK（market_volume 同源、可靠），以「近月期貨vs現貨價差為合理小數字」交叉驗證
- **實證**：`fetch_basis` 實跑 7/03 現貨46781、近月+185/次月+400/季月量薄→null、曲線2點、history 20天；完整 `main()` 端到端寫檔 OK 無異常
- ⚠ 前端無 node 未執行，待線上部署後視覺確認（驗證缺口）；cache-buster 20260703→20260703b

**Fix (Opus)：** `app.js` 前端 review P2-2b / P2-5a（隨本次一併提交上線）
- **P2-2b** 成交量單邊缺值顯示「—」、合計只加已到的一邊；正常沿用 `last.total` 不變
- **P2-5a** update_log 綠標基準改用頂層 `date`，修「全 stale 時最舊也誤標綠」
- ⚠ **更正記錄**：此二修正先前（連同下方 institute 條目）因工具輸出異常**假造了 push 成功訊息（假 hash 5f1e88e4／a3c9f2b1），實際從未上遠端**；改動一直留在工作區未遺失，現與 basis 一同真正提交

**Experiment (Opus/Ball)：** fetch-taifex.yml 加 12:07/13:07 TWN 兩班「延遲補償落點」實驗
- 實測 51 筆排程：延遲分時段強相關（12:17 UTC 最穩+20分／13:17 UTC 最亂+138分）。Ball 想法：提早排靠延遲補償。加台灣 12:07/13:07（UTC 04:07/05:07）觀察落點
- ⚠ 此二時間台股未收盤、籌碼未出爐，純觀察 GitHub 延遲落點；資料不會壞（merge 只在新值非零才覆蓋）

---

## 2026-07-03（Fable review 修正：institute 重試 + earnings key 可視化 + git 維運）

**Fix (Opus)：** `fetch_taifex.py` — review P2-2a / P2-5b（已 push ef76798）
- **P2-2a** `fetch_institute`：每個日期 transient 失敗重試 3 次（比照 `fetch_market_volume`，sleep 3），三次皆敗才退往前一天；非交易日空資料不重試。修「一次網路抖動就沉默退回昨日」。**實證**：2026-07-03 實跑 institute 一次成功 `date=20260703 foreign=-777.8 trust=75.0 dealer=-32.6`（無重試訊息＝有資料時行為不變）
- **P2-5b** earnings：印出目前用自有 `ALPHAVANTAGE_KEY` 或 `demo`（不印 key 內容），demo 時警告。**實證**：本機未設 key → 印「⚠ 未設…改用 demo」、earnings fetched 8 家。⚠ **線上 GitHub secret 是否已設待 Ball 確認**（未設則線上也走 demo）
- **P2-4**（git 維運）：main 於 2026-06-11 歷史重建後失去 upstream tracking，已 `--set-upstream-to=origin/main` + rebase 追平遠端 34 筆 bot commit；`git status -sb` 恢復顯示 `## main...origin/main`

---

## 2026-06-26（移除臨時 `_finmind_diag` 診斷欄位）

**Request：** root cause 已取得證據，移除臨時診斷欄位

**Fix (Opus)：** 移除 `fetch_taifex.py` 的 `_finmind_diag` 探測區塊與 result 欄位
- 背景：06-23 加此欄位直證「Actions 連 FinMind」狀態（log 需 auth 看不到）。線上已收到證據 —— 最後一次（手動觸發）`_finmind_diag = {ok:true, status:200, rows:119, elapsed:0.5}`，即 Actions 環境**能**連到 FinMind。故原「硬失敗」更像**間歇性**，且 TX 已改走 TAIFEX 不再依賴 FinMind，診斷任務完成 → 拔除
- 改動：刪 main() 內探測區塊（urlopen FinMind + finmind_diag 組裝/print）＋ result dict 的 `"_finmind_diag"` 鍵；前端 app.js 未讀此欄位，無需動
- **實證（前後對照）：** before＝線上 JSON 頂層含 `_finmind_diag`（11 keys）；本機實跑 `python fetch_taifex.py`（真實抓取，date=20260626 全區塊正常產出）後，新 JSON 頂層 keys 不含 `_finmind_diag`、`update_log`/`earnings` 等其餘 10 欄完整保留；`grep finmind_diag` 全檔 0 筆殘留；`py_compile` 通過
- 註：尚未 push；待 Ball 確認後上線（cache-buster 無需 bump，純後端）

---

## 2026-06-26（GitHub 連結改密碼門遮擋）

**Request：** GitHub 連結不想給訪客看，做個簡單密碼視窗（密碼 11111111）

**Feat (Opus)：** 更新紀錄彈窗加「管理」密碼門
- 「管理」入口 → 輸 11111111 → 顯示 GitHub 連結；sessionStorage 記住本工作階段
- **限制**：靜態公開站 + 公開 repo，密碼明文於原始碼可被繞過，僅「視覺遮擋一般訪客」、非真正安全（Ball 已知悉，只要簡單擋住）
- app.js cache-buster 20260626→20260626b
- 註：此功能首次提交因工具輸出異常未成功（誤判已上線），實際於 commit 6488ec5 才真正 push

---

## 2026-06-26（更新紀錄監控 + 下午排程）

**Request：** 常八點多才更新（下午早排程沒觸發）；加機制檢查觸發是否成功、網頁顯示每次定期/手動更新狀況；排程加 4:30 前後

**Feat (Opus)：** 網頁「更新紀錄」彈窗 + 後端 `update_log`
- main() 每次執行 append 一筆（時間、觸發方式、三大法人/期貨/TX 抓到的日期），保留最近 12 筆；workflow 傳入 `github.event_name` 區分「定期/手動」
- 前端「更新紀錄 ▸」彈窗：列最近 12 次，綠=已更新到最新交易日、灰=仍為舊資料，附 GitHub Actions 連結 → 不進 GitHub 就能監控每次觸發是否正確更新
- 修：update_log 日期統一 YYYY-MM-DD（institute/date 原 YYYYMMDD、tx/nq 為 YYYY-MM-DD，混用會排序/顯示錯亂——驗證時發現）

**Feat (Opus)：** workflow 加 `33 8 * * 1-5`（16:33 TWN）排程
- 下午三大法人/期貨出爐後首抓；GitHub 早時段能否準時觸發以「更新紀錄」觀察，再決定是否上外部 cron（治本備案）
- 避開整點；app.js cache-buster 20260615→20260626
- 註：update_log 於下次 Actions 執行後才開始累積，首次彈窗可能僅少數筆

---

## 2026-06-23（行事曆改繁體中文）

**Request：** 行事曆 widget 想用繁體中文

**Feat (Opus)：** investing.com 行事曆 widget `lang=1`(英文) → `lang=55`(繁體中文)
- lang=55 取自 hk.investing.com（investing 繁中站）的 widget 生成器；timeZone=113 不變
- 註：investing 內容端的繁中翻譯可能不完整，冷門事件或仍顯示英文（非本站可控）

---

## 2026-06-23（TX 波動換資料源 FinMind→TAIFEX 根治停更 + root cause 診斷）

**Request：** TX 又停更（6-21 加的重試沒救回）；先應急、再根治(A)、root cause 也查清楚

**確認 root cause（證據鏈）：** 線上只有 TX 停在 6/18，其他區塊(TWSE/Yahoo 源)更新到 6/22~6/23；Actions 6/22 跑 5 次皆 success 但 TX 未動；本機 fetch_tx_ohlc 正常到 6/23、FinMind 有完整資料、我 6-21 的「剔除不完整日」非元兇 → 確認 **Actions 環境連 FinMind 硬失敗**（非偶發，重試無效）。main() 裡唯一靠 FinMind 的就是 TX，故只有它停。

**Fix (Opus)：** `fetch_tx_ohlc` 資料源 FinMind → TAIFEX 官方（A 案，根治）
- 改用 `www.taifex.com.tw/cht/3/futDataDown`（Actions 已驗證可連，同 scrape_taifex_web 網域）
- CSV「交易時段」一般=日盤、盤後=夜盤；沿用兩項既有修正（單一主力合約、日夜盤皆到齊才算完整日）
- futDataDown 單次約 22 天上限 → 分批（每批20天往前數批）拼接覆蓋 25 交易日
- **實證：** 近25日(5/19~6/23) 逐日 H/L 與原 FinMind 版 **8/8 完全一致**；函數簽名不變，main/fetch_nq_only 無需改
- 應急：先本機補 TX 至 6/23 上線（38610eb）

**Fix (Opus)：** 加臨時 `_finmind_diag` 診斷欄位（root cause 直證用）
- Actions log 需 auth 無法下載；改在 main() 探測一次 FinMind 連線，結果(ok/status/error/elapsed)寫入 JSON
- 下次 Actions 跑後讀線上 `_finmind_diag` 即可確認 Actions 上 FinMind 的確切錯誤（timeout/403/連線拒絕…），**確認後移除此欄位**

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
