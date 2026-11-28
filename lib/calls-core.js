// Oxva calls: one call per token every four hours, graded against the price afterwards.
// Pure logic, no storage: the Netlify functions load and save the document this module returns.
//
// A call is the market read (read-core.js) plus the contract checks (gate-core.js), turned into:
//   action      BUY | SELL | WAIT | AVOID
//   entry       price zone where the call makes sense
//   invalidation price at which the call is wrong (BUY/SELL only)
//   conviction  1..5
//   risk        the one thing that would change the call
'use strict';
const G = require('../src/assets/gate-core.js');
const R = require('../src/assets/read-core.js');

// Robinhood Chain first: Robinhood's official stock tokens ("• Robinhood Token") and the busiest
// native tokens, checked against the explorer; look-alike tokens with fake liquidity are left out.
const UNIVERSE = [
  { sym: 'NVDA', a: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', c: 'robinhood' },
  { sym: 'TSLA', a: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', c: 'robinhood' },
  { sym: 'AAPL', a: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', c: 'robinhood' },
  { sym: 'META', a: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', c: 'robinhood' },
  { sym: 'MSTR', a: '0xec262a75e413fAfD0dF80480274532C79D42da09', c: 'robinhood' },
  { sym: 'CRCL', a: '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5', c: 'robinhood' },
  { sym: 'PONS', a: '0x39dBED3a2bd333467115dE45665cC57F813C4571', c: 'robinhood' },
  { sym: 'WALLET', a: '0x0339f5459FC690aC85F1782e15782A151b4A9E1b', c: 'robinhood' },
  { sym: 'PEPE', a: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', c: 'ethereum' },
  { sym: 'LINK', a: '0x514910771AF9Ca656af840dff83E8264EcF986CA', c: 'ethereum' },
  { sym: 'UNI', a: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', c: 'ethereum' },
  { sym: 'AAVE', a: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', c: 'ethereum' },
  { sym: 'AERO', a: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', c: 'base' },
  { sym: 'CAKE', a: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', c: 'bsc' }
];

const HOUR = 36e5;
const RULES = {
  slotHours: 4,      // one batch of calls per slot
  gradeHours: 72,    // a call is graded for three days, then closed with its last status
  minGradeMinutes: 30, // a call stays "open" until it has had time to move
  keepDays: 14,      // older calls move from the live document to the monthly archive (retire); none are deleted
  priceMaxAgeMin: 10,// prices older than this are refreshed when someone opens the page
  bandMin: 0.6,      // entry zone half-width, percent
  bandMax: 5,
  bandFactor: 0.35,  // band = recent volatility x this
  invalidationBands: 2.5,
  minInvalidationPct: 3, // never closer than this: tighter stops were hit by ordinary swings within hours
  chaseUnits: 1.5        // a BUY/SELL after a 24h move this many "strong" moves big becomes WAIT (no chasing)
};
const ACTION = { up: 'BUY', down: 'SELL', flat: 'WAIT', stop: 'AVOID' };
// a running call keeps at most this many "read the same way again" slots: one per slot of its grading window
const SEEN_MAX = Math.ceil(RULES.gradeHours / RULES.slotHours);

const slotOf = (t) => Math.floor(t / (RULES.slotHours * HOUR)) * RULES.slotHours * HOUR;
const round = (n) => (n == null ? null : +n.toPrecision(6));
const lc = (s) => String(s || '').toLowerCase();

function basePrice(pairs, address) {
  const p = (pairs || []).find((x) => lc(x.baseToken && x.baseToken.address) === lc(address) && parseFloat(x.priceUsd) > 0);
  return p ? parseFloat(p.priceUsd) : null;
}

/** Build one call from gathered data (OxvaGateCore.gather output). */
function makeCall(token, data, now) {
  const safety = G.evaluate(data, now);
  const m = R.market(data.pairs);
  const out = R.combine(m, safety);
  const price = basePrice(data.pairs, token.a);
  if (price == null) return null;

  const ch = (k) => Math.abs((m.windows && m.windows.find((w) => w.key === k) || {}).change || 0);
  const vol = Math.max(ch('h1') * 2, ch('h6'), ch('h24') / 2);
  const band = Math.min(RULES.bandMax, Math.max(RULES.bandMin, vol * RULES.bandFactor));
  let action = ACTION[out.tone], reason = out.reason, risk = out.catch, conviction = out.conviction || 1;
  // no chasing: after a very large 24h move in the call's direction, wait instead (25 Nov: every SELL after an 8% drop was invalidated by the bounce)
  const day = (m.windows || []).find((w) => w.key === 'h24') || {};
  const strongDay = R.WINDOWS.find((w) => w.key === 'h24').strong * (R.isStock(data.pairs && data.pairs[0]) ? R.RULES.stockScale : 1);
  if ((action === 'BUY' || action === 'SELL') && day.change != null && (action === 'BUY' ? day.change : -day.change) >= RULES.chaseUnits * strongDay) {
    reason += ' Already ' + (day.change > 0 ? 'up ' : 'down ') + Math.abs(day.change).toFixed(1) + '% in 24 hours, so Oxva waits instead of chasing the move.';
    risk = 'Moves this large often snap back. Oxva reads it again in four hours.';
    action = 'WAIT'; conviction = 1;
  }
  const stopPct = Math.max(RULES.minInvalidationPct, RULES.invalidationBands * band);
  const inval = action === 'BUY' ? price * (1 - stopPct / 100)
    : action === 'SELL' ? price * (1 + stopPct / 100) : null;
  const slot = slotOf(now);

  return {
    id: token.sym + '-' + new Date(slot).toISOString().slice(0, 13).replace(/[-T]/g, ''),
    sym: safety.token.symbol || token.sym,
    name: safety.token.name,
    chain: data.chain,
    address: token.a,
    slot,
    at: now,
    action,
    conviction,
    price: round(price),
    entry: [round(price * (1 - band / 100)), round(price * (1 + band / 100))],
    invalidation: round(inval),
    reason,
    risk,
    contract: safety.verdict.level,
    score: +m.score.toFixed(3),
    liquidity: Math.round(m.liquidity || 0),
    status: action === 'BUY' || action === 'SELL' ? 'open' : 'watching',
    final: false,
    now: { price: round(price), at: now, move: 0 }
  };
}

/** Grade a call against the current price. Invalidation is sticky. Returns a new object. */
function grade(call, priceNow, now) {
  if (call.final || priceNow == null) return call;
  if (now - call.at < RULES.minGradeMinutes * 60e3) return call; // too early to say anything
  const c = Object.assign({}, call, { now: { price: round(priceNow), at: now, move: +((priceNow - call.price) / call.price * 100).toFixed(2) } });
  if (c.action === 'BUY') c.status = priceNow <= c.invalidation ? 'invalidated' : priceNow >= c.price ? 'working' : 'against';
  else if (c.action === 'SELL') c.status = priceNow >= c.invalidation ? 'invalidated' : priceNow <= c.price ? 'working' : 'against';
  else c.status = 'watching';
  if (c.status === 'invalidated' || now - c.at >= RULES.gradeHours * HOUR) c.final = true;
  return c;
}

/** The counts behind the track record; graded means a BUY or SELL that is past "open". */
const TALLY = ['total', 'graded', 'working', 'against', 'invalidated', 'waits', 'avoids'];
function tally(calls) {
  const graded = calls.filter((c) => (c.action === 'BUY' || c.action === 'SELL') && c.status !== 'open');
  const n = (s) => graded.filter((c) => c.status === s).length;
  return {
    total: calls.length,
    graded: graded.length,
    working: n('working'), against: n('against'), invalidated: n('invalidated'),
    waits: calls.filter((c) => c.action === 'WAIT').length,
    avoids: calls.filter((c) => c.action === 'AVOID').length
  };
}

/** Track record over every call ever made: the live calls plus the counts of the archived ones (doc.retired). */
function record(calls, retired) {
  const t = tally(calls), r = retired || {};
  const sum = {};
  TALLY.forEach((k) => { sum[k] = t[k] + (r[k] || 0); });
  sum.hitRate = sum.graded ? +(sum.working / sum.graded * 100).toFixed(1) : null;
  return sum;
}

const monthOf = (t) => new Date(t).toISOString().slice(0, 7); // "2026-11", UTC

// The rules changed twice. The record is also shown per rule version, so a change is never hidden in one number.
// A call belongs to the version in force when it was made. Add a version here whenever the call rules change.
const RULE_VERSIONS = [
  { v: 1, from: 0, label: 'First rules' },
  { v: 2, from: Date.UTC(2026, 10, 23, 12), label: 'Stock tokens judged by stock-sized moves' },
  { v: 3, from: Date.UTC(2026, 10, 26, 16), label: 'No chasing, a 3% minimum stop, one live call per token' }
];
const versionOf = (t) => RULE_VERSIONS.reduce((v, r) => (t >= r.from ? r.v : v), 1);
const isTrade = (c) => c.action === 'BUY' || c.action === 'SELL';
const median = (a) => { if (!a.length) return null; const x = a.slice().sort((p, q) => p - q), m = x.length >> 1; return +(x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2).toFixed(1); };

/** Archived counts per rule version. A document from before versions were tracked has only v1 calls archived. */
function retiredByVersion(doc) { return (doc && doc.retiredBy) || (doc && doc.retired ? { 1: doc.retired } : {}); }

/**
 * What the hit rate means: the record split by rule version, how many buy/sell calls are still running, how fast stops
 * were hit, how long a call lasts, and since when the record runs. Shown next to the hit rate, never instead of it.
 */
function context(doc, now) {
  const calls = (doc && doc.calls) || [];
  const byV = retiredByVersion(doc);
  const versions = RULE_VERSIONS.map((r, i) => {
    const mine = calls.filter((c) => versionOf(c.at) === r.v);
    const t = tally(mine), rb = byV[r.v] || {}, sum = {};
    TALLY.forEach((k) => { sum[k] = t[k] + (rb[k] || 0); });
    sum.hitRate = sum.graded ? +(sum.working / sum.graded * 100).toFixed(1) : null;
    sum.running = mine.filter((c) => isTrade(c) && !c.final).length;
    return Object.assign({ v: r.v, label: r.label, from: r.from || null, to: RULE_VERSIONS[i + 1] ? RULE_VERSIONS[i + 1].from : null }, sum);
  });
  const trades = calls.filter(isTrade);
  const lasted = (c) => (c.now && c.now.at > c.at ? (c.now.at - c.at) / HOUR : null);
  const stops = trades.filter((c) => c.status === 'invalidated').map(lasted).filter((h) => h != null);
  const closed = trades.filter((c) => c.final).map(lasted).filter((h) => h != null);
  const months = ((doc && doc.archive) || []).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
  const firstAt = Math.min(...calls.map((c) => c.at), months.length ? Date.UTC(+months[0].slice(0, 4), +months[0].slice(5, 7) - 1, 1) : Infinity);
  return {
    versions,
    running: trades.filter((c) => !c.final).length,
    stopMedianHours: median(stops), stopsMeasured: stops.length,
    closedAvgHours: closed.length ? +(closed.reduce((a, b) => a + b, 0) / closed.length).toFixed(1) : null, closedMeasured: closed.length,
    gradeHours: RULES.gradeHours,
    since: isFinite(firstAt) ? firstAt : null,
    days: isFinite(firstAt) ? Math.max(1, Math.round((now - firstAt) / (24 * HOUR))) : null
  };
}

/**
 * Calls older than keepDays leave the live document for the monthly archive; nothing is deleted. Returns the kept
 * document and the calls to archive (marked final). Their counts are added to doc.retired, so the record still counts
 * them, and their months to doc.archive. The caller saves the archive first and the document second: if the second
 * save fails, the next run archives the same calls again (mergeArchive keeps one copy) and counts them then.
 */
function retire(doc, now) {
  const cutoff = now - RULES.keepDays * 24 * HOUR;
  const calls = (doc && doc.calls) || [];
  const out = calls.filter((c) => c.at < cutoff).map((c) => (c.final ? c : Object.assign({}, c, { final: true })));
  if (!out.length) return { doc, out };
  const add = tally(out), prev = doc.retired || {}, retired = {};
  TALLY.forEach((k) => { retired[k] = (prev[k] || 0) + add[k]; });
  // the same counts per rule version, so the per-version record keeps counting archived calls
  const retiredBy = JSON.parse(JSON.stringify(retiredByVersion(doc)));
  RULE_VERSIONS.forEach((r) => {
    const t = tally(out.filter((c) => versionOf(c.at) === r.v));
    if (!t.total) return;
    const cur = retiredBy[r.v] || {};
    TALLY.forEach((k) => { cur[k] = (cur[k] || 0) + t[k]; });
    retiredBy[r.v] = cur;
  });
  const months = new Set(doc.archive || []);
  out.forEach((c) => months.add(monthOf(c.at)));
  return { doc: Object.assign({}, doc, { calls: calls.filter((c) => c.at >= cutoff), retired, retiredBy, archive: [...months].sort() }), out };
}

/** One month of the archive with new calls added; one copy per call id, newest first. */
function mergeArchive(month, existing, calls) {
  const byId = {};
  ((existing && existing.calls) || []).concat(calls).forEach((c) => { byId[c.id] = c; });
  return { month, calls: Object.values(byId).sort((a, b) => b.at - a.at || a.sym.localeCompare(b.sym)) };
}

/**
 * One cycle. doc = { calls: [], updatedAt, slot, retired, archive } (or null).
 * - makes calls for the current slot if it has none yet
 * - regrades every open call with fresh prices
 * Old calls stay in the document; retire() moves them to the archive.
 * gatherFn(token) -> OxvaGateCore.gather output; priceFn(token) -> number | null
 */
async function cycle(doc, now, gatherFn, priceFn) {
  doc = doc && Array.isArray(doc.calls) ? doc : { calls: [], slot: 0, updatedAt: 0, errors: [] };
  const slot = slotOf(now);
  let calls = doc.calls.slice();
  const errors = [];
  const fresh = {};

  if (doc.slot !== slot) {
    const results = await Promise.all(UNIVERSE.map((t) =>
      gatherFn(t).then((d) => ({ t, d }), (e) => ({ t, e }))));
    for (const r of results) {
      if (r.e) { errors.push(r.t.sym + ': ' + (r.e.message || r.e)); continue; }
      const call = makeCall(r.t, r.d, now);
      if (!call) { errors.push(r.t.sym + ': no price'); continue; }
      fresh[lc(r.t.a)] = call.price;
      // one live call per token and direction: while a BUY (or SELL) is still being graded, the same view is not
      // called again, so one reading of the market counts once in the record, not once every four hours. The reading
      // is not dropped: the newest running call notes the slot in `seen`, so the site can show "read the same way
      // again" and the batch log can count it.
      if (call.action === 'BUY' || call.action === 'SELL') {
        const live = calls.filter((c) => !c.final && c.action === call.action && lc(c.address) === lc(call.address));
        if (live.length) {
          const keep = live.reduce((a, b) => (b.at > a.at ? b : a));
          const seen = (keep.seen || []).filter((x) => x !== slot).concat(slot).slice(-SEEN_MAX);
          calls = calls.map((c) => (c === keep ? Object.assign({}, c, { seen, seenAt: now }) : c));
          continue;
        }
      }
      calls = calls.filter((c) => c.id !== call.id);
      calls.push(call);
    }
  }

  // regrade open calls; reuse prices fetched for new calls, fetch the rest once per token
  const open = calls.filter((c) => !c.final);
  const need = [...new Set(open.map((c) => lc(c.address)).filter((a) => fresh[a] == null))];
  const fetched = await Promise.all(need.map((a) => {
    const t = UNIVERSE.find((u) => lc(u.a) === a) || { a, c: (open.find((c) => lc(c.address) === a) || {}).chain };
    return Promise.resolve(priceFn(t)).then((p) => [a, p], () => [a, null]);
  }));
  fetched.forEach(([a, p]) => { if (p != null) fresh[a] = p; });
  calls = calls.map((c) => (c.final ? c : grade(c, fresh[lc(c.address)], now)));

  calls = calls.sort((a, b) => b.at - a.at || a.sym.localeCompare(b.sym));

  // keep every other field (retired counts, archive months) as it was
  return Object.assign({}, doc, { calls, slot: errors.length === UNIVERSE.length ? doc.slot : (doc.slot === slot ? doc.slot : slot), updatedAt: now, errors: errors.length ? errors : doc.errors || [] });
}

/**
 * One row per four-hour slot over the live calls, newest first, for the status page: when the batch ran, how many
 * calls it made and of which kind. A slot with no calls that should have run (more than 30 minutes past its start)
 * is listed as missed, so a skipped batch shows instead of disappearing. Fewer than the full universe in a batch is
 * normal: a token with a live BUY or SELL that reads the same way is not called again until that call closes. Those
 * readings are counted in `seen` (noted on the running call), and a slot where every token read the same way is
 * not missed.
 */
function batches(calls, now) {
  if (!calls.length) return [];
  const step = RULES.slotHours * HOUR;
  const bySlot = {};
  calls.forEach((c) => {
    const b = bySlot[c.slot] || (bySlot[c.slot] = { slot: c.slot, at: c.at, calls: 0, BUY: 0, SELL: 0, WAIT: 0, AVOID: 0, seen: 0 });
    b.calls++; b[c.action] = (b[c.action] || 0) + 1; if (c.at < b.at) b.at = c.at;
  });
  calls.forEach((c) => (c.seen || []).forEach((s) => {
    const b = bySlot[s] || (bySlot[s] = { slot: s, at: s, calls: 0, BUY: 0, SELL: 0, WAIT: 0, AVOID: 0, seen: 0 });
    b.seen++;
  }));
  const first = Math.min(...calls.map((c) => c.slot));
  const out = [];
  for (let s = slotOf(now); s >= first; s -= step) {
    if (bySlot[s]) out.push(bySlot[s]);
    else if (now - s > 30 * 60e3) out.push({ slot: s, missed: true, calls: 0 });
  }
  return out;
}

/** What the API returns to browsers. */
function view(doc, now) {
  const calls = (doc && doc.calls) || [];
  // the latest call per token Oxva still watches (tokens taken out of the universe keep their calls in the record)
  const watched = new Set(UNIVERSE.map((u) => lc(u.a)));
  // a running call read the same way again counts from that newer reading (seenAt), so the card shows the current view
  const readAt = (c) => Math.max(c.at, c.seenAt || 0);
  const latest = {};
  calls.forEach((c) => { const a = lc(c.address); if (watched.has(a) && (!latest[a] || readAt(latest[a]) < readAt(c))) latest[a] = c; });
  return {
    updatedAt: doc ? doc.updatedAt : null,
    slot: doc ? doc.slot : null,
    nextCallAt: slotOf(now) + RULES.slotHours * HOUR,
    record: record(calls, doc && doc.retired),
    context: context(doc, now), // what the hit rate means: per rule version, still running, stops, durations
    latest: Object.values(latest).sort((a, b) => a.sym.localeCompare(b.sym)),
    calls: calls.slice(0, 120),
    // every BUY or SELL still being graded, however old: the newest 120 calls can be all WAITs and hide them
    running: calls.filter((c) => isTrade(c) && !c.final),
    archive: (doc && doc.archive) || [], // months with archived calls: GET /api/calls?archive=YYYY-MM
    // the oldest call still in the live list: it moves to the archive keepDays after it was made
    oldestLiveAt: calls.length ? Math.min(...calls.map((c) => c.at)) : null,
    batches: batches(calls, now),
    lastRunErrors: (doc && doc.errors) || [],
    universe: UNIVERSE.map((u) => ({ sym: u.sym, chain: u.c, address: u.a })),
    rules: RULES
  };
}

/** Cheap price lookup from DexScreener (deepest pool where the token is the base). */
async function dexPrice(token, fetchFn) {
  const r = await (fetchFn || fetch)('https://api.dexscreener.com/latest/dex/tokens/' + token.a, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const pairs = (d.pairs || []).filter((p) => p.chainId === token.c && lc(p.baseToken && p.baseToken.address) === lc(token.a))
    .sort((x, y) => ((y.liquidity && y.liquidity.usd) || 0) - ((x.liquidity && x.liquidity.usd) || 0));
  return pairs.length ? parseFloat(pairs[0].priceUsd) : null;
}

module.exports = { UNIVERSE, RULES, RULE_VERSIONS, versionOf, context, slotOf, monthOf, makeCall, grade, tally, record, retire, mergeArchive, batches, cycle, view, dexPrice };
