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

loadStocks();
