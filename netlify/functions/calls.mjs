// GET /api/calls: Oxva's calls, their grades and the track record.
// Makes the current slot's calls on demand if the scheduled run has not done it yet.
// GET /api/calls?archive=YYYY-MM: every call of that month that has left the live list (after two weeks). Nothing is
// deleted: the months that exist are listed in the main response as "archive".
import { loadCalls, loadArchive, view } from "../../lib/calls-store.mjs";

const MONTH = /^20\d\d-(0[1-9]|1[0-2])$/;

export default async (req, context) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
  const month = new URL(req.url).searchParams.get("archive");
  try {
    if (month !== null) {
      if (!MONTH.test(month)) return Response.json({ error: "Use archive=YYYY-MM, for example archive=2026-11." }, { status: 400 });
      const a = await loadArchive(context, month);
      return Response.json(a || { month, calls: [] }, {
        headers: {
          "cache-control": "public, max-age=300",
          "netlify-cdn-cache-control": "public, s-maxage=600, stale-while-revalidate=3600"
        }
      });
    }
    const doc = await loadCalls(context);
    return Response.json(view(doc), {
      headers: {
        "cache-control": "public, max-age=60",
        "netlify-cdn-cache-control": "public, s-maxage=120, stale-while-revalidate=300"
      }
    });
  } catch (e) {
    console.error("calls failed", e);
    return Response.json({ error: "Could not load calls right now. Try again in a minute." }, { status: 502 });
  }
};

export const config = { path: "/api/calls" };
