// Tests for Oxva calls (lib/calls-core.js).
//   node scripts/test-calls.js          offline tests
//   node scripts/test-calls.js --live   also runs one real cycle against the live APIs (nothing is stored)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'lib', 'calls-core.js'));
const G = require(path.join(__dirname, '..', 'src', 'assets', 'gate-core.js'));

const H = 36e5;
const NOW = Date.UTC(2026, 10, 21, 13, 30);
const T = { sym: 'TST', a: '0x1111111111111111111111111111111111111111', c: 'ethereum' };
const flow = (b, s) => ({ m5: { buys: b[0], sells: s[0] }, h1: { buys: b[1], sells: s[1] }, h6: { buys: b[2], sells: s[2] }, h24: { buys: b[3], sells: s[3] } });
function data(over) {
  const pair = Object.assign({
    chainId: 'ethereum', dexId: 'uniswap', url: 'https://dexscreener.com/ethereum/x', priceUsd: '2.00',
    baseToken: { address: T.a, name: 'Test', symbol: 'TST' }, quoteToken: { address: '0xweth', symbol: 'WETH' },
    liquidity: { usd: 3e6 }, volume: { h24: 9e5 }, fdv: 1e8, pairCreatedAt: NOW - 400 * 24 * H,
    priceChange: { m5: 0.1, h1: 0, h6: 0, h24: 0 }, txns: flow([5, 40, 200, 800], [5, 40, 200, 800])
  }, over);
  return {
    address: T.a, chain: 'ethereum', pairs: [pair], otherChains: [], errors: {},
    goplus: { is_open_source: '1', is_proxy: '0', is_honeypot: '0', buy_tax: '0', sell_tax: '0', owner_address: '0x0000000000000000000000000000000000000000',
      lp_holders: [{ address: '0x000000000000000000000000000000000000dead', percent: '0.95', is_locked: 0 }],
      holders: [{ address: '0xa', percent: '0.05', is_contract: 0, is_locked: 0 }], holder_count: '9000' },
    honeypot: { simulationSuccess: true, honeypotResult: { isHoneypot: false }, simulationResult: { buyTax: 0, sellTax: 0, transferTax: 0 } }
  };
}
const bullish = () => data({ priceChange: { m5: 1.5, h1: 6, h6: 14, h24: 25 }, txns: flow([12, 80, 400, 1500], [3, 30, 150, 600]) });
const bearish = () => data({ priceChange: { m5: -1, h1: -5, h6: -12, h24: -24 }, txns: flow([2, 20, 100, 500], [9, 70, 300, 1300]) });

// two tokens Oxva watches, and a call on one of them from a data builder
const W = C.UNIVERSE.find((u) => u.c === 'ethereum');
const W2 = C.UNIVERSE.filter((u) => u.c === 'ethereum')[1];
function forToken(t, d) { d.address = t.a; d.chain = t.c; d.pairs[0].baseToken.address = t.a; d.pairs[0].chainId = t.c; return d; }
const callOn = (t, build, at) => C.makeCall(t, forToken(t, build()), at);

// a clear but not extreme move: leans, without tripping the no-chasing rule
const mild = (dir) => data({ priceChange: { m5: dir * 1, h1: dir * 4, h6: dir * 9, h24: dir * 16 }, txns: dir > 0 ? flow([12, 80, 400, 1500], [3, 30, 150, 600]) : flow([2, 20, 100, 500], [9, 70, 300, 1300]) });

const tests = {
  'the stop is never closer than the minimum'() {
    const c = C.makeCall(T, data({ priceChange: { m5: 0.05, h1: 0.3, h6: 1, h24: 2 }, txns: flow([12, 80, 400, 1500], [3, 30, 150, 600]) }), NOW);
    assert.strictEqual(c.action, 'BUY');
    assert.ok(Math.abs(c.invalidation / c.price - 1) >= C.RULES.minInvalidationPct / 100 - 1e-9, 'stop ' + (100 * (1 - c.invalidation / c.price)).toFixed(2) + '%');
  },
  'no chasing: after a very large drop a SELL becomes WAIT'() {
    const c = C.makeCall(T, data({ priceChange: { m5: -1, h1: -5, h6: -15, h24: -35 }, txns: flow([2, 20, 100, 500], [9, 70, 300, 1300]) }), NOW);
    assert.strictEqual(c.action, 'WAIT');
    assert.strictEqual(c.invalidation, null);
    assert.match(c.reason, /instead of chasing/);
  },
  'no chasing uses the stock scale for Robinhood stock tokens'() {
    const stock = (h24) => data({ baseToken: { address: T.a, name: 'NVIDIA • Robinhood Token', symbol: 'NVDA' }, priceChange: { m5: -0.3, h1: -1, h6: -3, h24 }, txns: flow([2, 20, 100, 500], [9, 70, 300, 1300]) });
    assert.strictEqual(C.makeCall(T, stock(-4), NOW).action, 'SELL', 'a 4% drop is still a SELL');
    assert.strictEqual(C.makeCall(T, stock(-8.4), NOW).action, 'WAIT', 'an 8.4% drop is not chased');
  },
  'a strong up market becomes a BUY with an entry zone below and above the price'() {
    const c = C.makeCall(T, bullish(), NOW);
    assert.strictEqual(c.action, 'BUY');
    assert.ok(c.entry[0] < 2 && c.entry[1] > 2);
    assert.ok(c.invalidation < c.entry[0], 'invalidation sits below the entry zone');
    assert.ok(c.conviction >= 3);
  },
  'a strong down market becomes a SELL with invalidation above'() {
    const c = C.makeCall(T, bearish(), NOW);
    assert.strictEqual(c.action, 'SELL');
    assert.ok(c.invalidation > c.entry[1]);
  },
  'a flat market is a WAIT with no invalidation'() {
    const c = C.makeCall(T, data(), NOW);
    assert.strictEqual(c.action, 'WAIT');
    assert.strictEqual(c.invalidation, null);
    assert.strictEqual(c.status, 'watching');
  },
  'a failing contract makes it AVOID, whatever the market says'() {
    const d = bullish(); d.honeypot = { simulationSuccess: true, honeypotResult: { isHoneypot: true }, simulationResult: {} };
    assert.strictEqual(C.makeCall(T, d, NOW).action, 'AVOID');
  },
  'entry band stays between the limits'() {
    const calm = C.makeCall(T, data(), NOW), wild = C.makeCall(T, data({ priceChange: { h1: 40, h6: 90, h24: 200 } }), NOW);
    const width = (c) => (c.entry[1] - c.entry[0]) / 2 / c.price * 100;
    assert.ok(Math.abs(width(calm) - C.RULES.bandMin) < 0.01);
    assert.ok(Math.abs(width(wild) - C.RULES.bandMax) < 0.01);
  },
  'grading a BUY: working above, against below, invalidated is sticky and final'() {
    const c = C.makeCall(T, bullish(), NOW);
    assert.strictEqual(C.grade(c, 2.1, NOW + H).status, 'working');
    assert.strictEqual(C.grade(c, 1.95, NOW + H).status, 'against');
    const dead = C.grade(c, c.invalidation * 0.99, NOW + H);
    assert.strictEqual(dead.status, 'invalidated');
    assert.ok(dead.final);
    assert.strictEqual(C.grade(dead, 3, NOW + 2 * H).status, 'invalidated');
  },
  'grading a SELL mirrors a BUY'() {
    const c = C.makeCall(T, bearish(), NOW);
    assert.strictEqual(C.grade(c, 1.9, NOW + H).status, 'working');
    assert.strictEqual(C.grade(c, 2.05, NOW + H).status, 'against');
  },
  'a brand-new call is not graded until it has had time to move'() {
    const c = C.makeCall(T, bullish(), NOW);
    const early = C.grade(c, 2.5, NOW + 5 * 60e3);
    assert.strictEqual(early.status, 'open');
    assert.strictEqual(C.record([early]).graded, 0);
    assert.strictEqual(C.grade(c, 2.5, NOW + 31 * 60e3).status, 'working');
  },
  'calls close after the grading window with their last status'() {
    const c = C.makeCall(T, bullish(), NOW);
    const late = C.grade(c, 2.2, NOW + (C.RULES.gradeHours + 1) * H);
    assert.ok(late.final);
    assert.strictEqual(late.status, 'working');
  },
  'record counts only graded BUY and SELL calls'() {
    const a = C.grade(C.makeCall(T, bullish(), NOW), 2.2, NOW + H);
    const b = C.grade(C.makeCall(T, bearish(), NOW), 2.2, NOW + H);
    const w = C.makeCall(T, data(), NOW);
    const r = C.record([a, b, w]);
    assert.strictEqual(r.graded, 2);
    assert.strictEqual(r.working, 1);
    assert.strictEqual(r.hitRate, 50);
    assert.strictEqual(r.waits, 1);
  },
  'a cycle makes calls once per slot and regrades with fresh prices'() {
    let gathers = 0;
    const gatherFn = (t) => { gathers++; const d = bullish(); d.address = t.a; d.pairs[0].baseToken.address = t.a; return Promise.resolve(d); };
    const priceFn = () => Promise.resolve(2.5);
    return C.cycle(null, NOW, gatherFn, priceFn).then((doc) => {
      assert.strictEqual(gathers, C.UNIVERSE.length);
      assert.strictEqual(doc.calls.length, C.UNIVERSE.length);
      assert.strictEqual(doc.slot, C.slotOf(NOW));
      return C.cycle(doc, NOW + H, gatherFn, priceFn).then((doc2) => {
        assert.strictEqual(gathers, C.UNIVERSE.length, 'same slot: no new calls');
        assert.ok(doc2.calls.every((c) => c.status === 'working'));
        return C.cycle(doc2, NOW + 4 * H, gatherFn, priceFn).then((doc3) => {
          assert.strictEqual(doc3.calls.length, C.UNIVERSE.length, 'next slot: the same BUY is still live, so it is not called again');
          const bear = (t) => { const d = mild(-1); d.address = t.a; d.pairs[0].baseToken.address = t.a; return Promise.resolve(d); };
          return C.cycle(doc3, NOW + 8 * H, bear, priceFn).then((doc4) => {
            assert.strictEqual(doc4.calls.length, 2 * C.UNIVERSE.length, 'a change of view (SELL) is a new call');
          });
        });
      });
    });
  },
  'a cycle where every source fails keeps the old slot so it retries'() {
    return C.cycle(null, NOW, () => Promise.reject(new Error('down')), () => null).then((doc) => {
      assert.strictEqual(doc.calls.length, 0);
      assert.strictEqual(doc.slot, 0);
      assert.ok(doc.errors.length);
    });
  },
  'batches list each slot newest first and show a skipped slot as missed'() {
    const s0 = C.slotOf(NOW);
    const step = C.RULES.slotHours * H;
    const c1 = callOn(W, bullish, s0 + 5 * 60e3), c2 = callOn(W2, data, s0 + 6 * 60e3);   // slot 0: a BUY and a WAIT
    const c3 = callOn(W, data, s0 + 2 * step + 5 * 60e3);                                   // slot 2 (slot 1 skipped)
    const b = C.batches([c3, c2, c1], s0 + 2 * step + H);
    assert.deepStrictEqual(b.map((x) => x.slot), [s0 + 2 * step, s0 + step, s0]);
    assert.strictEqual(b[1].missed, true);
    assert.strictEqual(b[2].calls, 2);
    assert.strictEqual(b[2].BUY, 1);
    assert.strictEqual(b[2].WAIT, 1);
    assert.strictEqual(b[2].at, c1.at, 'a batch is timed by its first call');
  },
  'the current slot is not called missed while its batch may still be running'() {
    const s0 = C.slotOf(NOW), step = C.RULES.slotHours * H;
    const c = callOn(W, data, s0 + 5 * 60e3);
    assert.deepStrictEqual(C.batches([c], s0 + step + 10 * 60e3).map((x) => x.slot), [s0], '10 minutes into the next slot: not missed yet');
    assert.strictEqual(C.batches([c], s0 + step + 40 * 60e3)[0].missed, true, '40 minutes in: missed');
    assert.deepStrictEqual(C.batches([], NOW), []);
  },
  'view gives the oldest live call, the batches and the last run errors'() {
    const a = callOn(W, data, NOW), b = callOn(W2, data, NOW + 4 * H);
    const v = C.view({ calls: [b, a], slot: C.slotOf(NOW + 4 * H), updatedAt: NOW + 4 * H, errors: ['PEPE: HTTP 429'] }, NOW + 4 * H + 60e3);
    assert.strictEqual(v.oldestLiveAt, a.at);
    assert.strictEqual(v.batches.length, 2);
    assert.deepStrictEqual(v.lastRunErrors, ['PEPE: HTTP 429']);
  },
  'view returns the latest call per watched token and the next call time'() {
    const a = callOn(W, bullish, NOW), b = callOn(W, data, NOW + 4 * H);
    const v = C.view({ calls: [b, a], slot: C.slotOf(NOW + 4 * H), updatedAt: NOW }, NOW + 4 * H);
    assert.strictEqual(v.latest.length, 1);
    assert.strictEqual(v.latest[0].action, 'WAIT');
    assert.ok(v.nextCallAt > NOW + 4 * H);
  },
  'a token taken out of the universe keeps its calls in the record but not in latest'() {
    const gone = C.makeCall(T, bullish(), NOW); // T is not in the universe
    const v = C.view({ calls: [callOn(W, data, NOW), gone], slot: C.slotOf(NOW), updatedAt: NOW }, NOW);
    assert.deepStrictEqual(v.latest.map((c) => c.address), [W.a]);
    assert.strictEqual(v.record.total, 2);
    assert.strictEqual(v.calls.length, 2);
  },
  'retire moves calls older than two weeks to the archive, and the record still counts them'() {
    const keepMs = C.RULES.keepDays * 24 * H;
    const old = C.grade(callOn(W, bullish, NOW), 2.5, NOW + H);       // BUY, working
    const oldSell = C.grade(callOn(W2, bearish, NOW), 2.5, NOW + H);  // SELL, invalidated
    const oldWait = callOn(W, data, NOW - 4 * H);                      // WAIT
    const fresh = callOn(W, bullish, NOW + keepMs);
    const doc = { calls: [fresh, old, oldSell, oldWait], slot: 1, updatedAt: NOW };
    const before = C.view(doc, NOW + keepMs + H).record;
    const r = C.retire(doc, NOW + keepMs + H);
    assert.deepStrictEqual(r.out.map((c) => c.id).sort(), [old.id, oldSell.id, oldWait.id].sort());
    assert.ok(r.out.every((c) => c.final), 'archived calls are closed');
    assert.deepStrictEqual(r.doc.calls.map((c) => c.id), [fresh.id]);
    assert.deepStrictEqual(r.doc.archive, [C.monthOf(NOW)]);
    assert.deepStrictEqual(r.doc.retired, { total: 3, graded: 2, working: 1, against: 0, invalidated: 1, waits: 1, avoids: 0 });
    const after = C.view(r.doc, NOW + keepMs + H).record;
    assert.deepStrictEqual(after, before, 'moving calls to the archive does not change the record');
    assert.strictEqual(after.total, 4);
    assert.strictEqual(after.hitRate, 50);
    // a second run adds to the counts instead of replacing them
    const later = callOn(W2, data, NOW + keepMs + 2 * H);
    const r2 = C.retire(Object.assign({}, r.doc, { calls: [later].concat(r.doc.calls) }), NOW + 2 * keepMs + 3 * H);
    assert.strictEqual(r2.doc.retired.total, 5);
    assert.strictEqual(r2.doc.calls.length, 0);
    assert.strictEqual(C.view(r2.doc, NOW + 2 * keepMs + 3 * H).record.total, 5);
  },
  'retire with nothing old returns the same document'() {
    const doc = { calls: [callOn(W, data, NOW)], slot: 1, updatedAt: NOW };
    const r = C.retire(doc, NOW + H);
    assert.strictEqual(r.doc, doc);
    assert.strictEqual(r.out.length, 0);
    assert.strictEqual(C.retire(null, NOW).out.length, 0);
  },
  'an old call that never got a price is archived closed, with its last status'() {
    const stuck = callOn(W, bullish, NOW); // never graded: status open, final false
    const r = C.retire({ calls: [stuck] }, NOW + (C.RULES.keepDays * 24 + 1) * H);
    assert.strictEqual(r.out[0].final, true);
    assert.strictEqual(r.out[0].status, 'open');
    assert.strictEqual(r.doc.retired.graded, 0, 'an ungraded call is not counted as graded');
  },
  'archiving the same calls twice keeps one copy of each'() {
    const a = callOn(W, bullish, NOW), b = callOn(W2, data, NOW + 4 * H);
    const once = C.mergeArchive('2026-11', null, [a, b]);
    const twice = C.mergeArchive('2026-11', once, [a]); // the document save failed after the archive save
    assert.strictEqual(twice.calls.length, 2);
    assert.strictEqual(twice.month, '2026-11');
    assert.deepStrictEqual(twice.calls.map((c) => c.id), [b.id, a.id], 'newest first');
  },
  'a cycle keeps the archive counts and months'() {
    const gatherFn = (t) => Promise.resolve(forToken(t, bullish()));
    const doc = { calls: [], slot: 0, updatedAt: 0, retired: { total: 7, graded: 3, working: 2, against: 0, invalidated: 1, waits: 4, avoids: 0 }, archive: ['2026-11'] };
    return C.cycle(doc, NOW, gatherFn, () => Promise.resolve(2.5)).then((d) => {
      assert.deepStrictEqual(d.retired, doc.retired);
      assert.deepStrictEqual(d.archive, ['2026-11']);
      assert.strictEqual(C.view(d, NOW).record.total, 7 + C.UNIVERSE.length);
    });
  }
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} call tests passed`);
  process.exitCode = failed ? 1 : 0;

  if (process.argv.includes('--live')) {
    console.log('\nLive cycle (not stored):');
    const t0 = Date.now();
    const doc = await C.cycle(null, Date.now(), (t) => G.gather(t.a, t.c), (t) => C.dexPrice(t));
    console.log('took ' + (Date.now() - t0) + ' ms, errors: ' + JSON.stringify(doc.errors));
    doc.calls.forEach((c) => console.log(`  ${c.sym.padEnd(6)} ${c.chain.padEnd(9)} ${c.action.padEnd(5)} conv ${c.conviction}  price ${c.price}  entry ${c.entry.join('–')}  inval ${c.invalidation}  contract ${c.contract}`));
  }
})();
