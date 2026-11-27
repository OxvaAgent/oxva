// Tests for the Oxva Gate rules.
//   node scripts/test-gate.js           offline rule tests only
//   node scripts/test-gate.js --live    also runs real tokens against the live APIs
const assert = require('assert');
const path = require('path');
const G = require(path.join(__dirname, '..', 'src', 'assets', 'gate-core.js'));

const NOW = Date.UTC(2026, 10, 21);
const DAY = 864e5;
const ADDR = '0x1111111111111111111111111111111111111111';

function pair(over) {
  return Object.assign({
    chainId: 'ethereum', dexId: 'uniswap', url: 'https://dexscreener.com/ethereum/0xpair',
    baseToken: { address: ADDR, name: 'Test', symbol: 'TST' }, quoteToken: { address: '0xweth', symbol: 'WETH' },
    priceUsd: '1.00', liquidity: { usd: 900000 }, volume: { h24: 50000 }, txns: { h24: { buys: 120, sells: 110 } },
    pairCreatedAt: NOW - 90 * DAY, fdv: 5e6
  }, over);
}
function goplus(over) {
  return Object.assign({
    is_open_source: '1', is_proxy: '0', is_honeypot: '0', cannot_sell_all: '0', buy_tax: '0', sell_tax: '0',
    owner_address: '0x0000000000000000000000000000000000000000',
    lp_holders: [{ address: '0x000000000000000000000000000000000000dead', percent: '0.98', is_locked: 0 }],
    holders: Array.from({ length: 10 }, (_, i) => ({ address: '0x' + String(i + 2).repeat(40).slice(0, 40), percent: '0.02', is_contract: 0, is_locked: 0 })),
    holder_count: '5000', creator_percent: '0.01', owner_percent: '0'
  }, over);
}
const okHp = { simulationSuccess: true, honeypotResult: { isHoneypot: false }, simulationResult: { buyTax: 0, sellTax: 0, transferTax: 0 } };
const run = (gp, hp, pairs) => G.evaluate({ address: ADDR, chain: 'ethereum', pairs: pairs || [pair()], goplus: gp, honeypot: hp, errors: {} }, NOW);
const byId = (r, id) => r.checks.find(c => c.id === id);

const tests = {
  'clean token is allowed'() {
    const r = run(goplus(), okHp);
    assert.strictEqual(r.verdict.level, 'allow');
    assert.strictEqual(r.checks.length, 9);
    assert.ok(r.checks.every(c => c.status === 'pass'), r.checks.map(c => c.id + ':' + c.status).join(' '));
  },
  'honeypot simulation blocks'() {
    const r = run(goplus(), { simulationSuccess: true, honeypotResult: { isHoneypot: true, honeypotReason: 'TRANSFER_FAILED' }, simulationResult: {} });
    assert.strictEqual(byId(r, 'sell').status, 'fail');
    assert.strictEqual(r.verdict.level, 'deny');
  },
  'sell tax of 25% blocks, 8% needs approval'() {
    assert.strictEqual(run(goplus(), { ...okHp, simulationResult: { buyTax: 0, sellTax: 25 } }).verdict.level, 'deny');
    const r = run(goplus(), { ...okHp, simulationResult: { buyTax: 0, sellTax: 8 } });
    assert.strictEqual(byId(r, 'sellTax').status, 'warn');
    assert.strictEqual(r.verdict.level, 'hold');
  },
  'goplus tax is a fraction, converted to percent'() {
    const r = run(goplus({ buy_tax: '0.12' }), null);
    assert.strictEqual(byId(r, 'buyTax').value, '12%');
    assert.strictEqual(byId(r, 'buyTax').status, 'fail');
  },
  'renounced owner makes admin switches dormant'() {
    const r = run(goplus({ is_blacklisted: '1', transfer_pausable: '1', slippage_modifiable: '1' }), okHp);
    assert.strictEqual(byId(r, 'owner').status, 'pass');
    assert.match(byId(r, 'owner').detail, /no one can use them/);
  },
  'active owner who can change tax is blocked'() {
    const r = run(goplus({ owner_address: '0x9999999999999999999999999999999999999999', slippage_modifiable: '1' }), okHp);
    assert.strictEqual(byId(r, 'owner').status, 'fail');
    assert.strictEqual(r.verdict.level, 'deny');
  },
  'hidden owner fails even when renounced'() {
    assert.strictEqual(byId(run(goplus({ hidden_owner: '1' }), okHp), 'owner').status, 'fail');
  },
  'thin liquidity and unlocked LP on a small pool fail'() {
    const r = run(goplus({ lp_holders: [{ address: '0xabc0000000000000000000000000000000000abc', percent: '1', is_locked: 0 }] }), okHp, [pair({ liquidity: { usd: 12000 } })]);
    assert.strictEqual(byId(r, 'liquidity').status, 'fail');
    assert.strictEqual(byId(r, 'lpLock').status, 'fail');
  },
  'buyers but zero sellers is a honeypot sign'() {
    const r = run(goplus(), okHp, [pair({ txns: { h24: { buys: 80, sells: 0 } } })]);
    assert.strictEqual(byId(r, 'activity').status, 'fail');
  },
  'pools, locks and burn wallets do not count as whales'() {
    const holders = [
      { address: '0xpool', percent: '0.6', is_contract: 1, is_locked: 0 },
      { address: '0x000000000000000000000000000000000000dead', percent: '0.2', is_contract: 0, is_locked: 0 },
      { address: '0xperson', percent: '0.05', is_contract: 0, is_locked: 0 }
    ];
    const c = byId(run(goplus({ holders }), okHp), 'holders');
    assert.strictEqual(c.status, 'pass');
    assert.strictEqual(c.value, 'Top 10: 5%');
  },
  'missing security data cannot be allowed'() {
    const r = run(null, null);
    assert.notStrictEqual(r.verdict.level, 'allow');
  },
  'no pool on the chain fails liquidity'() {
    const r = run(goplus(), okHp, []);
    assert.strictEqual(byId(r, 'liquidity').status, 'fail');
    assert.strictEqual(r.verdict.level, 'deny');
  },
  'address validation'() {
    assert.ok(G.isAddress(ADDR));
    assert.ok(!G.isAddress('0x123'));
    assert.ok(!G.isAddress('hello'));
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} rule tests passed`);

if (process.argv.includes('--live')) {
  const live = [
    ['PEPE', '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 'auto'],
    ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'auto'],
    ['CAKE', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 'auto'],
    ['BRETT', '0x532f27101965dd16442E59d40670FaF5eBB142E4', 'auto']
  ];
  (async () => {
    console.log('\nLive tokens:');
    for (const [label, addr, chain] of live) {
      try {
        const data = await G.gather(addr, chain);
        const r = G.evaluate(data);
        console.log(`\n${label} → ${r.token.symbol} on ${r.token.chainName} · liq ${G.usd(r.token.liquidityUsd)} · ${r.verdict.title.toUpperCase()}`);
        r.checks.forEach(c => console.log(`   ${c.status.padEnd(7)} ${c.label.padEnd(17)} ${c.value}`));
        console.log('   note: ' + r.verdict.note);
        const down = Object.keys(data.errors); if (down.length) console.log('   source errors: ' + JSON.stringify(data.errors));
      } catch (e) { console.log(`\n${label} → ERROR ${e.code || ''} ${e.message}`); }
    }
  })();
}
process.exitCode = failed ? 1 : 0;
