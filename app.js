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

async function loadMarketInfo() {
  const date = getTwseDate();
  await Promise.all([
    loadInstitutes(date),
    loadOptions(date),
  ]);
}

// 三大法人總買賣超
async function loadInstitutes(date) {
  try {
    const url = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${date}&weekDate=&monthDate=&type=day&response=json`;
    const res = await fetch(url);
    const json = await res.json();

    // data 每列：單位名稱、買進金額、賣出金額、買賣差額
    if (!json.data) throw new Error('no data');

    const find = (keyword) => {
      const row = json.data.find(r => r[0].includes(keyword));
      return row ? parseFloat(row[3].replace(/,/g, '')) / 100000000 : null; // 元 → 億
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

    // 更新資料日期
    const dateStr = json.date || date;
    const fmt = dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    document.getElementById('market-date').textContent =
      `資料日期：${fmt}（收盤後更新，若顯示 -- 表示今日尚未更新）`;

  } catch (e) {
    ['inst-foreign','inst-trust','inst-dealer','inst-total'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
  }
}

// 台指選擇權 BC/SC/BP/SP 未平倉
async function loadOptions(date) {
  try {
    const url = `https://www.taifex.com.tw/cht/3/callsAndPutsDown?queryType=1&marketCode=0&dateaddcnt=&queryDate=${date.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3')}&commodity_id=TXO`;
    const res = await fetch(url);
    const text = await res.text();

    // 解析 CSV
    const lines = text.trim().split('\n').map(l => l.split(',').map(s => s.replace(/"/g, '').trim()));

    // 找 Call / Put 的買方/賣方未平倉
    // 欄位順序：日期, 契約, 買賣權, 到期月份, 履約價, 買方口數, 買方金額, 賣方口數, 賣方金額, ...
    let bc = 0, sc = 0, bp = 0, sp = 0;
    for (const row of lines) {
      if (row.length < 8) continue;
      const type = row[2]; // Call / Put
      const buyOI  = parseInt(row[5]?.replace(/,/g, '') || '0') || 0;
      const sellOI = parseInt(row[7]?.replace(/,/g, '') || '0') || 0;
      if (type === 'Call') { bc += buyOI; sc += sellOI; }
      if (type === 'Put')  { bp += buyOI; sp += sellOI; }
    }

    const callNet = bc - sc;
    const putNet  = bp - sp;

    const setOpt = (id, val, positiveIsRed = true) => {
      const el = document.getElementById(id);
      el.textContent = val.toLocaleString();
      if (id.endsWith('net')) {
        el.className = (positiveIsRed ? val >= 0 : val < 0)
          ? 'text-red-400 font-bold' : 'text-green-400 font-bold';
      }
    };

    setOpt('opt-bc', bc);
    setOpt('opt-sc', sc);
    setOpt('opt-bp', bp);
    setOpt('opt-sp', sp);
    setOpt('opt-call-net', callNet);
    setOpt('opt-put-net',  putNet);

  } catch (e) {
    ['opt-bc','opt-sc','opt-bp','opt-sp','opt-call-net','opt-put-net'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
  }
}

loadStocks();
loadMarketInfo();
