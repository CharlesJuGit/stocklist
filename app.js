let currentStockId = null;
let chipCache = {};

// 載入股票清單
async function loadStocks() {
  const res = await fetch('stocks.json');
  const data = await res.json();

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
      class="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-lg px-4 py-3 transition">
      <span class="font-bold text-${color}-400">${s.id}</span>
      <span class="ml-2 text-${color}-400">${s.name}</span>
    </button>
  `).join('');
}

// 開啟詳細面板
function openModal(id, name) {
  currentStockId = id;
  document.getElementById('modal-title').textContent = `${id} ${name}`;
  document.getElementById('modal').classList.remove('hidden');
  switchTab('1d');
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
  return {
    foreign: v(4) + v(7),   // 完整外資（含外資自營商），與市場層三大法人口徑一致
    trust:   v(10),          // 投信買賣超（原誤用 row[7]=外資自營商，恆為相異值）
    dealer:  v(11),          // 自營商買賣超合計（原誤用 row[8]=投信「買進量」，非淨額）
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
    loadMarketVolume(),
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
    document.getElementById('vol-twse').textContent  = last.twse?.toLocaleString() ?? '--';
    document.getElementById('vol-tpex').textContent  = last.tpex?.toLocaleString() ?? '--';
    document.getElementById('vol-total').textContent = last.total?.toLocaleString() ?? '--';
    document.getElementById('vol-date').textContent  = last.date ?? '';
  } catch (e) { console.error('loadMarketVolume:', e); }
}

function openVolumeModal() {
  loadTaifexJson().then(data => {
    const hist = data?.market_volume;
    if (!hist?.length) return;
    const rows = [...hist].reverse().map(r =>
      `<div class="flex justify-between py-1 border-b border-gray-700">
        <span class="text-gray-400">${r.date}</span>
        <span class="text-gray-300">${r.twse?.toLocaleString()}</span>
        <span class="text-gray-300">${r.tpex?.toLocaleString()}</span>
        <span class="font-bold text-yellow-300">${r.total?.toLocaleString()}</span>
      </div>`
    ).join('');
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

const STRATEGY_COLOR = { '雙買': 'text-yellow-300', '雙賣': 'text-purple-400', '看多': 'text-red-400', '看空': 'text-green-400', '中性': 'text-gray-400' };

function openStrategyModal() {
  loadTaifexJson().then(data => {
    const hist = data?.settlement_history;
    if (!hist?.length) return;
    const rows = [...hist].reverse().slice(0, 20).map(r => {
      const s = r.opt_strategy ?? '--';
      const color = STRATEGY_COLOR[s] || 'text-gray-400';
      return `<div class="flex justify-between py-1 border-b border-gray-700">
        <span class="text-gray-400">${r.date}</span>
        <span class="font-bold ${color}">${s}</span>
      </div>`;
    }).join('');
    document.getElementById('strategy-modal-body').innerHTML =
      `<div class="flex justify-between text-xs text-gray-500 mb-2 pb-1 border-b border-gray-600">
        <span>日期</span><span>外資策略</span>
      </div>` + rows;
    document.getElementById('strategy-modal').classList.remove('hidden');
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
    const recent = hist.slice(-20);
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

    document.getElementById('opt-bc').textContent = bc.toLocaleString();
    document.getElementById('opt-sc').textContent = sc.toLocaleString();
    document.getElementById('opt-bp').textContent = bp.toLocaleString();
    document.getElementById('opt-sp').textContent = sp.toLocaleString();

    const setNet = (id, val) => {
      const el = document.getElementById(id);
      el.textContent = (val >= 0 ? '+' : '') + val.toLocaleString();
      el.className = val >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
    };
    setNet('opt-call-net', callNet);
    setNet('opt-put-net',  putNet);

    // 策略判斷
    const THRESHOLD = 1000; // 淨部位絕對值低於此視為中性
    const callBias = callNet > THRESHOLD ? 'long' : callNet < -THRESHOLD ? 'short' : 'neutral';
    const putBias  = putNet  > THRESHOLD ? 'long' : putNet  < -THRESHOLD ? 'short' : 'neutral';

    let strategy, strategyDesc, strategyColor;
    if (callBias === 'long' && putBias === 'long') {
      strategy = '雙買（Long Strangle）';
      strategyDesc = '預期大波動，方向未定';
      strategyColor = 'text-yellow-400';
    } else if (callBias === 'short' && putBias === 'short') {
      strategy = '雙賣（Short Strangle）';
      strategyDesc = '預期盤整、小波動';
      strategyColor = 'text-blue-400';
    } else if (callBias === 'long' && putBias === 'short') {
      strategy = '看多（Bullish）';
      strategyDesc = '買 Call 賣 Put，偏多';
      strategyColor = 'text-red-400';
    } else if (callBias === 'short' && putBias === 'long') {
      strategy = '看空/避險（Bearish）';
      strategyDesc = '賣 Call 買 Put，偏空或避險';
      strategyColor = 'text-green-400';
    } else {
      strategy = '中性／觀望';
      strategyDesc = '淨部位接近中立';
      strategyColor = 'text-gray-400';
    }

    const el = document.getElementById('opt-strategy');
    el.textContent = `${strategy}　${strategyDesc}`;
    el.className = `text-sm font-bold ${strategyColor}`;

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

// 籌碼綜合評估
async function loadSignalSummary() {
  try {
    const data = await loadTaifexJson();
    const f = data.futures || {};
    const o = data.options || {};
    const inst = data.institute || {};
    const hist = data.settlement_history || [];
    const latest = hist.length ? hist[hist.length - 1] : null;

    const signals = [];
    let score = 0; // 正=多 負=空

    // 1. 外資現貨買賣超（高權重）
    const foreign = inst.foreign ?? null;
    if (foreign !== null) {
      const s = foreign >= 30 ? 2 : foreign >= 5 ? 1 : foreign <= -30 ? -2 : foreign <= -5 ? -1 : 0;
      score += s * 2;
      const label = foreign >= 0 ? `+${foreign}億` : `${foreign}億`;
      signals.push(`外資現貨 ${label} → ${s > 0 ? '偏多' : s < 0 ? '偏空' : '中性'}`);
    }

    // 2. 外資期貨淨部位（高權重）
    const txF  = f.txF  ?? 0;
    const mtxF = f.mtxF ?? 0;
    const futNet = txF + mtxF / 4;
    {
      const s = futNet >= 2000 ? 2 : futNet >= 500 ? 1 : futNet <= -2000 ? -2 : futNet <= -500 ? -1 : 0;
      score += s * 2;
      signals.push(`外資期貨 ${Math.round(futNet) >= 0 ? '+' : ''}${Math.round(futNet).toLocaleString()}口 → ${s > 0 ? '偏多' : s < 0 ? '偏空' : '中性'}`);
    }

    // 3. 結算比（高權重，正值代表空方壓力大）
    if (latest) {
      const ratio = latest.ratio ?? 0;
      const tdays = latest.tdays ?? 20;
      const s = ratio >= 5000 ? -2 : ratio >= 2000 ? -1 : ratio <= 500 ? 1 : 0;
      score += s * 2;
      signals.push(`結算比 ${ratio.toLocaleString()}（${tdays}日）→ ${s < 0 ? '空壓大' : s > 0 ? '壓力低' : '中性'}`);
    }

    // 4. P/C Ratio（中權重）
    const bc = o.bc ?? 0, sc = o.sc ?? 0, bp = o.bp ?? 0, sp = o.sp ?? 0;
    if (bc + sc > 0) {
      const pcr = (bp + sp) / (bc + sc);
      // 門檻與顯示用（loadOptions）一致：>1.2 偏空、<0.8 偏多，避免「顯示偏空恐慌卻不計分」
      const s = pcr > 1.2 ? -1 : pcr < 0.8 ? 1 : 0;
      score += s;
      signals.push(`P/C Ratio ${pcr.toFixed(2)} → ${s < 0 ? '偏空恐慌' : s > 0 ? '偏多追漲' : '中性'}`);
    }

    // 5. 外資選擇權方向（中權重）
    const callNet = bc - sc, putNet = bp - sp;
    if (Math.abs(callNet) > 1000 || Math.abs(putNet) > 1000) {
      const callBull = callNet > 1000, putBull = putNet > 1000;
      const s = (callBull && !putBull) ? 1 : (!callBull && putBull) ? -1 : 0;
      score += s;
      signals.push(`選擇權方向 Call${callNet >= 0 ? '+' : ''}${callNet.toLocaleString()} Put${putNet >= 0 ? '+' : ''}${putNet.toLocaleString()} → ${s > 0 ? '看多' : s < 0 ? '看空' : '雙買/雙賣'}`);
    }

    // 6. 投信買賣超（低權重）
    const trust = inst.trust ?? null;
    if (trust !== null) {
      const s = trust >= 5 ? 1 : trust <= -5 ? -1 : 0;
      score += s;
      signals.push(`投信 ${trust >= 0 ? '+' : ''}${trust}億 → ${s > 0 ? '偏多' : s < 0 ? '偏空' : '中性'}`);
    }

    // 綜合判斷
    let summary, summaryColor;
    if (score >= 5) {
      summary = '▲ 強烈偏多';  summaryColor = 'text-red-400';
    } else if (score >= 2) {
      summary = '▲ 偏多';       summaryColor = 'text-red-300';
    } else if (score <= -5) {
      summary = '▼ 強烈偏空';  summaryColor = 'text-green-400';
    } else if (score <= -2) {
      summary = '▼ 偏空';       summaryColor = 'text-green-300';
    } else {
      summary = '◆ 中性／分歧'; summaryColor = 'text-yellow-400';
    }

    // 一致性警示
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

  // 比對 JSON 最後更新時間，30分鐘內視為已是最新（避免重複觸發）
  try {
    const localData = await loadTaifexJson().catch(() => null);
    const updatedAt = localData?.updated_at;
    if (updatedAt) {
      const diffMin = (Date.now() - new Date(updatedAt).getTime()) / 60000;
      if (diffMin < 30) {
        btn.textContent = '已是最新';
        setTimeout(() => { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; }, 2000);
        return;
      }
    }
  } catch (e) {}

  // PAT 改存 sessionStorage（關閉瀏覽器即清除，降低持久暴露；代價：每個瀏覽器工作階段需重輸一次）
  let pat = sessionStorage.getItem('gh_pat') || '';
  if (!pat) {
    pat = prompt('請輸入 GitHub Personal Access Token（需要 workflow 權限）：');
    if (!pat) { btn.textContent = '⬇ 抓新資料'; btn.disabled = false; return; }
    pat = pat.trim();
    sessionStorage.setItem('gh_pat', pat);
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
      sessionStorage.removeItem('gh_pat');
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

loadStocks();
loadMarketInfo();
scheduleAutoRefresh();
