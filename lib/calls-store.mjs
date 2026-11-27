// Loads the calls document from Netlify Blobs and runs a cycle when it is due.
// Production and previews use separate stores, so testing a preview never touches the real track record.
import { getStore } from "@netlify/blobs";
import C from "./calls-core.js";
import G from "../src/assets/gate-core.js";

const KEY = "doc";
const LOCK = "lock";
const LOCK_MS = 25000;

export function callsStore(context) {
  const live = context && context.deploy && context.deploy.context === "production";
  return getStore({ name: live ? "oxva-calls" : "oxva-calls-preview", consistency: "strong" });
}

export async function loadCalls(context, { force = false } = {}) {
  const store = callsStore(context);
  let doc = await store.get(KEY, { type: "json" });
  const now = Date.now();
  const due = !doc || doc.slot !== C.slotOf(now) || now - (doc.updatedAt || 0) > C.RULES.priceMaxAgeMin * 60e3;
  if (!force && !due) return doc;
  // A visitor never waits for a cycle when there is something to show: they get the stored calls at once and the
  // refresh runs after the response (it used to run first, which left the home page on placeholders for seconds).
  if (!force && doc && context && typeof context.waitUntil === "function") {
    context.waitUntil(refresh(store, doc, now).catch((e) => console.error("background calls refresh failed", e)));
    return doc;
  }
  return refresh(store, doc, now);
}

async function refresh(store, doc, now) {
  // one cycle at a time: if another request is already running one, keep what we have
  const lock = await store.get(LOCK, { type: "json" });
  if (lock && now - lock.at < LOCK_MS && doc) return doc;
  await store.setJSON(LOCK, { at: now });
  try {
    doc = await C.cycle(doc, now, (t) => G.gather(t.a, t.c), (t) => C.dexPrice(t));
    // calls older than two weeks go to the monthly archive first, then the document is saved without them
    const r = C.retire(doc, now);
    if (r.out.length) await saveArchive(store, r.out);
    doc = r.doc;
    await store.setJSON(KEY, doc);
  } finally {
    await store.delete(LOCK);
  }
  return doc;
}

// One blob per month ("archive/2026-11"), in the same store as the live document.
const archiveKey = (month) => "archive/" + month;

async function saveArchive(store, calls) {
  const byMonth = {};
  calls.forEach((c) => { (byMonth[C.monthOf(c.at)] = byMonth[C.monthOf(c.at)] || []).push(c); });
  for (const [month, list] of Object.entries(byMonth)) {
    const existing = await store.get(archiveKey(month), { type: "json" });
    await store.setJSON(archiveKey(month), C.mergeArchive(month, existing, list));
  }
}

/** One month of archived calls, or null. month is "YYYY-MM" (checked by the caller). */
export async function loadArchive(context, month) {
  return callsStore(context).get(archiveKey(month), { type: "json" });
}

export const view = (doc) => C.view(doc, Date.now());
