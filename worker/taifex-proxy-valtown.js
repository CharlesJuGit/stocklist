/**
 * taifex-proxy-valtown.js — Val Town HTTP val：小台即時報價代理（stockweb P2-7 ②，Deno 改綁卡的替代）
 *
 * Val Town 免費、免信用卡、瀏覽器內直接寫，egress 非 Cloudflare → 可繞過 mis.taifex 的 CF-to-CF 封鎖。
 * 代理白名單寫死、無 secret：
 *   ①（原）任何路徑 → mis.taifex 小台即時報價（前端打 /taifex）
 *   ②（2026-07-19 P2-20 新增）/div/tpex-yield、/div/tpex-exdiv → TPEx openapi 殖利率／除權息預告
 *      為何不放 CF Worker：**TPEx 會擋 Cloudflare 出口 IP**——經 CF Worker 一律 302 導 /errors，
 *      帶完整瀏覽器標頭（UA/Referer/Accept-Language）仍被擋 ⇒ 證明擋的是 IP 不是 UA（2026-07-19 兩次實測）。
 *      TWSE 兩表（openapi.twse）經 CF Worker 正常，故維持在 CF，不搬過來。
 *
 * === Ball 部署指引（免費、~3 分鐘、免綁卡）===
 *   1. 開 https://www.val.town → Sign up（可用 GitHub / Google，免信用卡）
 *   2. 右上 New → 選 "HTTP"（HTTP val）
 *   3. 把本檔全部內容貼進編輯器（取代預設的 export default）
 *   4. 它會自動存檔並給一個網址，形如 https://你的帳號-valname.web.val.run（右上/預覽區可複製）
 *   5. 把那個網址貼進 app.js 的 TAIFEX_PROXY 常數（結尾不要斜線）
 *
 * 測試：部署後瀏覽器開 https://你的帳號-valname.web.val.run/taifex 應回 JSON（含 RtData/CLastPrice）。
 */

export default async function (req) {
  const CORS = {
    "Access-Control-Allow-Origin": "*", // 可改成 "https://charlesjugit.github.io" 鎖網域
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── P2-20：TPEx 兩張日更全表（CF Worker 被 TPEx 擋 IP，故走這裡）──────────
  const TPEX = {
    "tpex-yield": "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis", // 889 筆
    "tpex-exdiv": "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost",            // 259 筆
  };
  const path = new URL(req.url).pathname;
  if (path.startsWith("/div/")) {
    const up = TPEX[path.slice("/div/".length)];
    if (!up) return new Response("unknown div table", { status: 400, headers: CORS });
    try {
      const r = await fetch(up, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "zh-TW,zh;q=0.9",
          "Referer": "https://www.tpex.org.tw/",
        },
      });
      const t = await r.text();
      return new Response(t, {
        status: r.status,
        // 日更全表 → 快取 1 小時（與 CF Worker 的 /div 一致）
        headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: CORS });
    }
  }

  try {
    // 前端 POST 帶 {"SymbolID":["MXFG6-F"]}；GET 給預設近月日盤方便瀏覽器測試
    const body = req.method === "POST" ? await req.text() : '{"SymbolID":["MXFG6-F"]}';
    const upstream = await fetch("https://mis.taifex.com.tw/futures/api/getQuoteDetail", {
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
}
