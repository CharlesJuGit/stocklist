# stockweb — 台指期籌碼儀表板

即時顯示台指期三大法人籌碼、選擇權未平倉、散戶期貨淨部位、結算比、波動分析、籌碼綜合評估。
資料由 GitHub Actions 每日自動抓取並更新至 `taifex_data.json`。

網址：https://charlesjugit.github.io/stocklist/

---

## 專案結構

```
stockweb/
├── index.html              # 主頁面（Tailwind CSS）
├── app.js                  # 前端邏輯（原生 JS）
├── fetch_taifex.py         # 後端資料抓取（GitHub Actions 執行）
├── taifex_data.json        # 抓取結果（由 CI 自動更新）
├── favicon.png             # 瀏覽器分頁圖示（32x32）
├── apple-touch-icon.png    # Safari/iOS 主畫面圖示（180x180）
└── .github/workflows/
    └── fetch-taifex.yml    # 每日 9:00 UTC 自動執行
```

---

## 資料區塊說明

### 三大法人（institute）
外資、投信、自營商的買賣超（億元），資料來源：TAIFEX 網站

### 台指期貨（futures）
- 外資台指期淨口數（TX + MTX/4）
- 散戶期貨淨部位：小台（MTX）＋微台（TMF ÷5）合計，以偏多/偏空標示

### 選擇權（options）
- 外資 CALL/PUT 未平倉買口（BC/SC/BP/SP）
- 外資策略判斷：雙買 / 雙賣 / 看多（Bullish）/ 看空（Bearish）/ 中性
  - threshold = 1000 口
- P/C Ratio = (BP+SP)/(BC+SC)：>1.2=偏空恐慌 / <0.8=偏多追漲

### 結算比
- 公式：`pressure = abs(外資期貨淨口) + bp_add`
  - opt_net(BP-SP) ≥ 10000：bp_add = BP（全額）
  - opt_net > 5000：bp_add = BP × 0.8
  - 否則：bp_add = 0
- 除以剩餘交易日數，得每日需結清口數
- 近20天趨勢可彈窗查看

### 波動分析
- **台指期（TX）**：FinMind TaiwanFuturesDaily，日盤+夜盤合併，顯示最新資料日期
- **Nasdaq 期貨（NQ）**：Yahoo Finance 1h bar，台灣時間 5AM 為日分界，週五含至週一 5AM
- 分類：低/小/中/大/高（vs 20日均值）
- 近20天歷史可彈窗查看

### 散戶期貨淨部位
- 小台（MTX）＋微台（TMF ÷5）合計（小台當量）
- 偏多/偏空標示
- 近20天歷史彈窗（從 `settlement_history.retail_total` 讀取）

### 外資選擇權策略（近20天）
- 每日策略存入 `settlement_history.opt_strategy`
- 彈窗顯示近20天策略變化，各策略色碼區分

### 上市+上櫃成交量
- TWSE：`www.twse.com.tw/rwd/zh/afterTrading/FMTQIK`（rwd 端點，避免 SSL 問題）
- TPEx：`www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex`
- 單位：億元，顯示前一日，近20天歷史可彈窗查看

### 瀏覽人次
- GoatCounter 追蹤（`charlesju.goatcounter.com`）
- 顯示於頁面底部 Buy Me a Coffee 按鈕上方
- 統計後台：charlesju.goatcounter.com

### 籌碼綜合評估
加權評分（滿分 16）：

| 項目 | 權重 |
|------|------|
| 外資現貨 | ×2 |
| 外資期貨 | ×2 |
| 結算比方向 | ×2 |
| P/C Ratio | ×1 |
| 選擇權策略方向 | ×1 |
| 投信 | ×1 |

> ≥12=強多 / 10-11=偏多 / 6-9=中性 / 4-5=偏空 / ≤3=強空

---

## 資料更新機制

| 時間 TWN | UTC cron | workflow | 內容 |
|---------|----------|----------|------|
| 06:30 AM | `30 22 * * 0-4` | `update-nq.yml` | NQ OHLC only（NQ 收盤後）|
| 17:00 PM | `0 9 * * 1-5` | `fetch-taifex.yml` | 全部資料 |
| 18:00 PM | `0 10 * * 1-5` | `fetch-taifex.yml` | 全部資料（補抓期貨/選擇權）|
| 20:00 PM | `0 12 * * 1-5` | `fetch-taifex.yml` | 全部資料（最終確認）|

- 可手動觸發：點擊頁面「觸發更新」按鈕（workflow_dispatch）
- Push 衝突處理：`git pull --rebase -X theirs`（Actions 新資料優先）

### NQ 高低點時間定義

- 日分界：台灣時間 **6:00 AM**（夏令 = 5PM EDT / 冬令 = 5PM EST，均為 NQ 收盤後）
- 每日涵蓋：`06:00 TWN` → 隔日 `05:59 TWN`
- 週五特例：含整個週末到週一 05:59 TWN

### TX 高低點時間定義

- 來源：FinMind `after_market`（夜盤）+ `position`（日盤）合併
- 起點：**15:00 TWN**（夜盤開）
- 終點：**13:45 TWN 隔日**（日盤收）
- 與 XQ 定義一致

---

## 資料來源

| 資料 | 來源 |
|------|------|
| 三大法人買賣超 | 台灣證交所 / TWSE Open API |
| 期貨/選擇權籌碼 | TAIFEX 官網（scrape） |
| TX OHLC | FinMind TaiwanFuturesDaily |
| NQ OHLC | Yahoo Finance（1h bar）|
| 上市成交量 | TWSE Open API |
| 上櫃成交量 | TPEx afterTrading tradingIndex |
