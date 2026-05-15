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
function parseStockRow(row) {
  return {
    foreign: parseInt(row[4].replace(/,/g, '')) || 0,
    trust:   parseInt(row[7].replace(/,/g, '')) || 0,
    dealer:  parseInt(row[8].replace(/,/g, '')) || 0,
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
  const color = val >= 0 ? 'text-green-400' : 'text-red-400';
  return `<tr><td class="py-1 text-gray-300">${label}</td><td class="text-right py-1 ${color}">${fmt(val)}</td></tr>`;
}

function fmt(n) {
  return (n >= 0 ? '+' : '') + n.toLocaleString();
}

function getTwseDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
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
  const dates = getRecentTradingDates(10);
  await Promise.all([
    loadInstitutes(dates),
    loadOptions(),
    loadFutures(),
    loadVolatility(),
  ]);
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

// 計算下一個結算日（每月第三個星期三）
function getNextSettlementDate() {
  const today = new Date();
  let d = new Date(today.getFullYear(), today.getMonth(), 1);
  let wedCount = 0;
  while (wedCount < 3) {
    if (d.getDay() === 3) wedCount++;
    if (wedCount < 3) d.setDate(d.getDate() + 1);
  }
  // 若今天已過本月結算日，找下個月的
  if (today > d) {
    d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    wedCount = 0;
    while (wedCount < 3) {
      if (d.getDay() === 3) wedCount++;
      if (wedCount < 3) d.setDate(d.getDate() + 1);
    }
  }
  return d;
}

function daysUntilSettlement() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const settlement = getNextSettlementDate();
  settlement.setHours(0, 0, 0, 0);
  return Math.ceil((settlement - today) / (1000 * 60 * 60 * 24));
}

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
              const ratioColor = r.ratio <= 0 ? 'text-green-400' : 'text-red-400';
              const optFlag = r.opt_net > 3000 ? `<span class="text-yellow-400">+${r.opt_net.toLocaleString()}</span>` : `<span class="text-gray-500">${r.opt_net.toLocaleString()}</span>`;
              return `<tr class="border-b border-gray-800">
                <td class="text-left py-1 text-gray-300">${r.date}</td>
                <td class="${r.fut_net <= 0 ? 'text-green-400' : 'text-red-400'}">${r.fut_net.toLocaleString()}</td>
                <td>${optFlag}</td>
                <td class="text-gray-200">${r.pressure.toLocaleString()}</td>
                <td class="text-gray-400">${r.tdays}</td>
                <td class="${ratioColor} font-bold">${r.ratio.toLocaleString()}</td>
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

    const txF  = f.txF  ?? 0;
    const txT  = f.txT  ?? 0;
    const txD  = f.txD  ?? 0;
    const mtxF = f.mtxF ?? 0;
    const mtxT = f.mtxT ?? 0;
    const mtxD = f.mtxD ?? 0;

    const txRetail  = -(txF + txT + txD);
    const mtxRetail = -(mtxF + mtxT + mtxD);
    const mtxFEq    = mtxF / 4;
    const futTotal  = txF + mtxFEq;
    const retMtxEq  = mtxRetail / 4;
    const retTotal  = txRetail + retMtxEq;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      el.textContent = (val >= 0 ? '+' : '') + Math.round(val).toLocaleString();
      el.className = val >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
    };

    setVal('fut-tx',    txF);
    setVal('fut-mtx',   mtxFEq);
    setVal('fut-total', futTotal);
    setVal('ret-tx',    txRetail);
    setVal('ret-mtx',   retMtxEq);
    setVal('ret-total', retTotal);

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
    ['fut-tx','fut-mtx','fut-total','fut-days','fut-ratio','ret-tx','ret-mtx','ret-total'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
  }
}

// 三大法人總買賣超（自動找最近有資料的交易日）
async function loadInstitutes(dates) {
  for (const date of dates) {
    try {
      const url = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${date}&weekDate=&monthDate=&type=day&response=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      if (!json.data || json.data.length === 0) continue;

      const find = (keyword) => {
        const row = json.data.find(r => r[0].includes(keyword));
        return row ? parseFloat(row[3].replace(/,/g, '')) / 100000000 : null;
      };

      const foreign = find('外資及陸資(不含外資自營商)') ?? find('外資');
      const trust   = find('投信');
      const dealer  = find('自營商(自行買賣)') ?? find('自營商');
      const total   = (foreign ?? 0) + (trust ?? 0) + (dealer ?? 0);

      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (val === null) { el.textContent = '--'; return; }
        el.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + '億';
        el.className = val >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
      };

      setEl('inst-foreign', foreign);
      setEl('inst-trust',   trust);
      setEl('inst-dealer',  dealer);
      setEl('inst-total',   total);

      const fmt = date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      document.getElementById('market-date').textContent =
        `資料日期：${fmt}（收盤後更新）`;
      return;
    } catch (e) { continue; }
  }
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

    const { bc, sc, bp, sp } = o;
    if (bc + sc + bp + sp === 0) throw new Error('all zero');

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
  } catch (e) {
    console.error('loadOptions:', e);
    ['opt-bc','opt-sc','opt-bp','opt-sp','opt-call-net','opt-put-net'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
  }
}

async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = '載入中...';
  btn.disabled = true;
  chipCache = {};
  _taifexCache = null;
  _taifexPromise = null;
  await Promise.all([loadStocks(), loadMarketInfo()]);
  btn.textContent = '↻ 重新整理';
  btn.disabled = false;
}

loadStocks();
loadMarketInfo();
scheduleAutoRefresh();
