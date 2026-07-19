let currentStockId = null;
let chipCache = {};

// 載入股票清單
async function loadStocks() {
  const res = await fetch('stocks.json');
  const data = await res.json();

  window.STOCKS_BY_ID = window.STOCKS_BY_ID || {};   // 合併不清空（refreshAll 時保留自選股的 mkt 註冊）
  [...(data.long || []), ...(data.short || [])].forEach(s => { STOCKS_BY_ID[s.id] = s; });
  renderList('long-list', data.long, 'red');
  renderList('short-list', data.short, 'green');
  if (data.updated) {
    document.getElementById('stocks-updated').textContent =
      `推薦清單更新：${data.updated}`;
  }
}

function renderList(containerId, stocks, color) {
  const container = document.getElementById(containerId);
  container.innerHTML = stocks.map(s => `
    <button onclick="openModal('${s.id}', '${s.name}')"
      class="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-lg px-4 py-3 transition flex items-center justify-between gap-2">
      <span><span class="font-bold text-${color}-400">${s.id}</span><span class="ml-2 text-${color}-400">${s.name}</span></span>
      <span data-chg="${s.id}" class="text-xs text-gray-500 whitespace-nowrap">${_chgCell(s.id)}</span>
    </button>
  `).join('');
}

// 開啟詳細面板
function openModal(id, name) {
  currentStockId = id;
  document.getElementById('modal-title').textContent = `${id} ${name}`;
  document.getElementById('modal').classList.remove('hidden');
  ['modal-price', 'chip-verdict', 'modal-meta', 'modal-links'].forEach(x => {
    const el = document.getElementById(x); if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
  });
  switchTab('1d');           // 既有法人表
  const pricePromise = loadModalPrice(id);   // ② 價格/走勢（獨立 try，失敗隱藏）
  loadChipVerdict(id);       // ① 籌碼白話
  renderStockMeta(id);       // ③ 基本資料
  loadDividendInfo(id, pricePromise);  // ③b 殖利率/除息日（P2-20；等價格到齊才能反推上市股利金額）
  renderStockLinks(id);      // ④ 外部連結
}

// ── P2-10 個股彈窗加強（隱私：只公開市場資料，無策略字眼）─────────────
// ① 籌碼白話解讀（純函式，依序判定首中即用；只描述不建議）
function chipVerdict(rows) {
  if (!rows || !rows.length) return null;
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const f = sum('foreign'), t = sum('trust'), total = f + t + sum('dealer');
  const badge = total > 500 ? { t: '偏多', c: 'text-red-400' }
    : total < -500 ? { t: '偏空', c: 'text-green-400' } : { t: '中性', c: 'text-gray-400' };
  let streak = 0, streakSum = 0; const dir = Math.sign(rows[0].foreign);
  for (const r of rows) { if (dir !== 0 && Math.sign(r.foreign) === dir) { streak++; streakSum += r.foreign; } else break; }
  let text;
  if (f > 0 && t > 0 && (f + t) >= 500) text = `外資投信同步買超（外 ${fmt(f)}張／投 ${fmt(t)}張），籌碼偏多`;
  else if (f < 0 && t < 0 && (Math.abs(f) + Math.abs(t)) >= 500) text = `外資投信同步賣超，籌碼偏空`;
  else if (Math.abs(f) >= 500 && Math.abs(t) >= 500) text = `外資投信對作（外 ${fmt(f)}／投 ${fmt(t)}），籌碼分歧`;
  else if (streak >= 3) text = `外資連 ${streak} 日${dir > 0 ? '買超' : '賣超'}累計 ${fmt(streakSum)}張`;
  else text = `法人動向不明顯（5日合計 ${fmt(total)}張）`;
  return { text, badge };
}

async function loadChipVerdict(id) {
  const box = document.getElementById('chip-verdict');
  try {
    const rows = [];
    for (const date of getRecentTradingDates(7)) {
      if (rows.length >= 5) break;
      const data = await fetchT86(date);
      if (!data) continue;
      const row = data.find(r => r[0] === id);
      if (row) rows.push(parseStockRow(row));
    }
    const v = chipVerdict(rows);
    if (!v) return;
    box.innerHTML = `${v.text}　<span class="${v.badge.c} font-bold">[${v.badge.t}]</span>`;
    box.classList.remove('hidden');
  } catch (e) { /* 靜默 */ }
}

// ② 價格＋20日位階＋迷你走勢（經現有 CF Worker /yahoo，失敗整塊隱藏、不影響法人表）
function _sparkline(closes, w = 460, h = 40) {
  const v = closes.filter(x => x != null);
  if (v.length < 2) return '';
  const mn = Math.min(...v), mx = Math.max(...v), rng = mx - mn || 1;
  const pts = v.map((c, i) => `${(w * i / (v.length - 1)).toFixed(1)},${(h - 2 - (c - mn) / rng * (h - 4)).toFixed(1)}`).join(' ');
  const up = v[v.length - 1] >= v[0];
  return `<svg viewBox="0 0 ${w} ${h}" height="${h}" class="w-full mt-1" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${up ? '#f87171' : '#4ade80'}" stroke-width="1.5"/></svg>`;
}
// ── P2-14/P2-15 漲跌幅共用計算（彈窗與清單只寫一份，避免定義分岔）──────────
// 台灣日期字串 YYYY-MM-DD（epoch 秒）
function _twDate(sec) { return new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); }
// 輸入 Yahoo chart result[0]，輸出 {price, chgDay, chgWeek}（算不出的欄為 null）
function calcChanges(res) {
  const price = res && res.meta ? res.meta.regularMarketPrice : null;
  const closeArr = (res && res.indicators && res.indicators.quote[0].close) || [];
  const tsArr = (res && res.timestamp) || [];
  const pts = [];   // timestamp 與 close 成對過濾（同索引），否則日期對位錯亂；順帶濾零價
  for (let i = 0; i < closeArr.length; i++) {
    if (closeArr[i] != null && closeArr[i] > 0 && tsArr[i] != null) pts.push({ t: tsArr[i], c: closeArr[i] });
  }
  if (price == null || pts.length < 2) return { price, chgDay: null, chgWeek: null, chgMonth: null, pts: [] };
  // 本日：前一日收盤＝倒數第二筆有效 close（禁用 meta.chartPreviousClose＝範圍起點前收盤，非昨收）
  const prevClose = pts[pts.length - 2].c;
  const chgDay = prevClose ? (price - prevClose) / prevClose * 100 : null;
  // 本週：基準＝台灣本週一 00:00 之前最後一筆有效收盤（＝上週五收盤，自動涵蓋週五假日/連假）
  const nowTw = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const mon = new Date(nowTw); mon.setDate(nowTw.getDate() - ((nowTw.getDay() + 6) % 7));
  const monStr = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
  let weekBase = null;
  for (const p of pts) { if (_twDate(p.t) < monStr) weekBase = p.c; }
  const chgWeek = weekBase ? (price - weekBase) / weekBase * 100 : null;
  // 本月（P2-20 §1）：基準＝台灣本月 1 日 00:00 之前最後一筆有效收盤（＝上月最後交易日收盤，
  // 同「上週五收盤」句式，自動涵蓋月底假日/連假）。需 range=3mo 才抓得到上月底（月初時 1mo 抓不滿）。
  const firstStr = `${nowTw.getFullYear()}-${String(nowTw.getMonth() + 1).padStart(2, '0')}-01`;
  let monthBase = null;
  for (const p of pts) { if (_twDate(p.t) < firstStr) monthBase = p.c; }
  const chgMonth = monthBase ? (price - monthBase) / monthBase * 100 : null;
  return { price, chgDay, chgWeek, chgMonth, pts };
}

async function loadModalPrice(id) {
  const box = document.getElementById('modal-price');
  if (typeof INDEX_PROXY === 'undefined' || !INDEX_PROXY) return;
  const m = STOCKS_BY_ID[id] || {};
  const suf = m.mkt === 'tpex' ? '.TWO' : '.TW';
  // P2-20 §1：range 1mo→3mo（月初時 1mo 抓不滿上月底＝算不出本月%）
  const tryFetch = async s => (await idxFetch(`/yahoo/${id}${s}?range=3mo&interval=1d`)).chart.result[0];
  try {
    let res;
    try { res = await tryFetch(suf); }
    catch (e) { res = await tryFetch(suf === '.TW' ? '.TWO' : '.TW'); }  // mkt 缺失 fallback
    const { price, chgDay, chgWeek, chgMonth, pts } = calcChanges(res);
    priceCache[id] = { price, chgDay, chgWeek, chgMonth };   // 彈窗抓到順便餵清單快取（同股不重打）
    const closes = (res.indicators.quote[0].close || []).filter(x => x != null && x > 0);
    if (price == null || !closes.length) return;
    const l20 = closes.slice(-20), hi = Math.max(...l20), lo = Math.min(...l20);
    const pos = hi > lo ? (price - lo) / (hi - lo) * 100 : null;
    const dc = chgDay == null ? '' : `<span class="${chgDay >= 0 ? 'text-red-400' : 'text-green-400'} text-sm ml-1">${chgDay >= 0 ? '+' : ''}${chgDay.toFixed(2)}%</span>`;
    const wc = chgWeek == null ? '' : `<span class="${chgWeek >= 0 ? 'text-red-400' : 'text-green-400'} text-xs ml-2">本週 ${chgWeek >= 0 ? '+' : ''}${chgWeek.toFixed(2)}%</span>`;
    const mc = chgMonth == null ? '' : `<span class="${chgMonth >= 0 ? 'text-red-400' : 'text-green-400'} text-xs ml-2">本月 ${chgMonth >= 0 ? '+' : ''}${chgMonth.toFixed(2)}%</span>`;
    // sparkline 口徑不變（P2-20 §1 紅線）：range 改 3mo 後只取「近 31 天」序列尾段，
    // 重現改版前 range=1mo 的視覺範圍；位階仍取 closes.slice(-20)＝與改版前同一組數（天然零回歸）
    const cutTs = Math.floor(Date.now() / 1000) - 31 * 86400;
    const sparkCloses = pts.filter(p => p.t >= cutTs).map(p => p.c);
    box.innerHTML = `<div class="flex items-center justify-between">
        <div><span class="text-lg font-bold">${idxNum(price)}</span>${dc}${wc}${mc}</div>
        <div class="text-xs text-gray-400">位階 ${pos == null ? '—' : pos.toFixed(0) + '%'}（20日高 ${idxNum(hi)}／低 ${idxNum(lo)}）</div>
      </div>${_sparkline(sparkCloses.length ? sparkCloses : closes)}`;
    box.classList.remove('hidden');
  } catch (e) { /* 整塊隱藏 */ }
}

// ── P2-14 §3 清單漸進式漲跌幅（多頭/空頭/自選三表通用，批次節流）───────────
const priceCache = {};   // id → {price, chgDay, chgWeek}，session 內共用、同股只抓一次
const LIST_PRICE_BATCH = 6, LIST_PRICE_GAP_MS = 300;   // 每批 6 支、批次間隔 300ms（可調）
function _chgHtml(c) {
  if (!c) return '<span class="text-gray-600">—</span>';
  const seg = (label, v) => v == null ? '' :
    `<span class="${v > 0 ? 'text-red-400' : v < 0 ? 'text-green-400' : 'text-gray-400'}">${label} ${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  const parts = [seg('本日', c.chgDay), seg('本週', c.chgWeek)].filter(Boolean);
  return parts.length ? parts.join('　') : '<span class="text-gray-600">—</span>';
}
function _chgCell(id) { return priceCache[id] ? _chgHtml(priceCache[id]) : '···'; }   // 初次/重繪：有快取先填，否則佔位
async function _fetchChanges(id, mkt) {
  if (priceCache[id]) return priceCache[id];
  const suf = mkt === 'tpex' ? '.TWO' : '.TW';
  const tryFetch = async s => (await idxFetch(`/yahoo/${id}${s}?range=1mo&interval=1d`)).chart.result[0];
  let res;
  try { res = await tryFetch(suf); }
  catch (e) { res = await tryFetch(suf === '.TW' ? '.TWO' : '.TW'); }
  return (priceCache[id] = calcChanges(res));
}
function _updateChgCells(id, html) {
  document.querySelectorAll(`[data-chg="${id}"]`).forEach(el => { el.innerHTML = html; });
}
// 掃三份清單可見的 data-chg 股號（去重），分批補上漲跌幅；快取命中不重打、首屏不受影響
async function loadListChanges() {
  if (typeof INDEX_PROXY === 'undefined' || !INDEX_PROXY) return;
  const ids = [...new Set([...document.querySelectorAll('[data-chg]')].map(el => el.getAttribute('data-chg')))];
  for (let i = 0; i < ids.length; i += LIST_PRICE_BATCH) {
    const batch = ids.slice(i, i + LIST_PRICE_BATCH);
    await Promise.all(batch.map(async id => {
      try { _updateChgCells(id, _chgHtml(await _fetchChanges(id, (STOCKS_BY_ID[id] || {}).mkt))); }
      catch (e) { _updateChgCells(id, _chgHtml(null)); }   // 失敗顯示 —，不擋該列點擊
    }));
    if (i + LIST_PRICE_BATCH < ids.length) await new Promise(r => setTimeout(r, LIST_PRICE_GAP_MS));
  }
}

// ③ 基本資料（讀 stocks.json 擴欄；缺欄顯示—；大戶只給水位）
function renderStockMeta(id) {
  const box = document.getElementById('modal-meta');
  const m = STOCKS_BY_ID[id];
  if (!m) return;
  const mktName = m.mkt === 'tpex' ? '上櫃' : m.mkt === 'twse' ? '上市' : '';
  const r = [];
  if (m.ind) r.push(`<div><span class="text-gray-500">產業：</span>${m.ind}${mktName ? `（${mktName}）` : ''}</div>`);
  if (m.rev != null) {
    const yc = (m.rev_yoy >= 0) ? 'text-red-400' : 'text-green-400';
    r.push(`<div><span class="text-gray-500">月營收：</span>${m.rev_m}　${m.rev} 億${m.rev_yoy != null ? `　<span class="${yc}">YoY ${m.rev_yoy >= 0 ? '+' : ''}${m.rev_yoy}%</span>` : ''}</div>`);
  }
  if (m.eps != null) r.push(`<div><span class="text-gray-500">EPS：</span>${m.eps_q}　${m.eps} 元</div>`);
  if (m.big400 != null) r.push(`<div><span class="text-gray-500">400張大戶：</span>${m.big400}%${m.big400_w ? `（${m.big400_w.slice(5)} 週）` : ''}</div>`);
  if (!r.length) return;
  box.innerHTML = r.join('');
  box.classList.remove('hidden');
}

// ── P2-20 §2 殖利率／除息日（官方 openapi 經 CF Worker；四表皆無 CORS，直打必失敗）──
// 四表都是「日更全表」：session 內抓一次全表→依股號 lookup，**上市/上櫃/自選股全蓋**，
// 不依賴 stocks.json（自選股不在清單裡也查得到）。
let _divCache = null, _divPromise = null;
async function loadDivTables() {
  if (_divCache) return _divCache;
  if (_divPromise) return _divPromise;
  _divPromise = (async () => {
    // 🔴 分流（2026-07-19 兩次實測）：**TPEx 擋 Cloudflare 出口 IP**（經 CF Worker 一律 302 導 /errors，
    // 帶完整瀏覽器標頭仍被擋）→ TPEx 兩表走 Val Town（非 CF egress）；TWSE 兩表經 CF Worker 正常，維持不動。
    const getCF = async k => { try { return await idxFetch(`/div/${k}`); } catch (e) { return []; } };
    const getVT = async k => {
      try {
        if (typeof TAIFEX_PROXY === 'undefined' || !TAIFEX_PROXY) return [];
        const r = await fetch(`${TAIFEX_PROXY}/div/${k}`);
        return r.ok ? await r.json() : [];
      } catch (e) { return []; }
    };
    const [ty, py, te, pe] = await Promise.all(
      [getCF('twse-yield'), getVT('tpex-yield'), getCF('twse-exdiv'), getVT('tpex-exdiv')]);
    const yield_ = {}, exdiv = {};
    // 上市殖利率：Code / DividendYield（%）
    for (const r of ty || []) if (r.Code) yield_[r.Code] = { y: parseFloat(r.DividendYield) };
    // 上櫃殖利率：SecuritiesCompanyCode / YieldRatio（%）＋ DividendPerShare（元）
    for (const r of py || []) if (r.SecuritiesCompanyCode)
      yield_[r.SecuritiesCompanyCode] = { y: parseFloat(r.YieldRatio), dps: parseFloat(r.DividendPerShare) };
    // 除權息預告（民國日期）：上市 Date/Exdividend（息|權）、上櫃 ExRrightsExDividendDate/ExRrightsExDividend（除息|除權）
    for (const r of te || []) if (r.Code) exdiv[r.Code] = { d: _rocToAd(r.Date), kind: r.Exdividend };
    for (const r of pe || []) if (r.SecuritiesCompanyCode)
      exdiv[r.SecuritiesCompanyCode] = { d: _rocToAd(r.ExRrightsExDividendDate), kind: r.ExRrightsExDividend };
    return (_divCache = { yield_, exdiv });
  })();
  return _divPromise;
}
// 把殖利率/除息日補進基本資料區（獨立於 stocks.json → 自選股也蓋得到）
async function loadDividendInfo(id, pricePromise) {
  const box = document.getElementById('modal-meta');
  if (!box || typeof INDEX_PROXY === 'undefined' || !INDEX_PROXY) return;
  try {
    const [{ yield_, exdiv }] = await Promise.all([
      loadDivTables(),
      Promise.resolve(pricePromise).catch(() => null),   // 價格失敗不擋殖利率顯示
    ]);
    // 競態守衛：連點兩支股票時，前一支的非同步結果不得 append 進後一支的彈窗
    // （openModal 開啟時已清空 modal-meta，故只需擋「回來時已換股」這種情況）
    if (currentStockId !== id) return;
    // Worker 尚未部署 /div 路由（或四表全掛）→ 整區不渲染，而不是每支股票都顯示兩個「—」（那看起來像壞掉）
    if (!Object.keys(yield_).length && !Object.keys(exdiv).length) return;
    const y = yield_[id], e = exdiv[id];
    // 股利金額：上櫃有官方 DividendPerShare 直接用；上市（BWIBBU 無金額欄）以「現價 × 殖利率」反推、標「約」。
    // 口徑：TWSE/TPEx 的殖利率皆為「近四季(年度)現金股利 ÷ 收盤價」——2330 實證 近四季 22.00 元 ÷ 2290 = 0.96% ✅；
    // 反推公式對 5 支上櫃股（同時有官方金額）驗證誤差 ±0.16% 內。⚠ 盤中現價與官方計算基準日收盤不同會有小差，故標「約」。
    let dpsTxt = '';
    if (y && isFinite(y.y) && y.y > 0) {
      if (isFinite(y.dps) && y.dps > 0) {
        dpsTxt = `（年配息 ${(+y.dps).toFixed(2)} 元）`;
      } else {
        const px = (priceCache[id] || {}).price;
        if (px > 0) dpsTxt = `（年配息約 ${(px * y.y / 100).toFixed(2)} 元）`;
      }
    }
    const yTxt = (y && isFinite(y.y)) ? `${y.y.toFixed(2)}%${dpsTxt}` : '—';
    const eTxt = (e && e.d) ? `${String(e.kind || '').includes('權') && !String(e.kind || '').includes('息') ? '除權' : '除息'} ${e.d}` : '—';
    const rows =
      `<div><span class="text-gray-500">殖利率：</span>${yTxt}</div>` +
      `<div title="僅顯示已公告且尚未除權息之股票，多數股票平常為 —"><span class="text-gray-500">除息日：</span>${eTxt}</div>`;
    box.insertAdjacentHTML('beforeend', rows);
    box.classList.remove('hidden');
  } catch (err) { /* 靜默：不影響彈窗其他區塊 */ }
}

// 民國 1150731 → 2026-07-31（前 3 碼為民國年）
function _rocToAd(s) {
  const t = String(s || '').trim();
  if (!/^\d{7}$/.test(t)) return null;
  return `${Number(t.slice(0, 3)) + 1911}-${t.slice(3, 5)}-${t.slice(5, 7)}`;
}

// ④ 外部連結（跳站外，無資料抓取）
function renderStockLinks(id) {
  const box = document.getElementById('modal-links');
  const m = STOCKS_BY_ID[id] || {};
  const suf = m.mkt === 'tpex' ? '.TWO' : '.TW';
  const links = [
    ['Yahoo股市', `https://tw.stock.yahoo.com/quote/${id}${suf}`],
    ['Goodinfo', `https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID=${id}`],
    ['財報狗', `https://statementdog.com/analysis/${id}`],
  ];
  box.innerHTML = links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener" class="text-blue-400 hover:text-blue-300 text-xs underline">${t} ↗</a>`).join('');
  box.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// 切換 tab
async function switchTab(tab) {
  document.getElementById('tab-1d').className = tab === '1d'
    ? 'px-3 py-1 rounded text-sm bg-blue-600 text-white'
    : 'px-3 py-1 rounded text-sm bg-gray-700 text-white';
  document.getElementById('tab-5d').className = tab === '5d'
    ? 'px-3 py-1 rounded text-sm bg-blue-600 text-white'
    : 'px-3 py-1 rounded text-sm bg-gray-700 text-white';

  document.getElementById('chip-1d').classList.add('hidden');
  document.getElementById('chip-5d').classList.add('hidden');
  document.getElementById('chip-loading').classList.remove('hidden');

  await loadChipData(currentStockId, tab);

  document.getElementById('chip-loading').classList.add('hidden');
  document.getElementById(`chip-${tab}`).classList.remove('hidden');
}

// 從 TWSE T86 抓單日個股三大法人，回傳 {date, foreign, trust, dealer} 或 null
const t86Cache = {};
async function fetchT86(date) {
  if (t86Cache[date]) return t86Cache[date];
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.data || json.data.length === 0) return null;
  t86Cache[date] = json.data;
  return json.data;
}

// 從 T86 資料列取得個股數值
// T86 欄位：[4]外陸資買賣超(不含外資自營商) [7]外資自營商買賣超 [10]投信買賣超 [11]自營商買賣超 [18]三大法人合計
function parseStockRow(row) {
  const v = (i) => parseInt(row[i].replace(/,/g, '')) || 0;
  const lot = s => Math.round(s / 1000);   // P2-12：T86 原始為「股數」，轉「張」(1張=1000股)；先加總再除避免逐項捨入漂移
  return {
    foreign: lot(v(4) + v(7)),   // 完整外資（含外資自營商），與市場層三大法人口徑一致
    trust:   lot(v(10)),          // 投信買賣超（原誤用 row[7]=外資自營商，恆為相異值）
    dealer:  lot(v(11)),          // 自營商買賣超合計（原誤用 row[8]=投信「買進量」，非淨額）
  };
}

// 抓三大法人資料
async function loadChipData(stockId, tab) {
  const cacheKey = `${stockId}-${tab}`;
  if (chipCache[cacheKey]) {
    document.getElementById(`chip-${tab}`).innerHTML = chipCache[cacheKey];
    return;
  }

  try {
    const dates = getRecentTradingDates(7); // 多抓幾天以防假日
    const html = tab === '1d'
      ? await buildChip1d(stockId, dates)
      : await buildChip5d(stockId, dates);
    chipCache[cacheKey] = html;
    document.getElementById(`chip-${tab}`).innerHTML = html;
  } catch (e) {
    document.getElementById(`chip-${tab}`).innerHTML = '<p class="text-red-400 text-sm">資料載入失敗</p>';
  }
}

// 當日
async function buildChip1d(stockId, dates) {
  for (const date of dates) {
    const data = await fetchT86(date);
    if (!data) continue;
    const row = data.find(r => r[0] === stockId);
    if (!row) continue;
    const { foreign, trust, dealer } = parseStockRow(row);
    const total = foreign + trust + dealer;
    const fmt_date = date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    return `
      <table class="w-full text-sm">
        <thead><tr class="text-gray-400 border-b border-gray-700">
          <th class="text-left py-1">法人</th>
          <th class="text-right py-1">買賣超（張）</th>
        </tr></thead>
        <tbody>
          ${chipRow('外資', foreign)}
          ${chipRow('投信', trust)}
          ${chipRow('自營商', dealer)}
          <tr class="border-t border-gray-700 font-bold">
            <td class="py-1">主力合計</td>
            <td class="text-right py-1 ${total >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(total)}</td>
          </tr>
        </tbody>
      </table>
      <p class="text-xs text-gray-500 mt-2">資料日期：${fmt_date}</p>`;
  }
  return '<p class="text-gray-400 text-sm">查無資料</p>';
}

// 近5日
async function buildChip5d(stockId, dates) {
  const rows = [];
  for (const date of dates) {
    if (rows.length >= 5) break;
    const data = await fetchT86(date);
    if (!data) continue;
    const row = data.find(r => r[0] === stockId);
    if (!row) continue;
    const { foreign, trust, dealer } = parseStockRow(row);
    rows.push({ date, foreign, trust, dealer });
  }
  if (rows.length === 0) return '<p class="text-gray-400 text-sm">查無資料</p>';

  const totForeign = rows.reduce((s, r) => s + r.foreign, 0);
  const totTrust   = rows.reduce((s, r) => s + r.trust,   0);
  const totDealer  = rows.reduce((s, r) => s + r.dealer,  0);
  const totTotal   = totForeign + totTrust + totDealer;

  const dataRows = rows.map(r => {
    const total = r.foreign + r.trust + r.dealer;
    const fmt_date = r.date.replace(/(\d{4})(\d{2})(\d{2})/, '$2/$3');
    const c = total >= 0 ? 'text-red-400' : 'text-green-400';
    return `<tr class="border-b border-gray-800 text-xs">
      <td class="py-1 text-gray-400">${fmt_date}</td>
      <td class="text-right py-1 ${r.foreign >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(r.foreign)}</td>
      <td class="text-right py-1 ${r.trust   >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(r.trust)}</td>
      <td class="text-right py-1 ${r.dealer  >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(r.dealer)}</td>
      <td class="text-right py-1 font-bold ${c}">${fmt(total)}</td>
    </tr>`;
  }).join('');

  return `
    <table class="w-full text-xs">
      <thead><tr class="text-gray-400 border-b border-gray-700">
        <th class="text-left py-1">日期</th>
        <th class="text-right py-1">外資</th>
        <th class="text-right py-1">投信</th>
        <th class="text-right py-1">自營</th>
        <th class="text-right py-1">合計</th>
      </tr></thead>
      <tbody>${dataRows}</tbody>
      <tfoot><tr class="border-t border-gray-600 font-bold text-xs">
        <td class="py-1 text-gray-300">5日合計</td>
        <td class="text-right py-1 ${totForeign >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(totForeign)}</td>
        <td class="text-right py-1 ${totTrust   >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(totTrust)}</td>
        <td class="text-right py-1 ${totDealer  >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(totDealer)}</td>
        <td class="text-right py-1 ${totTotal   >= 0 ? 'text-red-400' : 'text-green-400'}">${fmt(totTotal)}</td>
      </tr></tfoot>
    </table>
    <p class="text-xs text-gray-500 mt-2">近 ${rows.length} 個交易日</p>`;
}

function chipRow(label, val) {
  // 台股慣例：買超紅、賣超綠（原為反色，與同表合計列、5日表不一致）
  const color = val >= 0 ? 'text-red-400' : 'text-green-400';
  return `<tr><td class="py-1 text-gray-300">${label}</td><td class="text-right py-1 ${color}">${fmt(val)}</td></tr>`;
}

function fmt(n) {
  return (n >= 0 ? '+' : '') + n.toLocaleString();
}

// 點擊背景關閉
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ── 市場資訊面板 ──────────────────────────────────────

// 取得最近 N 個交易日的日期字串（YYYYMMDD），跳過週末
function getRecentTradingDates(n = 5) {
  const dates = [];
  const d = new Date();
  while (dates.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}${m}${day}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

async function loadMarketInfo() {
  await Promise.all([
    loadInstitutes(),
    loadOptions(),
    loadFutures(),
    loadVolatility(),
    loadBasis(),
    loadMarketVolume(),
    loadEarnings(),
  ]);
  await loadSignalSummary();
}

// ── 上市櫃成交量 ──────────────────────────────────────────────

async function loadMarketVolume() {
  try {
    const data = await loadTaifexJson();
    const hist = data?.market_volume;
    if (!hist || !hist.length) return;
    const last = hist[hist.length - 1];
    // 單邊缺值（後端沉默回 0，如某日上市尚未出爐）顯示「—」，合計只加已到的一邊，不撒謊
    const twseOk = last.twse > 0, tpexOk = last.tpex > 0;
    document.getElementById('vol-twse').textContent  = twseOk ? last.twse.toLocaleString() : '—';
    document.getElementById('vol-tpex').textContent  = tpexOk ? last.tpex.toLocaleString() : '—';
    document.getElementById('vol-total').textContent =
      (twseOk && tpexOk) ? (last.total?.toLocaleString() ?? '--')
      : (twseOk || tpexOk) ? ((twseOk ? last.twse : 0) + (tpexOk ? last.tpex : 0)).toLocaleString()
      : '--';
    document.getElementById('vol-date').textContent  = last.date ?? '';
  } catch (e) { console.error('loadMarketVolume:', e); }
}

// ── 台指期正價差 ──────────────────────────────────────────────

const basisColor = v => (v == null ? 'text-gray-500' : v < 0 ? 'text-green-400' : 'text-red-400');
const basisTxt   = v => (v == null ? '—' : (v > 0 ? '+' : '') + v);

async function loadBasis() {
  try {
    const data = await loadTaifexJson();
    const b = data?.basis;
    if (!b || !b.curve || !b.curve.length) return;
    const near = b.curve[0], next = b.curve[1];
    document.getElementById('basis-near-m').textContent = near ? ` ${near.label}` : '';
    document.getElementById('basis-near').textContent = near ? basisTxt(near.basis) : '--';
    document.getElementById('basis-near').className = 'text-xl font-bold ' + basisColor(near?.basis);
    document.getElementById('basis-next-m').textContent = next ? ` ${next.label}` : '';
    document.getElementById('basis-next').textContent = next ? basisTxt(next.basis) : '--';
    document.getElementById('basis-next').className = 'text-lg font-bold ' + basisColor(next?.basis);
    document.getElementById('basis-date').textContent = b.date ?? '';
  } catch (e) { console.error('loadBasis:', e); }
}

// 期限結構曲線 SVG（由 curve 陣列繪製，含正/逆分界零線）
function basisCurveSVG(curve) {
  const w = 440, h = 170, pl = 40, pr = 14, pt = 24, pb = 30;
  const iw = w - pl - pr, ih = h - pt - pb;
  const vals = curve.map(c => c.basis);
  let vmax = Math.max(...vals, 0), vmin = Math.min(...vals, 0);
  const pad = (vmax - vmin) * 0.15 || 10; vmax += pad; vmin -= pad;
  const n = curve.length;
  const X = i => pl + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const Y = v => pt + ih * (1 - (v - vmin) / (vmax - vmin || 1));
  let s = `<svg width="100%" viewBox="0 0 ${w} ${h}" font-family="system-ui,sans-serif">`;
  if (vmin < 0 && vmax > 0)
    s += `<line x1="${pl}" y1="${Y(0).toFixed(1)}" x2="${w-pr}" y2="${Y(0).toFixed(1)}" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="4 3"/>`
       + `<text x="${w-pr}" y="${(Y(0)-3).toFixed(1)}" font-size="9" fill="#f59e0b" text-anchor="end">正/逆分界</text>`;
  const pts = curve.map((c, i) => `${X(i).toFixed(1)},${Y(c.basis).toFixed(1)}`).join(' ');
  if (n > 1) s += `<polyline points="${pts}" fill="none" stroke="#a78bfa" stroke-width="2.5"/>`;
  curve.forEach((c, i) => {
    s += `<circle cx="${X(i).toFixed(1)}" cy="${Y(c.basis).toFixed(1)}" r="4" fill="#a78bfa"/>`;
    s += `<text x="${X(i).toFixed(1)}" y="${(Y(c.basis)-9).toFixed(1)}" font-size="11" font-weight="700" fill="#e5e7eb" text-anchor="middle">${basisTxt(c.basis)}</text>`;
    s += `<text x="${X(i).toFixed(1)}" y="${h-pb+16}" font-size="10" fill="#9ca3af" text-anchor="middle">${c.label}</text>`;
  });
  s += `</svg>`;
  return s;
}

function openBasisModal() {
  loadTaifexJson().then(data => {
    const b = data?.basis;
    const body = document.getElementById('basis-modal-body');
    if (!b || !b.history?.length) { body.innerHTML = '<div class="text-gray-400">暫無資料</div>'; }
    else {
      const rows = [...b.history].reverse().map(r => {
        const cell = v => `<td class="px-1 py-1 text-right ${basisColor(v)}">${basisTxt(v)}</td>`;
        return `<tr class="border-b border-gray-800">
          <td class="px-1 py-1 text-gray-300">${r.date.slice(5)}</td>
          <td class="px-1 py-1 text-right text-gray-400">${r.spot.toLocaleString()}</td>
          ${cell(r.near)}${cell(r.next)}${cell(r.quarter)}</tr>`;
      }).join('');
      body.innerHTML = `
        <div class="text-xs text-gray-400 mb-1">期限結構（${b.date}）· 期貨收盤 − 加權指數</div>
        <div class="bg-gray-900 rounded-lg p-2 mb-3">${basisCurveSVG(b.curve)}</div>
        <table class="w-full">
          <thead><tr class="text-gray-500 border-b border-gray-700">
            <th class="px-1 py-1 text-left">日期</th><th class="px-1 py-1 text-right">現貨</th>
            <th class="px-1 py-1 text-right">近月</th><th class="px-1 py-1 text-right">次月</th>
            <th class="px-1 py-1 text-right">季月</th>
          </tr></thead><tbody>${rows}</tbody></table>
        <div class="text-[10px] text-gray-500 mt-2">紅=正價差(升水/偏多)、綠=逆價差；—＝該合約量薄不顯示。</div>`;
    }
    document.getElementById('basis-modal').classList.remove('hidden');
  });
}
document.getElementById('basis-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.add('hidden');
});

function openVolumeModal() {
  loadTaifexJson().then(data => {
    const hist = data?.market_volume;
    if (!hist?.length) return;
    const vcell = v => (v > 0 ? v.toLocaleString() : '—');  // 單邊缺值顯示「—」
    const rows = [...hist].reverse().map(r => {
      const tw = r.twse > 0, tp = r.tpex > 0;
      const tot = (tw && tp) ? (r.total?.toLocaleString() ?? '—')
        : (tw || tp) ? ((tw ? r.twse : 0) + (tp ? r.tpex : 0)).toLocaleString() : '—';
      return `<div class="flex justify-between py-1 border-b border-gray-700">
        <span class="text-gray-400">${r.date}</span>
        <span class="text-gray-300">${vcell(r.twse)}</span>
        <span class="text-gray-300">${vcell(r.tpex)}</span>
        <span class="font-bold text-yellow-300">${tot}</span>
      </div>`;
    }).join('');
    document.getElementById('volume-modal-body').innerHTML =
      `<div class="flex justify-between text-xs text-gray-500 mb-2 pb-1 border-b border-gray-600">
        <span>日期</span><span>上市</span><span>上櫃</span><span>合計(億)</span>
      </div>` + rows;
    document.getElementById('volume-modal').classList.remove('hidden');
  });
}

function openRetailModal() {
  loadTaifexJson().then(data => {
    const hist = data?.settlement_history;
    if (!hist?.length) return;
    const rows = [...hist].reverse().slice(0, 20).map(r => {
      const val = r.retail_total ?? '--';
      const color = (typeof val === 'number') ? (val >= 0 ? 'text-red-400' : 'text-green-400') : 'text-gray-400';
      const label = (typeof val === 'number') ? (val >= 0 ? '偏多' : '偏空') : '';
      return `<div class="flex justify-between py-1 border-b border-gray-700">
        <span class="text-gray-400">${r.date}</span>
        <span class="font-bold ${color}">${typeof val === 'number' ? val.toLocaleString() : val} <span class="text-xs">${label}</span></span>
      </div>`;
    }).join('');
    document.getElementById('retail-modal-body').innerHTML =
      `<div class="flex justify-between text-xs text-gray-500 mb-2 pb-1 border-b border-gray-600">
        <span>日期</span><span>散戶合計（小台當量）</span>
      </div>` + rows;
    document.getElementById('retail-modal').classList.remove('hidden');
  });
}

const STRATEGY_COLOR = { '雙買': 'text-yellow-300', '雙賣': 'text-purple-400', '看多': 'text-red-400', '看空': 'text-green-400', '偏多': 'text-red-300', '偏空': 'text-green-300', '中性': 'text-gray-400' };

// 外資選擇權策略分類（改動須同步後端 fetch_taifex.py classify_opt_strategy）：
// 方向成立需同時 |淨部位| ≥ 1000 口 且 ≥ 該邊總 OI 的 10%（相對門檻，OI 大時 1000 口只是雜訊）；
// 單邊明確、另一邊中性 → 偏多/偏空（買Call或賣Put=偏多；賣Call或買Put=偏空），不再併入中性
function optBias(net, total) {
  const thr = Math.max(1000, total * 0.10);
  return net >= thr ? 'long' : net <= -thr ? 'short' : 'neutral';
}
function classifyStrategy(bc, sc, bp, sp) {
  const c = optBias(bc - sc, bc + sc);
  const p = optBias(bp - sp, bp + sp);
  if (c === 'long'  && p === 'long')  return { label: '雙買', full: '雙買（Long Strangle）',  desc: '預期大波動，方向未定',        color: 'text-yellow-400' };
  if (c === 'short' && p === 'short') return { label: '雙賣', full: '雙賣（Short Strangle）', desc: '預期盤整、小波動',            color: 'text-blue-400' };
  if (c === 'long'  && p === 'short') return { label: '看多', full: '看多（Bullish）',        desc: '買 Call 賣 Put，偏多',        color: 'text-red-400' };
  if (c === 'short' && p === 'long')  return { label: '看空', full: '看空/避險（Bearish）',   desc: '賣 Call 買 Put，偏空或避險',  color: 'text-green-400' };
  if (c === 'long'  || p === 'short') return { label: '偏多', full: '偏多（單邊）',           desc: c === 'long' ? '單邊買 Call，溫和偏多' : '單邊賣 Put，溫和偏多', color: 'text-red-300' };
  if (c === 'short' || p === 'long')  return { label: '偏空', full: '偏空（單邊）',           desc: c === 'short' ? '單邊賣 Call，溫和偏空' : '單邊買 Put，溫和偏空', color: 'text-green-300' };
  return { label: '中性', full: '中性／觀望', desc: '淨部位接近中立', color: 'text-gray-400' };
}

function openStrategyModal() {
  loadTaifexJson().then(data => {
    const hist = data?.settlement_history;
    if (!hist?.length) return;
    const fmt = v => (v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toLocaleString());
    const netColor = v => (v == null ? 'text-gray-400' : v > 0 ? 'text-red-400' : v < 0 ? 'text-green-400' : 'text-gray-400');
    const rows = [...hist].reverse().slice(0, 20).map(r => {
      // 有原始 bc/sc/bp/sp 就即時用新邏輯回算（歷史存的 opt_strategy 是舊門檻），沒有才用存值
      const hasRaw = r.bc != null && r.sc != null && r.bp != null && r.sp != null;
      const st = hasRaw ? classifyStrategy(r.bc, r.sc, r.bp, r.sp) : null;
      const label = st ? st.label : (r.opt_strategy ?? '--');
      const color = st ? st.color : (STRATEGY_COLOR[label] || 'text-gray-400');
      const callNet = hasRaw ? r.bc - r.sc : null;
      const putNet  = hasRaw ? r.bp - r.sp : null;
      return `<tr class="border-b border-gray-800">
        <td class="py-1 text-gray-400">${r.date}</td>
        <td class="text-right py-1 ${netColor(callNet)}">${fmt(callNet)}</td>
        <td class="text-right py-1 ${netColor(putNet)}">${fmt(putNet)}</td>
        <td class="text-right py-1 font-bold ${color}">${label}</td>
      </tr>`;
    }).join('');
    document.getElementById('strategy-modal-body').innerHTML = `
      <table class="w-full text-xs">
        <thead><tr class="text-gray-500 border-b border-gray-600">
          <th class="text-left py-1 font-normal">日期</th>
          <th class="text-right font-normal">Call淨</th>
          <th class="text-right font-normal">Put淨</th>
          <th class="text-right font-normal">策略</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    document.getElementById('strategy-modal').classList.remove('hidden');
  });
}

// 選擇權未平倉數值熱度色階（越大越紅；門檻 30000/20000/15000/10000/8000）
function optColor(v) {
  v = Number(v) || 0;
  return v >= 30000 ? 'text-red-400' : v >= 20000 ? 'text-orange-400' : v >= 15000 ? 'text-yellow-400'
    : v >= 10000 ? 'text-green-400' : v >= 8000 ? 'text-cyan-400' : 'text-gray-400';
}
function setOpt(id, v) { const el = document.getElementById(id); if (el) { el.textContent = (Number(v) || 0).toLocaleString(); el.className = optColor(v); } }

// 選擇權 BC/SC/BP/SP 近20天（讀 settlement_history，每日已含四值）
function openOptionModal() {
  loadTaifexJson().then(data => {
    const hist = data?.settlement_history;
    if (!hist?.length) return;
    const c = v => (v == null || v === '' ? '—' : Number(v).toLocaleString());
    const rows = [...hist].reverse().slice(0, 20).map(r => `
      <tr class="border-b border-gray-800">
        <td class="py-1 text-gray-400">${r.date}</td>
        <td class="text-right py-1 ${optColor(r.bc)}">${c(r.bc)}</td>
        <td class="text-right py-1 ${optColor(r.sc)}">${c(r.sc)}</td>
        <td class="text-right py-1 ${optColor(r.bp)}">${c(r.bp)}</td>
        <td class="text-right py-1 ${optColor(r.sp)}">${c(r.sp)}</td>
      </tr>`).join('');
    document.getElementById('option-modal-body').innerHTML = `
      <table class="w-full text-xs">
        <thead><tr class="text-gray-500 border-b border-gray-600">
          <th class="text-left py-1">日期</th>
          <th class="text-right py-1">BC<span class="text-gray-600">買Call</span></th>
          <th class="text-right py-1">SC<span class="text-gray-600">賣Call</span></th>
          <th class="text-right py-1">BP<span class="text-gray-600">買Put</span></th>
          <th class="text-right py-1">SP<span class="text-gray-600">賣Put</span></th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    document.getElementById('option-modal').classList.remove('hidden');
  });
}

// ── 波動區塊 ──────────────────────────────────────────────────

const CAT_COLOR = { '低': 'text-blue-400', '小': 'text-cyan-400', '中': 'text-yellow-400', '大': 'text-orange-400', '高': 'text-red-400' };
const CAT_BG    = { '低': 'bg-blue-900',   '小': 'bg-cyan-900',   '中': 'bg-yellow-900',   '大': 'bg-orange-900',   '高': 'bg-red-900' };

async function loadVolatility() {
  try {
    const data = await loadTaifexJson();
    const vol = data.volatility;
    if (!vol) return;
    renderVol('tx', vol.tx, '台指期');
    renderVol('nq', vol.nq, 'Nasdaq 期貨');
  } catch (e) { console.error('loadVolatility:', e); }
}

function renderVol(key, vol, label) {
  if (!vol || !vol.yesterday) return;
  const yd = vol.yesterday;
  document.getElementById(`${key}-high`).textContent  = yd.high.toLocaleString();
  document.getElementById(`${key}-low`).textContent   = yd.low.toLocaleString();
  document.getElementById(`${key}-range`).textContent = yd.range.toLocaleString();
  document.getElementById(`${key}-avg`).textContent   = vol.avg20.toLocaleString();
  const cat = vol.category || '--';
  const el = document.getElementById(`${key}-cat`);
  el.textContent = cat;
  el.className = `text-sm font-bold px-3 py-1 rounded-full ${CAT_BG[cat] || 'bg-gray-700'} ${CAT_COLOR[cat] || 'text-white'}`;
  if (key === 'tx' && vol.history?.length) {
    const latestDate = vol.history[vol.history.length - 1].date;
    const dateEl = document.getElementById('tx-latest-date');
    if (dateEl) dateEl.textContent = `(${latestDate})`;
  }
}

let _volData = null;
function openVolModal(key) {
  loadTaifexJson().then(data => {
    const vol = data?.volatility?.[key];
    if (!vol?.history) return;
    const titles = { tx: '台指期 前20天波動', nq: 'Nasdaq 期貨 前20天波動' };
    document.getElementById('vol-modal-title').textContent = titles[key] || '';
    const rows = [...vol.history].reverse().map(r => {
      const cat = r.range && vol.avg20
        ? (r.range < vol.avg20 * 0.4 ? '低' : r.range < vol.avg20 * 0.7 ? '小' : r.range < vol.avg20 * 1.0 ? '中' : r.range <= vol.avg20 * 1.4 ? '大' : '高')
        : '--';
      const c = CAT_COLOR[cat] || 'text-gray-300';
      return `<div class="flex justify-between items-center py-1 border-b border-gray-800">
        <span class="text-gray-400">${r.date}</span>
        <span class="text-gray-300">${r.high.toLocaleString()} / ${r.low.toLocaleString()}</span>
        <span class="w-14 text-right font-bold ${c}">${r.range.toLocaleString()}</span>
        <span class="w-6 text-right text-xs ${c}">${cat}</span>
      </div>`;
    }).join('');
    document.getElementById('vol-modal-body').innerHTML =
      `<div class="flex justify-between text-xs text-gray-500 mb-1 px-0">
         <span>日期</span><span>高/低</span><span class="w-14 text-right">波動</span><span class="w-6"></span>
       </div>` + rows;
    document.getElementById('vol-modal').classList.remove('hidden');
  });
}

function closeVolModal() {
  document.getElementById('vol-modal').classList.add('hidden');
}

document.getElementById('vol-modal').addEventListener('click', function(e) {
  if (e.target === this) closeVolModal();
});

// 結算日與剩餘交易日：後端計算（含國定假日），前端從 taifex_data.json 讀取
// 讀取由 GitHub Actions 每日更新的 taifex_data.json（同源，無 CORS 問題）
let _taifexCache = null;
let _taifexPromise = null;

async function loadTaifexJson() {
  if (_taifexCache) return _taifexCache;
  if (!_taifexPromise) {
    _taifexPromise = fetch('taifex_data.json?_=' + Date.now(), { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        _taifexCache = data;
        _taifexPromise = null;
        if (data.updated_at) {
          const tw = new Date(new Date(data.updated_at).getTime() + 8 * 3600 * 1000);
          const fmt = tw.toISOString().slice(0, 16).replace('T', ' ');
          document.getElementById('taifex-updated').textContent = `期貨/選擇權資料更新：${fmt}（台灣時間）`;
        }
        return data;
      })
      .catch(e => {
        _taifexPromise = null;
        console.error('taifex_data.json fetch failed:', e);
        throw e;
      });
  }
  return _taifexPromise;
}

// 每天 18:30 台灣時間自動更新市場資訊
function scheduleAutoRefresh() {
  let lastRefreshDay = null;
  setInterval(() => {
    const twNow = new Date(Date.now() + 8 * 3600 * 1000);
    const h = twNow.getUTCHours();
    const m = twNow.getUTCMinutes();
    const day = twNow.toISOString().slice(0, 10);
    if (h === 18 && m === 30 && day !== lastRefreshDay) {
      lastRefreshDay = day;
      refreshAll();
    }
  }, 60000); // 每分鐘檢查一次
}

// 結算比歷史彈窗
function openSettlementModal() {
  loadTaifexJson().then(data => {
    const hist = data.settlement_history || [];
    const recent = [...hist].slice(-20).reverse();   // 最新在上（與其他近20天彈窗一致）
    const settlementDate = data.settlement_date || '--';
    document.getElementById('settlement-modal-title').textContent =
      `結算比歷史（結算日 ${settlementDate}）`;
    const body = document.getElementById('settlement-modal-body');
    if (!recent.length) { body.innerHTML = '<div class="text-gray-400">暫無資料</div>'; }
    else {
      body.innerHTML = `
        <table class="w-full text-xs text-right">
          <thead>
            <tr class="text-gray-500 border-b border-gray-700">
              <th class="text-left pb-1">日期</th>
              <th>期淨</th>
              <th>選淨</th>
              <th>壓力</th>
              <th>剩日</th>
              <th>結算比</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(r => {
              const futNet  = r.fut_net  ?? 0;
              const optNet  = r.opt_net  ?? 0;
              const pressure= r.pressure ?? 0;
              const tdays   = r.tdays    ?? 0;
              const ratio   = r.ratio    ?? 0;
              const ratioColor = ratio <= 0 ? 'text-green-400' : 'text-red-400';
              const optFlag = optNet > 3000 ? `<span class="text-yellow-400">+${optNet.toLocaleString()}</span>` : `<span class="text-gray-500">${optNet.toLocaleString()}</span>`;
              return `<tr class="border-b border-gray-800">
                <td class="text-left py-1 text-gray-300">${r.date}</td>
                <td class="${futNet <= 0 ? 'text-green-400' : 'text-red-400'}">${futNet.toLocaleString()}</td>
                <td>${optFlag}</td>
                <td class="text-gray-200">${pressure.toLocaleString()}</td>
                <td class="text-gray-400">${tdays}</td>
                <td class="${ratioColor} font-bold">${ratio.toLocaleString()}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    }
    document.getElementById('settlement-modal').classList.remove('hidden');
  });
}
function closeSettlementModal() {
  document.getElementById('settlement-modal').classList.add('hidden');
}
document.getElementById('settlement-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSettlementModal();
});

// 外資期貨未平倉（大台+小台/4）與結算比
async function loadFutures() {
  try {
    const data = await loadTaifexJson();
    const f = data.futures;
    if (!f) throw new Error('no futures');

    const rawDate = data.date || '';
    const fmtDate = rawDate.length === 8
      ? `${rawDate.slice(0,4)}/${rawDate.slice(4,6)}/${rawDate.slice(6,8)}` : '';
    document.getElementById('fut-date').textContent = fmtDate;
    document.getElementById('ret-date').textContent = fmtDate;

    const txF  = f.txF  ?? 0;
    const txT  = f.txT  ?? 0;
    const txD  = f.txD  ?? 0;
    const mtxF = f.mtxF ?? 0;
    const mtxT = f.mtxT ?? 0;
    const mtxD = f.mtxD ?? 0;

    const tmxF = f.tmxF ?? 0;
    const tmxT = f.tmxT ?? 0;
    const tmxD = f.tmxD ?? 0;

    const mtxFEq    = mtxF / 4;
    const futTotal  = txF + mtxFEq;
    // 散戶 = 小台 + 微台（微台 ÷5 換算為小台當量後相加）
    const mtxRetail    = -(mtxF + mtxT + mtxD);
    const tmxRetailRaw = -(tmxF + tmxT + tmxD);
    const tmxRetail    = tmxRetailRaw / 5;   // 微台→小台當量
    const retTotal     = mtxRetail + tmxRetail;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      el.textContent = (val >= 0 ? '+' : '') + Math.round(val).toLocaleString();
      el.className = val >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
    };

    const setRetailVal = (id, val) => {
      const el = document.getElementById(id);
      const label = val >= 0 ? '偏多' : '偏空';
      el.textContent = (val >= 0 ? '+' : '') + Math.round(val).toLocaleString() + `（${label}）`;
      el.className = val >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
    };

    setVal('fut-tx',    txF);
    setVal('fut-mtx',   mtxFEq);
    setVal('fut-total', futTotal);
    setRetailVal('ret-mtx',   mtxRetail);
    setRetailVal('ret-tmx',   tmxRetail);
    setRetailVal('ret-total', retTotal);

    // 結算比：從 settlement_history 最新一筆讀取
    const hist = data.settlement_history || [];
    const latest = hist.length ? hist[hist.length - 1] : null;
    if (latest) {
      document.getElementById('fut-days').textContent = `${latest.tdays} 交易日`;
      const ratioEl = document.getElementById('fut-ratio');
      ratioEl.textContent = latest.ratio.toLocaleString();
      ratioEl.className = latest.ratio >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
    } else {
      document.getElementById('fut-days').textContent = '--';
      document.getElementById('fut-ratio').textContent = '--';
    }
  } catch (e) {
    console.error('loadFutures:', e);
    ['fut-tx','fut-mtx','fut-total','fut-days','fut-ratio','ret-mtx','ret-tmx','ret-total'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
  }
}

// 三大法人：優先讀 taifex_data.json（GitHub Actions 每日抓），CORS 問題不存在
async function loadInstitutes() {
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (val === null || val === undefined) { el.textContent = '--'; return; }
    el.textContent = (val >= 0 ? '+' : '') + Number(val).toFixed(1) + '億';
    el.className = val >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
  };

  try {
    const data = await loadTaifexJson();
    const inst = data.institute;
    if (inst && (inst.foreign !== null || inst.trust !== null)) {
      setEl('inst-foreign', inst.foreign);
      setEl('inst-trust',   inst.trust);
      setEl('inst-dealer',  inst.dealer);
      setEl('inst-total',   inst.total);
      const fmt = inst.date ? inst.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '--';
      document.getElementById('market-date').textContent = `資料日期：${fmt}（收盤後更新）`;
      document.getElementById('inst-date').textContent =
        inst.date ? `${inst.date.slice(0,4)}/${inst.date.slice(4,6)}/${inst.date.slice(6,8)}` : '';
      return;
    }
  } catch (e) { /* fallthrough */ }

  ['inst-foreign','inst-trust','inst-dealer','inst-total'].forEach(id => {
    document.getElementById(id).textContent = '--';
  });
}

// 三大法人 近20天（P2-18）：資料源＝settlement_history 的 foreign/trust/dealer
// （後端 backfill_inst_history 由 TWSE BFI82U 逐日補；口徑同首頁＝自營含避險、外資含外資自營商）
// dealer 為 P2-18 新增欄位，後端首次回補前舊列會是 null → 顯示「--」而非 0，不假裝有資料
function openInstModal() {
  loadTaifexJson().then(data => {
    const hist = data?.settlement_history;
    if (!hist?.length) return;
    const num = v => (typeof v === 'number');
    const cell = v => {
      if (!num(v)) return `<span class="text-gray-500">--</span>`;
      const color = v >= 0 ? 'text-red-400' : 'text-green-400';
      return `<span class="${color}">${(v >= 0 ? '+' : '') + v.toFixed(1)}</span>`;
    };
    const rows = [...hist].reverse().slice(0, 20).map(r => {
      const vals = [r.foreign, r.trust, r.dealer];
      const total = vals.every(num) ? vals.reduce((a, b) => a + b, 0) : null;
      return `<tr class="border-b border-gray-800">
        <td class="py-1 text-gray-400">${r.date}</td>
        <td class="py-1 text-right">${cell(r.foreign)}</td>
        <td class="py-1 text-right">${cell(r.trust)}</td>
        <td class="py-1 text-right">${cell(r.dealer)}</td>
        <td class="py-1 text-right font-bold">${cell(total)}</td>
      </tr>`;
    }).join('');
    document.getElementById('inst-modal-body').innerHTML =
      `<table class="w-full">
        <thead><tr class="text-gray-500 border-b border-gray-600">
          <th class="py-1 text-left font-normal">日期</th>
          <th class="py-1 text-right font-normal">外資</th>
          <th class="py-1 text-right font-normal">投信</th>
          <th class="py-1 text-right font-normal">自營商</th>
          <th class="py-1 text-right font-normal">合計</th>
        </tr></thead><tbody>${rows}</tbody></table>
       <div class="text-gray-500 mt-2">紅＝買超、綠＝賣超；「--」＝該日資料尚未回補。</div>`;
    document.getElementById('inst-modal').classList.remove('hidden');
  });
}

// 台指選擇權（讀 taifex_data.json）
async function loadOptions() {
  try {
    const data = await loadTaifexJson();
    const o = data.options;
    if (!o) throw new Error('no options');

    const bc = o.bc ?? 0, sc = o.sc ?? 0, bp = o.bp ?? 0, sp = o.sp ?? 0;
    if (bc + sc + bp + sp === 0) throw new Error('all zero');

    const rawDate = data.date || '';
    if (rawDate.length === 8) {
      document.getElementById('opt-date').textContent =
        `${rawDate.slice(0,4)}/${rawDate.slice(4,6)}/${rawDate.slice(6,8)}`;
    }

    const callNet = bc - sc;
    const putNet  = bp - sp;

    setOpt('opt-bc', bc); setOpt('opt-sc', sc); setOpt('opt-bp', bp); setOpt('opt-sp', sp);

    const setNet = (id, val) => {
      const el = document.getElementById(id);
      el.textContent = (val >= 0 ? '+' : '') + val.toLocaleString();
      el.className = val >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
    };
    setNet('opt-call-net', callNet);
    setNet('opt-put-net',  putNet);

    // 策略判斷（相對門檻＋單邊分類，與後端/彈窗共用 classifyStrategy）
    const st = classifyStrategy(bc, sc, bp, sp);
    const el = document.getElementById('opt-strategy');
    el.textContent = `${st.full}　${st.desc}`;
    el.className = `text-sm font-bold ${st.color}`;

    // 日增減 Δ：與前一交易日留倉比較（settlement_history 每日已含 bc/sc/bp/sp）
    const todayIso = rawDate.length === 8 ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}` : '';
    const prior = [...(data.settlement_history || [])].reverse()
      .find(r => r.date < todayIso && r.bc != null && r.sc != null && r.bp != null && r.sp != null);
    const setDelta = (id, v) => {
      const dEl = document.getElementById(id);
      if (!dEl) return;
      if (v == null) { dEl.textContent = ''; return; }
      dEl.textContent = `Δ ${v >= 0 ? '+' : ''}${v.toLocaleString()}`;
      dEl.className = 'text-xs ' + (v > 0 ? 'text-red-300' : v < 0 ? 'text-green-300' : 'text-gray-500');
    };
    setDelta('opt-call-delta', prior ? callNet - (prior.bc - prior.sc) : null);
    setDelta('opt-put-delta',  prior ? putNet  - (prior.bp - prior.sp) : null);

    // P/C Ratio（以數值比較，避免字串/數字混用）
    const callTotal = bc + sc;
    const putTotal  = bp + sp;
    const pcVal     = callTotal > 0 ? putTotal / callTotal : null;
    let pcDesc, pcColor;
    if (pcVal === null) {
      pcDesc = ''; pcColor = 'text-gray-400';
    } else if (pcVal > 1.2) {
      pcDesc = '偏空恐慌'; pcColor = 'text-green-400';
    } else if (pcVal < 0.8) {
      pcDesc = '偏多追漲'; pcColor = 'text-red-400';
    } else {
      pcDesc = '中性'; pcColor = 'text-gray-300';
    }
    const pcEl = document.getElementById('opt-pc-ratio');
    pcEl.textContent = pcVal === null ? '--' : `${pcVal.toFixed(2)}　${pcDesc}`;
    pcEl.className = `text-sm font-bold ${pcColor}`;
  } catch (e) {
    console.error('loadOptions:', e);
    ['opt-bc','opt-sc','opt-bp','opt-sp','opt-call-net','opt-put-net','opt-strategy','opt-pc-ratio'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
  }
}

// 籌碼綜合評分：單日資料 → {score, signals, futNet}
// entry 欄位：foreign/trust(億元，可缺)、txF/mtxF(口)、bc/sc/bp/sp(口)、ratio/tdays
// 主畫面（當日即時）與近20天彈窗（settlement_history 逐日）共用，避免兩套邏輯漂移
function scoreEntry(e) {
  const signals = [];
  let score = 0; // 正=多 負=空

  // 1. 外資現貨買賣超（高權重）
  const foreign = e.foreign ?? null;
  if (foreign !== null) {
    const s = foreign >= 30 ? 2 : foreign >= 5 ? 1 : foreign <= -30 ? -2 : foreign <= -5 ? -1 : 0;
    score += s * 2;
    const label = foreign >= 0 ? `+${foreign}億` : `${foreign}億`;
    signals.push(`外資現貨 ${label} → ${s > 0 ? '偏多' : s < 0 ? '偏空' : '中性'}`);
  }

  // 2. 外資期貨淨部位（高權重）
  const futNet = (e.txF ?? 0) + (e.mtxF ?? 0) / 4;
  {
    const s = futNet >= 2000 ? 2 : futNet >= 500 ? 1 : futNet <= -2000 ? -2 : futNet <= -500 ? -1 : 0;
    score += s * 2;
    signals.push(`外資期貨 ${Math.round(futNet) >= 0 ? '+' : ''}${Math.round(futNet).toLocaleString()}口 → ${s > 0 ? '偏多' : s < 0 ? '偏空' : '中性'}`);
  }

  // 3. 結算比（高權重，正值代表空方壓力大）
  if (e.ratio != null) {
    const ratio = e.ratio ?? 0;
    const tdays = e.tdays ?? 20;
    const s = ratio >= 5000 ? -2 : ratio >= 2000 ? -1 : ratio <= 500 ? 1 : 0;
    score += s * 2;
    signals.push(`結算比 ${ratio.toLocaleString()}（${tdays}日）→ ${s < 0 ? '空壓大' : s > 0 ? '壓力低' : '中性'}`);
  }

  // 4. P/C Ratio（中權重）
  const bc = e.bc ?? 0, sc = e.sc ?? 0, bp = e.bp ?? 0, sp = e.sp ?? 0;
  if (bc + sc > 0) {
    const pcr = (bp + sp) / (bc + sc);
    // 門檻與顯示用（loadOptions）一致：>1.2 偏空、<0.8 偏多，避免「顯示偏空恐慌卻不計分」
    const s = pcr > 1.2 ? -1 : pcr < 0.8 ? 1 : 0;
    score += s;
    signals.push(`P/C Ratio ${pcr.toFixed(2)} → ${s < 0 ? '偏空恐慌' : s > 0 ? '偏多追漲' : '中性'}`);
  }

  // 5. 外資選擇權方向（中權重）：與策略分類同一套判斷（看多/偏多=+1、看空/偏空=−1）
  if (bc + sc + bp + sp > 0) {
    const st = classifyStrategy(bc, sc, bp, sp);
    const s = (st.label === '看多' || st.label === '偏多') ? 1
            : (st.label === '看空' || st.label === '偏空') ? -1 : 0;
    score += s;
    const callNet = bc - sc, putNet = bp - sp;
    signals.push(`選擇權 ${st.label} Call${callNet >= 0 ? '+' : ''}${callNet.toLocaleString()} Put${putNet >= 0 ? '+' : ''}${putNet.toLocaleString()}`);
  }

  // 6. 投信買賣超（低權重）
  const trust = e.trust ?? null;
  if (trust !== null) {
    const s = trust >= 5 ? 1 : trust <= -5 ? -1 : 0;
    score += s;
    signals.push(`投信 ${trust >= 0 ? '+' : ''}${trust}億 → ${s > 0 ? '偏多' : s < 0 ? '偏空' : '中性'}`);
  }

  return { score, signals, futNet };
}

function rateScore(score) {
  if (score >= 5)  return { label: '▲ 強烈偏多',  color: 'text-red-400' };
  if (score >= 2)  return { label: '▲ 偏多',       color: 'text-red-300' };
  if (score <= -5) return { label: '▼ 強烈偏空',  color: 'text-green-400' };
  if (score <= -2) return { label: '▼ 偏空',       color: 'text-green-300' };
  return { label: '◆ 中性／分歧', color: 'text-yellow-400' };
}

// 籌碼綜合評估（主畫面：當日即時資料）
async function loadSignalSummary() {
  try {
    const data = await loadTaifexJson();
    const f = data.futures || {};
    const o = data.options || {};
    const inst = data.institute || {};
    const hist = data.settlement_history || [];
    const latest = hist.length ? hist[hist.length - 1] : null;

    const { score, signals, futNet } = scoreEntry({
      foreign: inst.foreign ?? null,
      trust:   inst.trust ?? null,
      txF: f.txF, mtxF: f.mtxF,
      bc: o.bc, sc: o.sc, bp: o.bp, sp: o.sp,
      ratio: latest ? (latest.ratio ?? 0) : null,
      tdays: latest ? latest.tdays : null,
    });
    const { label: summary, color: summaryColor } = rateScore(score);

    // 一致性警示
    const foreign = inst.foreign ?? null;
    const consistency = (futNet < -500 && foreign !== null && foreign > 30)
      ? '⚠ 現貨多/期貨空：訊號分歧，注意避險'
      : (futNet > 500 && foreign !== null && foreign < -30)
      ? '⚠ 現貨空/期貨多：訊號分歧'
      : '';

    document.getElementById('signal-summary').textContent = `${summary}（${score > 0 ? '+' : ''}${score} 分）`;
    document.getElementById('signal-summary').className = `text-sm font-bold ${summaryColor} mb-1`;
    document.getElementById('signal-detail').innerHTML =
      (consistency ? `<div class="text-yellow-400">${consistency}</div>` : '') +
      signals.map(s => `<div>${s}</div>`).join('');
  } catch (e) {
    console.error('loadSignalSummary:', e);
  }
}

// 籌碼綜合評估 近20天（settlement_history 逐日回算；缺外資現貨/投信的日子標 *）
function openSignalModal() {
  loadTaifexJson().then(data => {
    const hist = data?.settlement_history;
    if (!hist?.length) return;
    let hasPartial = false;
    const rows = [...hist].reverse().slice(0, 20).map(r => {
      const { score } = scoreEntry(r);
      const partial = r.foreign == null;
      if (partial) hasPartial = true;
      const { label, color } = rateScore(score);
      return `<div class="flex justify-between py-1 border-b border-gray-700">
        <span class="text-gray-400">${r.date}${partial ? '<span class="text-yellow-500">*</span>' : ''}</span>
        <span class="font-bold ${color}">${score > 0 ? '+' : ''}${score}分　${label}</span>
      </div>`;
    }).join('');
    document.getElementById('signal-modal-body').innerHTML =
      `<div class="flex justify-between text-xs text-gray-500 mb-2 pb-1 border-b border-gray-600">
        <span>日期</span><span>分數／評語</span>
      </div>` + rows +
      (hasPartial ? '<div class="text-xs text-gray-500 mt-2">* 該日缺外資現貨/投信資料，分數未含這兩項</div>' : '');
    document.getElementById('signal-modal').classList.remove('hidden');
  });
}

async function loadEarnings() {
  try {
    const data = await loadTaifexJson();
    const list = (data && data.earnings && data.earnings.list) || [];
    const box = document.getElementById('earnings-box');
    if (!list.length) { box.textContent = '暫無資料'; return; }
    const NAME = {NVDA:'輝達',AAPL:'蘋果',MSFT:'微軟',GOOGL:'Google',AMZN:'亞馬遜',META:'Meta',TSLA:'特斯拉',TSM:'台積電'};
    // P2-20 §3：法說日已過 → 整列灰顯＋標「已公布」。
    // 背景：AlphaVantage 法說後要數天~一週才滾到下一季（如 TSM 7/16 已結束仍顯示舊日期），
    // 灰顯只解決「看起來像未來事件」的誤導，不改後端資料。
    // ⚠ 不可用 toISOString()——它會轉回 UTC，台灣 08:00 前會算成前一天（與 calcChanges 同一寫法手組）
    const _tw = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const todayTw = `${_tw.getFullYear()}-${String(_tw.getMonth() + 1).padStart(2, '0')}-${String(_tw.getDate()).padStart(2, '0')}`;
    box.innerHTML = list.map(r => {
      const past = r.next && r.next < todayTw;
      return `
      <div class="flex justify-between py-1 border-b border-gray-800${past ? ' text-gray-500' : ''}">
        <span class="${past ? 'text-gray-500' : 'text-gray-300'}">${r.sym} ${NAME[r.sym]||''}</span>
        <span class="${past ? 'text-gray-500' : 'text-yellow-300'}">${r.next || '--'}${past ? ' <span class="text-xs">已公布</span>' : ''}</span>
      </div>`;
    }).join('');
  } catch (e) { console.error('loadEarnings:', e); }
}

async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = '載入中...';
  btn.disabled = true;
  chipCache = {};
  _taifexCache = null;
  _taifexPromise = null;
  try {
    await Promise.all([loadStocks(), loadMarketInfo()]);
  } catch (e) {
    console.error('refreshAll error:', e);
  } finally {
    btn.textContent = '↻ 重新整理';
    btn.disabled = false;
  }
}

async function triggerFetch() {
  const btn = document.getElementById('fetch-btn');
  const REPO = 'CharlesJuGit/stocklist';
  const WORKFLOW = 'fetch-taifex.yml';

  btn.textContent = '檢查中...';
  btn.disabled = true;

  // 比對 JSON 最後更新時間，30分鐘內視為已是最新（避免重複觸發）。
  // P2-16（2026-07-17 教訓）：只看檔案時間會誤擋——排程班剛寫過檔但三大法人尚未發布時
  // （inst.date 落後頂層 date），手動救援被「已是最新」拒觸發。故加條件：內容也要跟上才算最新。
  try {
    const localData = await loadTaifexJson().catch(() => null);
    const updatedAt = localData?.updated_at;
    if (updatedAt) {
      const diffMin = (Date.now() - new Date(updatedAt).getTime()) / 60000;
      const instDate = localData?.institute?.date;
      const instFresh = !instDate || !localData?.date || instDate === localData.date;
      if (diffMin < 30 && instFresh) {
        btn.textContent = '已是最新';
        setTimeout(() => { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; }, 2000);
        return;
      }
    }
  } catch (e) {}

  // PAT 存 localStorage：個人儀表板、手機常用，記住免重輸（靜態網頁無使用者輸入，XSS 風險低）
  let pat = localStorage.getItem('gh_pat') || '';
  if (!pat) {
    pat = prompt('請輸入 GitHub Personal Access Token（需要 workflow 權限）：');
    if (!pat) { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; return; }
    pat = pat.trim();
    localStorage.setItem('gh_pat', pat);
  }

  btn.textContent = '觸發中...';
  btn.disabled = true;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    if (res.status === 204) {
      btn.textContent = '✓ 已觸發';
      setTimeout(() => { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; }, 3000);
    } else if (res.status === 401) {
      localStorage.removeItem('gh_pat');
      btn.textContent = 'Token 錯誤';
      alert('Token 無效或已過期，已清除，請重試。');
      setTimeout(() => { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; }, 2000);
    } else {
      btn.textContent = `失敗 (${res.status})`;
      setTimeout(() => { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; }, 3000);
    }
  } catch (e) {
    console.error('triggerFetch error:', e);
    btn.textContent = '網路錯誤';
    setTimeout(() => { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; }, 3000);
  }
}

// 更新紀錄彈窗：顯示最近每次（定期/手動）觸發抓到的各資料日期，綠=已更新到最新、灰=仍為舊資料
function openUpdateLogModal() {
  loadTaifexJson().then(data => {
    const log = data?.update_log || [];
    const body = document.getElementById('updatelog-body');
    if (!log.length) {
      body.innerHTML = '<div class="text-gray-400">暫無紀錄</div>';
    } else {
      // 綠標基準改用頂層 date（本次實際抓到的期貨交易日），非 log 內自我參照的最大值——
      // 否則全部 stale 時最舊的也會誤標綠。頂層 date 為 YYYYMMDD，轉 YYYY-MM-DD 對齊 log 欄位
      const td = data?.date || '';
      const newest = td.length === 8 ? `${td.slice(0,4)}-${td.slice(4,6)}-${td.slice(6)}` : td;
      const md = d => d ? d.slice(5) : '--';
      const cell = d => `<td class="px-1 py-1 text-right ${d === newest ? 'text-green-400' : 'text-gray-500'}">${md(d)}</td>`;
      const tlabel = t => t === 'schedule' ? '定期' : (t === 'workflow_dispatch' ? '手動' : (t || '--'));
      const rows = [...log].reverse().map(r => `
        <tr class="border-b border-gray-800">
          <td class="px-1 py-1 text-gray-300 whitespace-nowrap">${r.at || ''}</td>
          <td class="px-1 py-1 text-gray-400">${tlabel(r.trigger)}</td>
          ${cell(r.inst)}${cell(r.fut)}${cell(r.tx)}
        </tr>`).join('');
      body.innerHTML = `
        <table class="w-full">
          <thead><tr class="text-gray-500 border-b border-gray-700">
            <th class="px-1 py-1 text-left">時間</th>
            <th class="px-1 py-1 text-left">方式</th>
            <th class="px-1 py-1 text-right">三大法人</th>
            <th class="px-1 py-1 text-right">期貨</th>
            <th class="px-1 py-1 text-right">TX波動</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="text-[10px] text-gray-500 mt-2">綠=該次已更新到最新交易日(${md(newest)})、灰=仍為較舊資料。最近 ${log.length} 次。</div>`;
    }
    // 已解鎖則直接顯示管理區（GitHub 連結）
    if (sessionStorage.getItem('admin') === '1') {
      document.getElementById('admin-area').classList.remove('hidden');
      document.getElementById('admin-toggle').classList.add('hidden');
    }
    document.getElementById('updatelog-modal').classList.remove('hidden');
  });
}
document.getElementById('updatelog-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.add('hidden');
});
// 管理密碼門（僅視覺遮擋：靜態公開站，密碼明文於原始碼，可被繞過，非真正安全防護）
function unlockAdmin() {
  if (sessionStorage.getItem('admin') === '1') {
    document.getElementById('admin-area').classList.remove('hidden');
    document.getElementById('admin-toggle').classList.add('hidden');
    return;
  }
  const pw = prompt('請輸入管理密碼：');
  if (pw === null) return;
  if (pw === '11111111') {
    sessionStorage.setItem('admin', '1');
    document.getElementById('admin-area').classList.remove('hidden');
    document.getElementById('admin-toggle').classList.add('hidden');
  } else {
    alert('密碼錯誤');
  }
}

// ── 全球指數距年高（P2-7）──────────────────────────────────────
// ⚠ Worker 部署後把網址填進 INDEX_PROXY（見 repo 內 worker/index-proxy.js 的部署指引）
const INDEX_PROXY = "https://stockweb-proxy.ch41083s.workers.dev";
// 小台即時專用第二代理（Deno Deploy，mis.taifex 在 CF 後面故不能用上面的 CF Worker）。
// ⚠ 部署 worker/taifex-proxy-deno.js 後把 *.deno.dev 網址填這裡；留空則小台自動退回後端日更值。
const TAIFEX_PROXY = "https://taifex-proxy.val.run"; // Val Town 微代理（小台即時，mis.taifex 在 CF 後面故不能用主 Worker）

// 顯示順序：櫃買 OTC 緊接台股加權之下（Ball 2026-07-12）
const IDX_TARGETS = [
  { name: "韓國 KOSPI", t: "y", sym: "^KS11" },
  { name: "日經 225",   t: "y", sym: "^N225" },
  { name: "台股加權",   t: "y", sym: "^TWII" },
  { name: "櫃買 OTC",   t: "otc" },
  { name: "那斯達克期", t: "y", sym: "NQ=F" },
  { name: "道瓊",       t: "y", sym: "^DJI" },
  { name: "S&P 500",    t: "y", sym: "^GSPC" },
  { name: "費城半導體", t: "y", sym: "^SOX" },
  { name: "台指期 小台", t: "mxf" },
];

function idxColor(pct) {   // 台灣慣例紅多：貼近年高=紅、深回檔=綠
  if (pct == null) return "text-gray-500";
  if (pct >= -3) return "text-red-400";
  if (pct >= -10) return "text-yellow-400";
  return "text-green-400";
}
function idxNum(n) { return (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function idxTime(v) {
  // 統一台灣時間「上午/下午 HH:MM」12小時制（Yahoo=epoch、OTC/小台=HH:MM字串，全部一致）
  if (v == null) return "—";
  let hh, mm;
  if (typeof v === "number") {
    const tw = new Date(new Date(v * 1000).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    hh = tw.getHours(); mm = tw.getMinutes();
  } else {
    const m = String(v).match(/(\d{1,2}):(\d{2})/);
    if (!m) return String(v).slice(0, 5);
    hh = +m[1]; mm = +m[2];
  }
  return `${hh < 12 ? '上午' : '下午'}${String(hh % 12 || 12).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
async function idxFetch(path, opts) {
  const signal = AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined;
  const r = await fetch(INDEX_PROXY + path, { ...(opts || {}), signal });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
async function idxYahoo(t) {
  const j = await idxFetch(`/yahoo/${encodeURIComponent(t.sym)}?range=ytd&interval=1d`);
  const res = j.chart.result[0];
  const price = res.meta.regularMarketPrice;
  const highs = (res.indicators.quote[0].high || []).filter(x => x != null);
  return { name: t.name, price, yearHigh: Math.max(price, ...highs), time: res.meta.regularMarketTime };
}
async function idxOtc(iy) {
  const j = await idxFetch(`/twse?ex_ch=otc_o00.tw&json=1&delay=0`);
  const a = j.msgArray[0];
  const price = parseFloat(a.z), todayHigh = parseFloat(a.h);
  return { name: "櫃買 OTC", price, yearHigh: Math.max(iy?.otc?.high || 0, todayHigh || 0, price), time: a.t };
}
// 小台近月符號：MXF+月碼(A=1月…L=12月)+年尾碼+盤別(-F日盤/-M夜盤)；過結算日跳下月
function mxfSymbol(settlementStr) {
  const now = new Date();
  const tw = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  let y = tw.getFullYear(), m = tw.getMonth() + 1;
  if (settlementStr && now > new Date(settlementStr + "T13:30:00+08:00")) { m++; if (m > 12) { m = 1; y++; } }
  const hm = tw.getHours() * 100 + tw.getMinutes();
  const night = !(hm >= 845 && hm < 1345);   // 日盤 08:45–13:45 用 -F，否則夜盤 -M
  return { sym: `MXF${"ABCDEFGHIJKL"[m - 1]}${String(y).slice(-1)}${night ? "-M" : "-F"}`, night };
}
// 小台：先試 Deno 即時代理（mis.taifex 在 CF 後面、主 Worker 打不到）；失敗或未設定則退後端日更值
async function idxMxf(iy, settlementStr) {
  if (TAIFEX_PROXY) {
    try {
      const { sym, night } = mxfSymbol(settlementStr);
      const signal = AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined;
      const j = await fetch(TAIFEX_PROXY + "/taifex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ SymbolID: [sym] }), signal }).then(r => r.json());
      let d = null;
      const scan = o => { if (!o || d) return; if (Array.isArray(o)) o.forEach(scan); else if (typeof o === "object") { if (o.CLastPrice != null) d = o; else Object.values(o).forEach(scan); } };
      scan(j);
      if (d && d.CLastPrice != null && parseFloat(d.CLastPrice) > 0) {
        const price = parseFloat(d.CLastPrice), todayHigh = parseFloat(d.CHighPrice);
        const ct = String(d.CTime || '').padStart(6, '0');   // HHMMSS → HH:MM
        return { name: "台指期 小台" + (night ? "（夜盤）" : ""), price, yearHigh: Math.max(iy?.mxf?.high || 0, todayHigh || 0, price), time: ct.slice(0, 2) + ':' + ct.slice(2, 4) };
      }
    } catch (e) { /* 退 fallback */ }
  }
  // fallback：後端 index_ytd.mxf 日更值（MTX 最新收盤）
  const m = iy && iy.mxf;
  if (!m || m.last == null || m.high == null) throw new Error("no mxf");
  return { name: "台指期 小台", price: m.last, yearHigh: m.high, time: (m.date || "").slice(5) + " 收", daily: true };
}
async function loadIndexYtd() {
  const body = document.getElementById("idx-body"), note = document.getElementById("idx-note");
  if (!body) return;
  if (!INDEX_PROXY) {
    body.innerHTML = `<tr><td colspan="5" class="text-gray-500 py-2 text-center text-xs">尚未設定 Worker 代理（見 worker/index-proxy.js 部署指引）</td></tr>`;
    return;
  }
  let iy = null, settlement = null;
  try { const t = await fetch("taifex_data.json?_=" + Date.now()).then(r => r.json()); iy = t.index_ytd; settlement = t.settlement_date; } catch (e) {}
  const tasks = IDX_TARGETS.map(t =>
    t.t === "y" ? idxYahoo(t) : t.t === "otc" ? idxOtc(iy) : idxMxf(iy, settlement));
  const results = await Promise.allSettled(tasks);
  body.innerHTML = results.map((r, i) => {
    const nm = IDX_TARGETS[i].name;
    if (r.status !== "fulfilled") return `<tr class="border-b border-gray-800"><td class="py-1 text-gray-300">${nm}</td><td colspan="4" class="text-right text-gray-600 text-xs">—</td></tr>`;
    const d = r.value, pct = d.yearHigh > 0 ? (d.price - d.yearHigh) / d.yearHigh * 100 : null;
    return `<tr class="border-b border-gray-800">
      <td class="py-1 text-gray-300">${nm}${d.daily ? '<span class="text-gray-600 text-[10px]">日</span>' : ''}</td>
      <td class="text-right text-gray-200">${idxNum(d.price)}</td>
      <td class="text-right font-bold ${idxColor(pct)}">${pct == null ? "—" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}</td>
      <td class="text-right text-gray-500">${idxNum(d.yearHigh)}</td>
      <td class="text-right text-gray-600 text-xs">${d.daily ? d.time : idxTime(d.time)}</td></tr>`;
  }).join("");
  if (note) note.textContent = "距年高＝(現價−年高)/年高；紅=貼近年高、綠=深回檔。年高：Yahoo=YTD盤中高、OTC=後端維護；小台走 Val Town 代理即時，未設/失敗時退後端日更收盤(標「日」)。";
}
let idxTimer = null;
function scheduleIndexRefresh() {
  if (idxTimer) clearInterval(idxTimer);
  idxTimer = setInterval(() => { if (!document.hidden) loadIndexYtd(); }, 60000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadIndexYtd(); });
document.getElementById("idx-refresh")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget, orig = btn.textContent;
  btn.textContent = "更新中…"; btn.disabled = true; btn.classList.add("opacity-60");
  try { await loadIndexYtd(); } finally {
    btn.textContent = "↻ 已更新 " + new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    btn.disabled = false; btn.classList.remove("opacity-60");
    setTimeout(() => { btn.textContent = orig; }, 2500);   // 2.5秒後還原按鈕字樣
  }
});

// ── P2-11 自選股（localStorage 每裝置一份、不上傳；只存清單本身）──────────
const WATCH_KEY = 'watchlist_v1', WATCH_NOTICE = 'watchlist_notice_v1', WATCH_MAX = 50;
function getWatch() {
  try { const a = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.id) : []; }
  catch (e) { return []; }   // 壞資料棄用重建
}
function setWatch(a) { localStorage.setItem(WATCH_KEY, JSON.stringify(a.slice(0, WATCH_MAX))); }
function renderWatchlist() {
  const box = document.getElementById('watch-list'); if (!box) return;
  window.STOCKS_BY_ID = window.STOCKS_BY_ID || {};   // 初始化時可能早於 loadStocks 的 await，先保證存在
  const a = getWatch();
  a.forEach(s => { if (!STOCKS_BY_ID[s.id]) STOCKS_BY_ID[s.id] = s; });  // 讓彈窗 mkt/後綴 fallback 有值
  if (!a.length) { box.innerHTML = '<div class="text-gray-600 text-sm py-2">尚無自選股，輸入股號按＋新增</div>'; return; }
  box.innerHTML = a.map(s => `
    <div class="flex items-center bg-gray-800 hover:bg-gray-700 rounded-lg transition">
      <button onclick="openModal('${s.id}','${s.name}')" class="flex-1 text-left px-4 py-3 flex items-center justify-between gap-2">
        <span><span class="font-bold text-gray-300">${s.id}</span><span class="ml-2 text-gray-300">${s.name}</span></span>
        <span data-chg="${s.id}" class="text-xs text-gray-500 whitespace-nowrap">${_chgCell(s.id)}</span></button>
      <button onclick="watchlistRemove('${s.id}')" class="px-3 py-3 text-gray-500 hover:text-red-400" title="移除">✕</button>
    </div>`).join('');
}
// 經 Worker 驗證股號存在＋取「中文」股名/市場別
// 用 mis.twse getStockInfo（回中文簡稱 n；Yahoo 的 shortName 台股常是英文）；先試上市 tse 再上櫃 otc
async function _resolveStock(id) {
  for (const [ch, mkt] of [['tse', 'twse'], ['otc', 'tpex']]) {
    try {
      const j = await idxFetch(`/twse?ex_ch=${ch}_${id}.tw&json=1&delay=0`);
      const a = j.msgArray && j.msgArray[0];
      if (a && a.n) return { id, name: a.n, mkt };
    } catch (e) { /* 試下一個市場 */ }
  }
  throw new Error('查無此股號');
}
async function watchlistAdd() {
  const inp = document.getElementById('watch-input'); const id = (inp.value || '').trim();
  if (!id) return;
  if (!localStorage.getItem(WATCH_NOTICE)) showWatchNotice();   // 首次提示一次
  const a = getWatch();
  if (a.some(x => x.id === id)) { alert('已在自選清單'); return; }
  if (a.length >= WATCH_MAX) { alert(`自選股已達 ${WATCH_MAX} 支上限，請先移除`); return; }
  if (typeof INDEX_PROXY === 'undefined' || !INDEX_PROXY) { alert('代理未設定，暫無法驗證股號'); return; }
  try { a.push(await _resolveStock(id)); setWatch(a); renderWatchlist(); loadListChanges(); inp.value = ''; }
  catch (e) { alert('查無此股號'); }
}
function watchlistRemove(id) { setWatch(getWatch().filter(x => x.id !== id)); renderWatchlist(); }
function watchlistClear() { if (confirm('確定清空自選股？')) { localStorage.removeItem(WATCH_KEY); renderWatchlist(); } }
function watchlistExport() {
  const s = getWatch().map(x => x.id).join(',');
  if (!s) { alert('自選清單為空'); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject())
    .then(() => alert('已複製股號到剪貼簿：\n' + s)).catch(() => prompt('複製以下股號：', s));
}
async function watchlistImport() {
  const s = prompt('貼上股號（逗號分隔，如 2330,2483）：'); if (!s) return;
  const ids = s.split(/[,\s，]+/).map(x => x.trim()).filter(Boolean);
  let added = 0;
  for (const id of ids) {
    const a = getWatch();
    if (a.length >= WATCH_MAX) { alert(`已達 ${WATCH_MAX} 支上限，其餘略過`); break; }
    if (a.some(x => x.id === id)) continue;
    try { a.push(await _resolveStock(id)); setWatch(a); added++; } catch (e) { /* 略過查無 */ }
  }
  renderWatchlist(); loadListChanges(); alert(`匯入完成，新增 ${added} 支`);
}
function showWatchNotice() {
  localStorage.setItem(WATCH_NOTICE, '1');
  alert('關於自選股的小說明\n\n你的自選清單只存在這台裝置的瀏覽器裡（就像網站記住深色模式偏好那樣）：\n'
    + '• 不會上傳到任何伺服器，沒有任何人看得到你的清單\n'
    + '• 佔用空間極小（幾 KB，不到一張照片的百分之一），不影響瀏覽器速度\n'
    + '• 隨時可刪：每支股票可單獨移除，也可以一鍵清空\n'
    + '• 提醒：換裝置或清除瀏覽器資料時，清單不會跟著走——需要的話用「匯出」把清單複製保存');
}
// 頁籤 ↔ 橫滑同步
function setStockTab(i) {
  document.querySelectorAll('#stock-tabs button').forEach((b, j) => {
    b.className = `flex-1 py-1 rounded text-sm ${j === i ? 'bg-gray-700 font-bold' : 'bg-gray-800'} ${['text-red-400', 'text-green-400', 'text-gray-300'][j]}`;
  });
}
function gotoStockPage(i) {
  const pages = document.getElementById('stock-pages'); if (!pages || !pages.children[i]) return;
  // 只捲水平容器（不用 scrollIntoView，避免連垂直位置一起捲＝頁面往下跑）；offsetLeft 差含 gap
  pages.scrollTo({ left: pages.children[i].offsetLeft - pages.children[0].offsetLeft, behavior: 'smooth' });
  setStockTab(i);
}
function initStockPages() {
  const pages = document.getElementById('stock-pages'); if (!pages) return;
  let raf = null;
  pages.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const i = Math.round(pages.scrollLeft / pages.clientWidth);
      setStockTab(Math.max(0, Math.min(2, i)));
    });
  });
}

loadStocks().then(loadListChanges);   // 清單渲染後再漸進補漲跌幅（自選列同批掃入）
loadMarketInfo();
loadIndexYtd();
renderWatchlist();
initStockPages();
scheduleAutoRefresh();
scheduleIndexRefresh();
