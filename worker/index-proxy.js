/**
 * index-proxy.js — Cloudflare Worker：全球指數距年高% 的 CORS 代理（stockweb P2-7）
 *
 * 為何需要：前端直連 Yahoo / mis.twse / mis.taifex 全被 CORS 擋（2026-07-07 實測）。
 * 本 Worker 只做「白名單三源」的透傳＋加 CORS 標頭＋30s 快取，無任何 secret（指數為公開資料）。
 *
 * 路由：
 *   GET  /yahoo/{symbol}?range=ytd&interval=1d   → query1.finance.yahoo.com/v8/finance/chart/{symbol}
 *   GET  /twse?ex_ch=otc_o00.tw&json=1&delay=0   → mis.twse.com.tw/stock/api/getStockInfo.jsp
 *   POST /taifex   (body: {"SymbolID":["MXFG6-F"]}) → mis.taifex.com.tw/futures/api/getQuoteDetail
 *   GET  /div/{twse-yield|tpex-yield|twse-exdiv|tpex-exdiv}  → 官方 openapi 殖利率／除權息預告（P2-20，快取 1h）
 *
 * === Ball 部署指引（約 10 分鐘，免費、不需信用卡）===
 *   1. 註冊 https://dash.cloudflare.com （免費帳號）
 *   2. 左側 Workers & Pages → Create → Create Worker → 命名（如 stockweb-proxy）→ Deploy
 *   3. Edit code → 貼上本檔全部內容 → Save and Deploy
 *   4. 複製 *.workers.dev 網址，填進 app.js 的 INDEX_PROXY 常數（見該處註解）
 *   5. （建議）把下方 ALLOW_ORIGIN 改成你的 GitHub Pages 網域鎖定，再 Deploy 一次
 */

// 建議鎖成 GitHub Pages 網域（如 "https://charlesju.github.io"）；先用 "*" 可立即上線（公開資料無外洩疑慮）
const ALLOW_ORIGIN = "*";
const CACHE_TTL = 30; // 秒；配前端 60s 自動刷新，保護上游防限流

const UPSTREAM = {
  yahoo:  "https://query1.finance.yahoo.com/v8/finance/chart/",
  twse:   "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
  taifex: "https://mis.taifex.com.tw/futures/api/getQuoteDetail",
};

// P2-20：殖利率／除權息預告（官方 openapi，四表皆**無 CORS**，2026-07-19 實測）
// 四表都是「日更全表」→ Worker 端快取 1 小時（DIV_TTL），前端再 session 快取，一天只打幾次。
const DIV_TTL = 3600;
const DIV_UPSTREAM = {
  "twse-yield":  "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",           // 1,079 筆 Code/DividendYield
  "tpex-yield":  "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis", // 889 筆 SecuritiesCompanyCode/YieldRatio/DividendPerShare
  "twse-exdiv":  "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL",           // 224 筆 Code/Date(民國)/Exdividend
  // 上市股利分派（1,137 筆／1,107 家）：期別「年度」1005 家＝官方年配息；「第1季/第4季/下半年」132 筆＝分期配息金額。
  // ⚠ 上櫃對應表 mopsfin_t187ap39_O **已停更 5 年**（全表出表日 1100804、資料到股利年度 107）→ 不採用，上櫃只顯示年配息。
  "twse-divpay": "https://openapi.twse.com.tw/v1/opendata/t187ap45_L",
  "tpex-exdiv":  "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost",            // 259 筆 SecuritiesCompanyCode/ExRrightsExDividendDate(民國)/ExRrightsExDividend
};

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

async function proxy(upstreamUrl, init, useCache, ttl = CACHE_TTL) {
  const req = new Request(upstreamUrl, init);
  const cache = caches.default;
  if (useCache) {
    const hit = await cache.match(req);
    // 🐛 修（2026-07-19 P2-20 驗收時發現的既有 production bug）：
    // 以前這裡直接 `return hit`，但 hit 可能是 **Cloudflare 邊緣快取的上游原始回應**
    // （cf.cacheEverything 用同一個 key 快取上游）→ **沒有我們加的 CORS 標頭**，瀏覽器會擋掉。
    // 實證：/yahoo 第一次 CORS=*，快取命中後 CORS=None 且 Cache-Control 變成 Yahoo 自己的
    // max-age=10, stale-while-revalidate=20。命中時一律重新包上 CORS 再回。
    if (hit) {
      return new Response(hit.body, {
        status: hit.status,
        headers: cors({
          "Content-Type": hit.headers.get("Content-Type") || "application/json",
          "Cache-Control": `public, max-age=${ttl}`,
        }),
      });
    }
  }
  const fetchInit = {
    ...init,
    // 預設 UA 可被 init.headers 覆寫（TPEx 對非瀏覽器 UA 會 302 導 /errors，見 /div 路由）
    headers: { "User-Agent": "Mozilla/5.0 (stockweb-proxy)", ...(init.headers || {}) },
  };
  if (useCache) fetchInit.cf = { cacheTtl: ttl, cacheEverything: true }; // POST 不可快取，加了會 520
  const upstream = await fetch(upstreamUrl, fetchInit);
  const body = await upstream.arrayBuffer();
  const resp = new Response(body, {
    status: upstream.status,
    headers: cors({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": `public, max-age=${ttl}`,
    }),
  });
  if (useCache && upstream.ok) {
    // 背景寫入快取（不阻塞回應）
    caches.default.put(req, resp.clone());
  }
  return resp;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // GET /yahoo/{symbol}?range=…&interval=…
      if (path.startsWith("/yahoo/")) {
        const symbol = decodeURIComponent(path.slice("/yahoo/".length));
        if (!symbol) return new Response("missing symbol", { status: 400, headers: cors() });
        const u = new URL(UPSTREAM.yahoo + encodeURIComponent(symbol));
        u.search = url.search || "?range=ytd&interval=1d";
        return await proxy(u.toString(), { method: "GET" }, true);
      }

      // GET /div/{twse-yield|tpex-yield|twse-exdiv|tpex-exdiv}  （P2-20，日更全表、快取 1h）
      // ⚠ TPEx 對「非瀏覽器樣貌」的請求會 302 導向 /errors（2026-07-19 實測：CF Worker 預設 UA 被擋、
      //   TWSE 兩表同條件正常）→ 這裡帶完整瀏覽器標頭（比照 Val Town 小台代理的作法）。
      //   若帶了標頭仍 302，代表 TPEx 擋的是 Cloudflare 出口 IP，須改走 Val Town（非 CF egress）。
      if (path.startsWith("/div/")) {
        const key = path.slice("/div/".length);
        const up = DIV_UPSTREAM[key];
        if (!up) return new Response("unknown div table", { status: 400, headers: cors() });
        const browserHeaders = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "zh-TW,zh;q=0.9",
          "Referer": key.startsWith("tpex") ? "https://www.tpex.org.tw/" : "https://openapi.twse.com.tw/",
        };
        return await proxy(up, { method: "GET", headers: browserHeaders }, true, DIV_TTL);
      }

      // GET /twse?ex_ch=…
      if (path === "/twse") {
        return await proxy(UPSTREAM.twse + url.search, { method: "GET" }, true);
      }

      // POST /taifex  （透傳 JSON body）
      if (path === "/taifex" && request.method === "POST") {
        const body = await request.text();
        return await proxy(UPSTREAM.taifex, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }, false); // POST 不走 Cache API（body 不同）；上游仍受 cf.cacheTtl 影響有限，可接受
      }

      return new Response("not found", { status: 404, headers: cors() });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors() });
    }
  },
};
