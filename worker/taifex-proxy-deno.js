/**
 * taifex-proxy-deno.js — Deno Deploy 微代理：只轉小台即時報價（stockweb P2-7 ②）
 *
 * 為何需要第二個代理：mis.taifex.com.tw 本身在 Cloudflare 後面（Server: cloudflare / CF-RAY-TPE），
 * 主 Worker（Cloudflare）打它＝CF→CF 被對方 CF edge 擋（HTTP 520，改 header 無效）。
 * Deno Deploy 的 egress 不是 Cloudflare（GCP），以正常瀏覽器式請求可繞過 CF-to-CF 封鎖 → 小台恢復即時。
 * 只代理 mis.taifex 一個上游（白名單寫死）、無 secret。
 *
 * === Ball 部署指引（免費、~5 分鐘，用 GitHub 帳號登入即可）===
 *   1. 開 https://dash.deno.com → Sign in with GitHub
 *   2. 右上 New Playground（或 New Project → Playground）
 *   3. 把本檔全部內容貼進編輯器（取代預設）→ 按 Save & Deploy
 *   4. 複製上方的專案網址（形如 https://xxxx.deno.dev）
 *   5. 貼進 app.js 的 TAIFEX_PROXY 常數（結尾不要斜線）
 *
 * 測試：部署後開 https://你的專案.deno.dev/taifex 應回 JSON（含 RtData）。
 */

const UPSTREAM = "https://mis.taifex.com.tw/futures/api/getQuoteDetail";
const CORS = {
  "Access-Control-Allow-Origin": "*",            // 可改成 "https://charlesjugit.github.io" 鎖網域
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  if (url.pathname !== "/taifex") {
    return new Response("not found", { status: 404, headers: CORS });
  }

  try {
    // 前端 POST 帶 {"SymbolID":["MXFG6-F"]}；GET 給預設近月日盤方便瀏覽器測試
    const body = req.method === "POST" ? await req.text() : '{"SymbolID":["MXFG6-F"]}';
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Referer": "https://mis.taifex.com.tw/futures/",
        "Origin": "https://mis.taifex.com.tw",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-TW,zh;q=0.9",
      },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: CORS });
  }
});
