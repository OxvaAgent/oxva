// Tests for the live HTML (lib/live-html.mjs): node scripts/test-live.mjs
import assert from "assert";
import { render, values, esc, utc, pct } from "../lib/live-html.mjs";

const H = 36e5;
const NOW = Date.UTC(2026, 10, 27, 9, 0);
const slot = Date.UTC(2026, 10, 27, 8, 0);
const call = (o) => Object.assign({
  id: "PONS-2026112708", sym: "PONS", chain: "robinhood", address: "0x39dBED3a2bd333467115dE45665cC57F813C4571",
  slot, at: slot + 5 * 60e3, action: "BUY", conviction: 2, price: 0.0871, status: "working", final: false,
  reason: "Up 3% in 24 hours.", now: { price: 0.09, at: slot + 2 * H, move: 3.3 }
}, o);
const data = {
  updatedAt: NOW - 10 * 60e3, nextCallAt: Date.UTC(2026, 10, 27, 12, 0),
  record: { total: 477, graded: 100, working: 27, against: 9, invalidated: 64, waits: 377, avoids: 0, hitRate: 27 },
  latest: [call(), call({ id: "NVDA-1", sym: "NVDA", action: "WAIT", status: "watching", conviction: 1 })],
  calls: [call(), call({ id: "NVDA-1", sym: "NVDA", action: "WAIT", status: "watching", conviction: 1 })],
  archive: [], oldestLiveAt: Date.UTC(2026, 10, 21, 14, 31),
  batches: [{ slot, at: slot + 5 * 60e3, calls: 2, BUY: 1, SELL: 0, WAIT: 1, AVOID: 0 }, { slot: slot - 4 * H, missed: true, calls: 0 }],
  lastRunErrors: [], universe: [{ sym: "PONS", chain: "robinhood", address: "0x1" }, { sym: "PEPE", chain: "ethereum", address: "0x2" }],
  rules: { keepDays: 14 }
};

const tests = {
  "markers with a value are filled, the rest stay as they are"() {
    const html = '<b id="hs-total"><!--live:hs-total-->—<!--/live:hs-total--></b><i><!--live:nothing-->x<!--/live:nothing--></i>';
    const out = render(html, data, NOW);
    assert.ok(out.includes("<!--live:hs-total-->477<!--/live:hs-total-->"));
    assert.ok(out.includes("<!--live:nothing-->x<!--/live:nothing-->"));
  },
  "the hero shows the newest graded call and the last batch"() {
    const v = values(data, NOW);
    assert.strictEqual(v["hs-last"], "PONS BUY");
    assert.ok(v["hs-last-sub"].includes('class="mono s-working">Working'));
    assert.ok(v["hs-last-sub"].includes("+3.3% since"));
    assert.strictEqual(v["status-last"], "Last batch ran 27 Nov, 08:05 UTC · next at 12:00 UTC");
    assert.strictEqual(v["hs-tokens-sub"], "On 2 chains, every four hours");
  },
  "an empty archive says when the first month arrives"() {
    assert.ok(values(data, NOW).archive.includes("(the first on 5 Dec 2026)"));
    const v = values(Object.assign({}, data, { archive: ["2026-11", "2026-12"] }), NOW);
    assert.ok(v.archive.startsWith("Older calls, by month:"));
    assert.ok(v.archive.indexOf("Dec 2026") < v.archive.indexOf("Nov 2026"), "newest month first");
    assert.ok(v.archive.includes('href="/api/calls?archive=2026-11"'));
  },
  "the status table lists batches and marks a missed slot"() {
    const v = values(data, NOW);
    assert.ok(v["status-rows"].includes("Missed: no calls in this slot"));
    assert.ok(v["status-rows"].includes("27 Nov, 08:05 UTC"));
    assert.ok(v["status-summary"].includes("Running"));
    const late = values(data, NOW + 6 * H);
    assert.ok(late["status-summary"].includes("Late"));
  },
  "names and reasons from outside data cannot inject HTML"() {
    const evil = call({ sym: '<img src=x onerror=alert(1)>', reason: '"><script>alert(1)</script>', status: "against" });
    const v = values(Object.assign({}, data, { calls: [evil], latest: [evil] }), NOW);
    for (const k of ["hs-last", "rec-list", "latest-grid", "batches"]) {
      assert.ok(!/<img|<script/i.test(v[k]), k + " leaked markup: " + v[k].slice(0, 120));
    }
    assert.ok(v["latest-grid"].includes("&lt;img"));
  },
  "missing or odd data never throws"() {
    assert.doesNotThrow(() => render('<!--live:hs-last-->—<!--/live:hs-last-->', {}, NOW));
    assert.doesNotThrow(() => render('<!--live:status-rows--><!--/live:status-rows-->', { batches: null, record: null }, NOW));
    assert.ok(values({}, NOW)["status-summary"].includes("No batch"));
  },
  "small helpers"() {
    assert.strictEqual(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    assert.strictEqual(utc(Date.UTC(2026, 0, 5, 4, 7)), "5 Jan, 04:07 UTC");
    assert.strictEqual(pct(-1.25), "−1.3%");
    assert.strictEqual(pct(12), "+12%");
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} live html tests passed`);
process.exitCode = failed ? 1 : 0;
