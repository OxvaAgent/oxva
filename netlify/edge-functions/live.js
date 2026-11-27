// Puts the live record, the latest calls and the last batch time into the HTML of /, /calls/ and /status/
// (lib/live-html.mjs), so the pages show real numbers before their scripts run. The data comes from /api/calls,
// which the CDN caches for two minutes. If anything fails, the page goes out unchanged: the scripts fill it as before.
import { render } from "../../lib/live-html.mjs";

export default async (request, context) => {
  const res = await context.next();
  if (!(res.headers.get("content-type") || "").includes("text/html") || res.status !== 200) return res;
  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  try {
    const api = await fetch(new URL("/api/calls", request.url), { headers: { accept: "application/json" } });
    if (!api.ok) throw new Error("calls API " + api.status);
    const data = await api.json();
    return new Response(render(html, data, Date.now()), { status: 200, headers });
  } catch (e) {
    console.error("live html skipped:", e && e.message);
    return new Response(html, { status: 200, headers });
  }
};

export const config = { path: ["/", "/calls", "/calls/", "/status", "/status/"], onError: "bypass" };
