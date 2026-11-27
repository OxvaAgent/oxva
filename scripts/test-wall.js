// Tests for the Oxva Wall policy engine (src/assets/wall-core.js).
const assert = require('assert');
const path = require('path');
const W = require(path.join(__dirname, '..', 'src', 'assets', 'wall-core.js'));

const NOW = Date.UTC(2026, 10, 21, 12);
const ROUTER = '0x2222222222222222222222222222222222a91c';
const VENDOR = '0x8c1d00000000000000000000000000000077e0';
const P = (over) => Object.assign({ nonce: 1, to: ROUTER, method: 'swap', amount: 40, slippage: 0.3, tokenVerdict: 'allow' }, over);
const run = (p, state, opts) => W.evaluate(W.defaultPolicy(), p, state || W.emptyState(), NOW, opts);
const check = (r, id) => r.checks.find((c) => c.id === id);

const tests = {
  'a small swap to the router is allowed, bound to its payload, and expires'() {
    const r = run(P());
    assert.strictEqual(r.decision, 'allow');
    assert.match(r.id, /^ox_auth_[0-9a-f]{8}$/);
    assert.strictEqual(r.expiresAt, NOW + W.AUTH_TTL_MS);
    assert.notStrictEqual(run(P({ amount: 41 })).payloadHash, r.payloadHash, 'changing the payload changes the authorization');
  },
  'an unknown target is denied by default'() {
    const r = run(P({ to: '0x9f0300000000000000000000000000000000e21b' }));
    assert.strictEqual(r.decision, 'deny');
    assert.strictEqual(r.code, 'OX_TARGET_001');
  },
  'unlimited approvals are always denied'() {
    const r = run(P({ method: 'approve', unlimited: true }));
    assert.strictEqual(r.decision, 'deny');
    assert.strictEqual(check(r, 'method').status, 'fail');
  },
  'above the approval threshold is held for a person'() {
    const r = run(P({ to: VENDOR, method: 'transfer', amount: 180 }));
    assert.strictEqual(r.decision, 'approve');
    assert.match(r.id, /^ox_hold_/);
    assert.strictEqual(run(P({ to: VENDOR, method: 'transfer', amount: 180 }), null, { approved: true }).decision, 'allow');
  },
  'over the per-trade cap is denied, even with approval'() {
    assert.strictEqual(run(P({ amount: 900 }), null, { approved: true }).decision, 'deny');
  },
  'slippage over the maximum is denied for swaps only'() {
    assert.strictEqual(run(P({ slippage: 3 })).decision, 'deny');
    assert.strictEqual(run(P({ to: VENDOR, method: 'transfer', slippage: 3 })).decision, 'allow');
  },
  'a replayed nonce is denied'() {
    let s = W.emptyState();
    const first = run(P(), s);
    s = W.apply(s, P(), first);
    const again = run(P(), s);
    assert.strictEqual(again.decision, 'deny');
    assert.strictEqual(again.code, 'OX_REPLAY_001');
  },
  'allowed spending fills the hourly budget, then the next trade is held'() {
    let s = W.emptyState();
    for (let i = 1; i <= 5; i++) { const p = P({ nonce: i, amount: 95 }); s = W.apply(s, p, run(p, s)); }
    assert.strictEqual(W.spentInHour(s, NOW), 475);
    const next = run(P({ nonce: 6, amount: 50 }), s);
    assert.strictEqual(next.decision, 'approve');
    assert.strictEqual(check(next, 'budget').status, 'hold');
  },
  'spending older than an hour no longer counts'() {
    const s = { spends: [{ at: NOW - 2 * 3600e3, amount: 480 }], nonces: [], log: [] };
    assert.strictEqual(run(P({ nonce: 9, amount: 50 }), s).decision, 'allow');
  },
  'a token Oxva reads as stay out is denied; one that needs a look is held'() {
    assert.strictEqual(run(P({ tokenVerdict: 'deny' })).decision, 'deny');
    assert.strictEqual(run(P({ tokenVerdict: 'hold' })).decision, 'approve');
  },
  'a paused account denies everything'() {
    const policy = Object.assign(W.defaultPolicy(), { paused: true });
    assert.strictEqual(W.evaluate(policy, P(), W.emptyState(), NOW).decision, 'deny');
  },
  'denied and held proposals reserve nothing but are logged'() {
    let s = W.emptyState();
    const p = P({ to: '0xdead00000000000000000000000000000000beef' });
    s = W.apply(s, p, run(p, s));
    assert.strictEqual(W.spentInHour(s, NOW), 0);
    assert.strictEqual(s.nonces.length, 0);
    assert.strictEqual(s.log.length, 1);
    assert.strictEqual(s.log[0].decision, 'deny');
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} wall tests passed`);
process.exitCode = failed ? 1 : 0;
