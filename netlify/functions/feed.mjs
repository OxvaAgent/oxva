// GET /calls.xml: an RSS feed of Oxva's newest calls (the latest 50), so anyone can follow new calls in a feed
// reader, a bot or a script without an account. Nothing about the reader is stored.
import { loadCalls, view } from "../../lib/calls-store.mjs";

const SITE = (process.env.URL || "https://oxvaagent.com").replace(/\/+$/, "");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const price = (n) => (typeof n === "number" && isFinite(n) ? "$" + (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : Number(n.toPrecision(4))) : "—");
const STATUS = { open: "open", working: "working", against: "against", invalidated: "invalidated", watching: "watching" };

function item(c) {
  const levels = c.invalidation != null ? ` Entry ${price(c.entry && c.entry[0])}–${price(c.entry && c.entry[1])}, invalidation ${price(c.invalidation)}.` : "";
  const text = `${c.action} on ${c.sym} at ${price(c.price)}, conviction ${c.conviction}/5.${levels} ${c.reason || ""} Main risk: ${c.risk || "—"} Status: ${STATUS[c.status] || c.status}. Automated reading of public data, not financial advice.`;
  return "<item>" +
    `<title>${esc(c.sym + " " + c.action + " · conviction " + c.conviction + "/5")}</title>` +
    `<link>${esc(SITE + "/read/?t=" + c.address + "&c=" + c.chain)}</link>` +
    `<guid isPermaLink="false">${esc(c.id)}</guid>` +
    `<pubDate>${new Date(c.at).toUTCString()}</pubDate>` +
    `<description>${esc(text)}</description>` +
    "</item>";
}

export default async (req, context) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  try {
    const d = view(await loadCalls(context));
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
      "<title>Oxva calls</title>" +
      `<link>${esc(SITE)}/calls/</link>` +
      `<atom:link href="${esc(SITE)}/calls.xml" rel="self" type="application/rss+xml"/>` +
      "<description>A call on every token Oxva watches, every four hours, graded in public. Not financial advice.</description>" +
      "<language>en</language><ttl>60</ttl>" +
      (d.updatedAt ? `<lastBuildDate>${new Date(d.updatedAt).toUTCString()}</lastBuildDate>` : "") +
      d.calls.slice(0, 50).map(item).join("") +
      "</channel></rss>\n";
    return new Response(req.method === "HEAD" ? null : xml, {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "public, max-age=300",
        "netlify-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
        "access-control-allow-origin": "*"
      }
    });
  } catch (e) {
    console.error("feed failed", e);
    return new Response("The feed could not be built right now. Try again in a minute.", { status: 502 });
  }
};

export const config = { path: "/calls.xml" };
