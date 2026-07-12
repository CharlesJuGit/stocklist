/**
 * taifex-proxy-valtown.js — Val Town HTTP val：小台即時報價代理（stockweb P2-7 ②，Deno 改綁卡的替代）
 *
 * Val Town 免費、免信用卡、瀏覽器內直接寫，egress 非 Cloudflare → 可繞過 mis.taifex 的 CF-to-CF 封鎖。
 * 只代理 mis.taifex 一個上游（白名單寫死）、無 secret。任何路徑都代理（前端打 /taifex 亦可）。
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
