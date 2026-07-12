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

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

async function proxy(upstreamUrl, init, useCache) {
  const req = new Request(upstreamUrl, init);
  const cache = caches.default;
  if (useCache) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  const fetchInit = {
    ...init,
    headers: { ...(init.headers || {}), "User-Agent": "Mozilla/5.0 (stockweb-proxy)" },
  };
  if (useCache) fetchInit.cf = { cacheTtl: CACHE_TTL, cacheEverything: true }; // POST 不可快取，加了會 520
  const upstream = await fetch(upstreamUrl, fetchInit);
  const body = await upstream.arrayBuffer();
  const resp = new Response(body, {
    status: upstream.status,
    headers: cors({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
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
