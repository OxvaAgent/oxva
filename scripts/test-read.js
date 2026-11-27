// Tests for the Oxva market read.
//   node scripts/test-read.js          offline rule tests
//   node scripts/test-read.js --live   also reads real tokens (market + contract)
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '..', 'src', 'assets', 'read-core.js'));
const G = require(path.join(__dirname, '..', 'src', 'assets', 'gate-core.js'));

const ADDR = '0x1111111111111111111111111111111111111111';
function pair(over) {
  return Object.assign({
    chainId: 'ethereum', dexId: 'uniswap',
    baseToken: { address: ADDR, symbol: 'TST' }, quoteToken: { address: '0xweth', symbol: 'WETH' },
    liquidity: { usd: 2e6 },
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    txns: { m5: { buys: 5, sells: 5 }, h1: { buys: 40, sells: 40 }, h6: { buys: 200, sells: 200 }, h24: { buys: 800, sells: 800 } },
    volume: { m5: 1e3, h1: 2e4, h6: 1e5, h24: 4e5 }
  }, over);
}
const flow = (b, s) => ({ m5: { buys: b[0], sells: s[0] }, h1: { buys: b[1], sells: s[1] }, h6: { buys: b[2], sells: s[2] }, h24: { buys: b[3], sells: s[3] } });

const tests = {
  'strong rise with buyers in control leans up with high conviction'() {
    const m = R.market([pair({ priceChange: { m5: 1.5, h1: 6, h6: 14, h24: 30 }, txns: flow([12, 80, 400, 1500], [3, 30, 150, 600]) })]);
    assert.strictEqual(m.lean, 'up');
    assert.ok(m.conviction >= 4, 'conviction ' + m.conviction);
    assert.match(m.reason, /^Up 30\.0% in 24 hours; buyers lead in 4 of 4 windows\.$/);
  },
  'steady fall with sellers in control leans down'() {
    const m = R.market([pair({ priceChange: { m5: -0.8, h1: -4, h6: -9, h24: -18 }, txns: flow([2, 20, 100, 500], [8, 60, 260, 1100]) })]);
    assert.strictEqual(m.lean, 'down');
    assert.ok(m.conviction >= 3);
  },
  'a normal stock day leans for a Robinhood stock token, not for a crypto token'() {
    const move = { priceChange: { m5: 0.2, h1: 0.8, h6: 1.6, h24: 3 }, txns: flow([7, 50, 240, 950], [4, 32, 170, 700]) };
    const stock = R.market([pair(Object.assign({ baseToken: { address: ADDR, symbol: 'NVDA', name: 'NVIDIA • Robinhood Token' } }, move))]);
    const crypto = R.market([pair(Object.assign({ baseToken: { address: ADDR, symbol: 'TST', name: 'Test Token' } }, move))]);
    assert.strictEqual(stock.lean, 'up', 'stock score ' + stock.score.toFixed(3));
    assert.strictEqual(crypto.lean, 'flat', 'crypto score ' + crypto.score.toFixed(3));
    assert.ok(R.isStock({ baseToken: { name: 'Apple • Robinhood Token' } }) && !R.isStock({ baseToken: { name: 'Apple' } }));
  },
  'a flat stock day still has no clear edge'() {
    const m = R.market([pair({ baseToken: { address: ADDR, symbol: 'AAPL', name: 'Apple • Robinhood Token' }, priceChange: { m5: 0, h1: 0.05, h6: -0.1, h24: 0.2 } })]);
    assert.strictEqual(m.lean, 'flat', 'score ' + m.score.toFixed(3));
  },
  'balanced market has no clear edge'() {
    const m = R.market([pair()]);
    assert.strictEqual(m.lean, 'flat');
    assert.ok(m.conviction <= 2);
    assert.match(m.catch, /Waiting is a position too/);
  },
  'price up but sellers in control caps conviction at 2'() {
    const m = R.market([pair({ priceChange: { m5: 1, h1: 5, h6: 12, h24: 25 }, txns: flow([2, 10, 60, 300], [10, 50, 250, 1200]) })]);
    assert.ok(m.conviction <= 2, 'conviction ' + m.conviction);
    assert.ok(m.notes.includes('disagree'));
  },
  'thin pool lowers conviction and is named as the catch'() {
    const deep = R.market([pair({ priceChange: { m5: 1.5, h1: 6, h6: 14, h24: 30 }, txns: flow([12, 80, 400, 1500], [3, 30, 150, 600]) })]);
    const thin = R.market([pair({ liquidity: { usd: 40000 }, volume: { h24: 30000 }, priceChange: { m5: 1.5, h1: 6, h6: 14, h24: 30 }, txns: flow([12, 80, 400, 1500], [3, 30, 150, 600]) })]);
    assert.strictEqual(thin.conviction, deep.conviction - 1);
    assert.match(thin.catch, /^Thin pool/);
  },
  'almost no trades means no read'() {
    const m = R.market([pair({ priceChange: { h24: 40 }, txns: flow([0, 0, 2, 4], [0, 0, 1, 3]) })]);
    assert.strictEqual(m.lean, 'flat');
    assert.strictEqual(m.conviction, 1);
    assert.match(m.reason, /nobody traded/);
  },
  'missing windows are skipped, not counted as zero'() {
    const m = R.market([pair({ priceChange: { h24: -20 }, txns: flow([0, 0, 50, 300], [0, 0, 150, 900]) })]);
    assert.strictEqual(m.lean, 'down');
  },
  'bounce in the last hour is mentioned'() {
    const m = R.market([pair({ priceChange: { m5: 0.2, h1: 1.2, h6: -2, h24: -6 } })]);
    assert.match(m.reason, /Down 6\.0% in 24 hours, but bouncing in the last hour/);
  },
  'order flow is summed across pools'() {
    const a = pair({ txns: flow([0, 30, 150, 600], [0, 10, 50, 200]) });
    const b = pair({ liquidity: { usd: 5e5 }, txns: flow([0, 30, 150, 600], [0, 10, 50, 200]) });
    const m = R.market([a, b]);
    assert.strictEqual(m.windows[3].buys, 1200);
    assert.strictEqual(m.liquidity, 2.5e6);
  },
  'no pool means no market read'() {
    assert.strictEqual(R.market([]).available, false);
    assert.strictEqual(R.combine(R.market([]), null).title, 'No read');
  },
  'a failing contract overrides the market: stay out'() {
    const m = R.market([pair({ priceChange: { m5: 1.5, h1: 6, h6: 14, h24: 30 }, txns: flow([12, 80, 400, 1500], [3, 30, 150, 600]) })]);
    const safety = { verdict: { level: 'deny' }, checks: [{ status: 'fail', detail: 'A simulated sell failed.' }] };
    const out = R.combine(m, safety);
    assert.strictEqual(out.tone, 'stop');
    assert.strictEqual(out.title, 'Stay out');
    assert.match(out.reason, /simulated sell failed/);
  },
  'a contract that needs a look keeps the lean but says check first'() {
    const m = R.market([pair({ priceChange: { m5: 1.5, h1: 6, h6: 14, h24: 30 }, txns: flow([12, 80, 400, 1500], [3, 30, 150, 600]) })]);
    const safety = { verdict: { level: 'hold' }, checks: [{ status: 'warn', label: 'Sell tax', critical: true }, { status: 'unknown', label: 'Owner powers', critical: true }] };
    const out = R.combine(m, safety);
    assert.strictEqual(out.title, 'Leaning up, check first');
    assert.match(out.catch, /sell tax and owner powers \(not readable\) need a closer look/);
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} read tests passed`);
process.exitCode = failed ? 1 : 0;

if (process.argv.includes('--live')) {
  const live = [
    ['PEPE', '0x6982508145454Ce325dDbE47a25d4ec3d2311933'],
    ['LINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA'],
    ['AERO', '0x940181a94A35A4569E4529A3CDfB74e38FD98631'],
    ['DEGEN', '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed'],
    ['CAKE', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'],
    ['BRETT', '0x532f27101965dd16442E59d40670FaF5eBB142E4']
  ];
  (async () => {
    console.log('\nLive reads:');
    for (const [label, addr] of live) {
      try {
        const data = await G.gather(addr, 'auto');
        const m = R.market(data.pairs), s = G.evaluate(data), out = R.combine(m, s);
        console.log(`\n${label} on ${data.chain}: ${out.title.toUpperCase()}${out.conviction ? ' · conviction ' + out.conviction + '/5' : ''} · score ${m.score.toFixed(2)} (trend ${m.trend.toFixed(2)}, flow ${m.flow.toFixed(2)}) · gate ${s.verdict.title}`);
        console.log('   ' + out.reason);
        console.log('   catch: ' + out.catch);
      } catch (e) { console.log(`\n${label} → ERROR ${e.code || ''} ${e.message}`); }
    }
  })();
}
