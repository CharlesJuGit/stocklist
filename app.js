let currentStockId = null;
let chipCache = {};

// 載入股票清單
async function loadStocks() {
  const res = await fetch('stocks.json');
  const data = await res.json();

  renderList('long-list', data.long, 'red');
  renderList('short-list', data.short, 'green');
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

// 抓三大法人資料
async function loadChipData(stockId, tab) {
  const cacheKey = `${stockId}-${tab}`;
  if (chipCache[cacheKey]) {
    document.getElementById(`chip-${tab}`).innerHTML = chipCache[cacheKey];
    return;
  }

  try {
    // 使用 TWSE 公開 API
    const today = getTwseDate();
    const days = tab === '1d' ? 1 : 5;
    const html = await fetchTwseChip(stockId, today, days);
    chipCache[cacheKey] = html;
    document.getElementById(`chip-${tab}`).innerHTML = html;
  } catch (e) {
    document.getElementById(`chip-${tab}`).innerHTML = '<p class="text-red-400 text-sm">資料載入失敗</p>';
  }
}

async function fetchTwseChip(stockId, date, days) {
  // 證交所三大法人 API
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
  const res = await fetch(url);
  const json = await res.json();

  if (!json.data) return '<p class="text-gray-400 text-sm">無資料</p>';

  // 找對應股票
  const row = json.data.find(r => r[0] === stockId);
  if (!row) return '<p class="text-gray-400 text-sm">查無此股票當日資料</p>';

  // row 欄位：證券代號、證券名稱、外資買、外資賣、外資買賣超、投信買、投信賣、投信買賣超、自營商買賣超
  const foreign = parseInt(row[4].replace(/,/g, ''));
  const trust   = parseInt(row[7].replace(/,/g, ''));
  const dealer  = parseInt(row[8].replace(/,/g, ''));
  const total   = foreign + trust + dealer;

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
          <td class="py-1">合計</td>
          <td class="text-right py-1 ${total >= 0 ? 'text-green-400' : 'text-red-400'}">${fmt(total)}</td>
        </tr>
      </tbody>
    </table>
    <p class="text-xs text-gray-500 mt-2">資料來源：台灣證交所　${days === 1 ? '當日' : '近5日'}</p>
  `;
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
  const dates = getRecentTradingDates(5);
  await Promise.all([
    loadInstitutes(dates),
    loadOptions(dates),
  ]);
}

// 三大法人總買賣超（自動找最近有資料的交易日）
async function loadInstitutes(dates) {
  for (const date of dates) {
    try {
      const url = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${date}&weekDate=&monthDate=&type=day&response=json`;
      const res = await fetch(url);
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

// 台指選擇權（透過 CORS proxy 繞過 TAIFEX 限制）
async function loadOptions(dates) {
  for (const date of dates) {
    try {
      const taifexDate = date.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3');
      const target = `https://www.taifex.com.tw/cht/3/callsAndPutsDown?queryType=1&marketCode=0&dateaddcnt=&queryDate=${taifexDate}&commodity_id=TXO`;
      const url = `https://corsproxy.io/?${encodeURIComponent(target)}`;
      const res = await fetch(url);
      const text = await res.text();

      const lines = text.trim().split('\n').map(l =>
        l.split(',').map(s => s.replace(/"/g, '').trim())
      );

      let bc = 0, sc = 0, bp = 0, sp = 0;
      for (const row of lines) {
        if (row.length < 8) continue;
        const type = row[2];
        const buyOI  = parseInt(row[5]?.replace(/,/g, '') || '0') || 0;
        const sellOI = parseInt(row[7]?.replace(/,/g, '') || '0') || 0;
        if (type === '買權') { bc += buyOI; sc += sellOI; }
        if (type === '賣權') { bp += buyOI; sp += sellOI; }
      }

      if (bc + sc + bp + sp === 0) continue; // 無資料，試前一日

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
      return;
    } catch (e) { continue; }
  }
  ['opt-bc','opt-sc','opt-bp','opt-sp','opt-call-net','opt-put-net'].forEach(id => {
    document.getElementById(id).textContent = '--';
  });
}

loadStocks();
loadMarketInfo();
