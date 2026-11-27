/* Oxva Wall: a deterministic policy engine for agent transactions.
 * An agent proposes a transaction; the wall checks it against the policy before anything is signed:
 * allow (signed, budget reserved), approve (held until a person confirms) or deny (never signed).
 * Runs in the browser (window.OxvaWallCore) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OxvaWallCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AUTH_TTL_MS = 5 * 60 * 1000;
  var HOUR = 3600 * 1000;

  function defaultPolicy() {
    return {
      paused: false,
      hourlyBudget: 500,       // USD the agent may spend per rolling hour
      perTradeCap: 250,        // USD per single transaction
      approvalAbove: 100,      // USD above which a person must confirm
      maxSlippage: 1,          // percent
      methods: ['swap', 'transfer'],
      allow: [
        { address: '0x2222222222222222222222222222222222a91c', label: 'DEX router' },
        { address: '0x8c1d00000000000000000000000000000077e0', label: 'Data vendor' }
      ]
    };
  }

  function emptyState() { return { spends: [], nonces: [], log: [] }; }

  function lc(s) { return String(s || '').toLowerCase(); }
  function money(n) { return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  // FNV-1a, enough to bind an authorization to the exact payload in a demo
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function spentInHour(state, now) {
    return state.spends.filter(function (s) { return now - s.at < HOUR; }).reduce(function (a, s) { return a + s.amount; }, 0);
  }
  function payloadOf(p) {
    return JSON.stringify({ nonce: p.nonce, to: lc(p.to), method: p.method, amount: Number(p.amount), slippage: Number(p.slippage || 0), unlimited: !!p.unlimited });
  }

  /**
   * evaluate(policy, proposal, state, now, opts) -> decision
   * proposal: { nonce, to, method, amount, slippage, unlimited, tokenVerdict ('allow'|'hold'|'deny'|undefined) }
   * opts.approved: a person has confirmed it (skips the approval checks only)
   */
  function evaluate(policy, p, state, now, opts) {
    opts = opts || {};
    var amount = Number(p.amount) || 0, slip = Number(p.slippage) || 0;
    var spent = spentInHour(state, now);
    var target = policy.allow.filter(function (a) { return lc(a.address) === lc(p.to); })[0];
    var checks = [];
    function add(id, label, status, detail, code) { checks.push({ id: id, label: label, status: status, detail: detail, code: code || null }); }

    add('account', 'Account', policy.paused ? 'fail' : 'pass',
      policy.paused ? 'The account is paused. Nothing can be signed until it is resumed.' : 'Active.', 'OX_PAUSED');
    var replay = state.nonces.indexOf(String(p.nonce)) >= 0;
    add('replay', 'Replay', replay ? 'fail' : 'pass',
      replay ? 'This exact proposal (nonce ' + p.nonce + ') was already used. A signature cannot be spent twice.' : 'New nonce ' + p.nonce + '.', 'OX_REPLAY');
    add('target', 'Target', target ? 'pass' : 'fail',
      target ? 'On the allowlist: ' + target.label + '.' : 'Not on the allowlist. The default is deny.', 'OX_TARGET');
    var methodOk = policy.methods.indexOf(p.method) >= 0;
    var unlimited = p.method === 'approve' && p.unlimited;
    add('method', 'Method', unlimited ? 'fail' : methodOk ? 'pass' : 'fail',
      unlimited ? 'Unlimited token approval. Oxva never signs one.' : methodOk ? p.method + '() is allowed.' : p.method + '() is not in the allowed methods.', 'OX_METHOD');
    add('cap', 'Per-trade cap', amount > policy.perTradeCap ? 'fail' : 'pass',
      money(amount) + ' against a cap of ' + money(policy.perTradeCap) + '.', 'OX_CAP');
    add('slippage', 'Slippage', p.method === 'swap' && slip > policy.maxSlippage ? 'fail' : 'pass',
      p.method === 'swap' ? slip + '% against a maximum of ' + policy.maxSlippage + '%.' : 'Not a swap.', 'OX_SLIPPAGE');
    var tv = p.tokenVerdict;
    add('token', 'Token read', tv === 'deny' ? 'fail' : tv === 'hold' ? 'hold' : 'pass',
      tv === 'deny' ? 'Oxva’s read of the token says stay out.' : tv === 'hold' ? 'The token’s contract needs a closer look.' : tv === 'allow' ? 'The token’s contract passes.' : 'No token involved.', 'OX_TOKEN');
    var over = spent + amount > policy.hourlyBudget;
    add('budget', 'Hourly budget', over ? 'hold' : 'pass',
      money(spent) + ' spent this hour + ' + money(amount) + ' = ' + money(spent + amount) + ' of ' + money(policy.hourlyBudget) + '.', 'OX_BUDGET');
    var big = amount > policy.approvalAbove;
    add('approval', 'Approval threshold', big ? 'hold' : 'pass',
      big ? 'Above ' + money(policy.approvalAbove) + ': a person signs too.' : 'Under ' + money(policy.approvalAbove) + '.', 'OX_APPROVAL');

    if (opts.approved) checks.forEach(function (c) { if (c.status === 'hold' && (c.id === 'approval' || c.id === 'budget' || c.id === 'token')) { c.status = 'pass'; c.detail += ' Confirmed by a person.'; } });

    var fail = checks.filter(function (c) { return c.status === 'fail'; })[0];
    var holds = checks.filter(function (c) { return c.status === 'hold'; });
    var payload = payloadOf(p);
    var out = { checks: checks, payloadHash: hash(payload), at: now };
    if (fail) {
      out.decision = 'deny'; out.code = fail.code + '_001'; out.id = fail.code + '_001';
      out.note = 'Denied. ' + fail.detail + ' Nothing was reserved or signed.';
    } else if (holds.length) {
      out.decision = 'approve'; out.code = holds[0].code; out.id = 'ox_hold_' + out.payloadHash;
      out.note = 'Held for a person. ' + holds.map(function (c) { return c.detail; }).join(' ') + ' Nothing is signed until someone confirms.';
    } else {
      out.decision = 'allow'; out.code = null; out.id = 'ox_auth_' + out.payloadHash; out.expiresAt = now + AUTH_TTL_MS;
      out.note = 'Allowed. ' + money(amount) + ' reserved from the hourly budget. The authorization is bound to this exact payload and expires in five minutes.';
    }
    return out;
  }

  /** Record a decision: allowed proposals reserve budget and burn their nonce; every decision is logged. */
  function apply(state, p, result) {
    var s = { spends: state.spends.slice(), nonces: state.nonces.slice(), log: state.log.slice() };
    if (result.decision === 'allow') {
      s.spends.push({ at: result.at, amount: Number(p.amount) || 0 });
      s.nonces.push(String(p.nonce));
    }
    s.log.unshift({ at: result.at, nonce: p.nonce, method: p.method, to: p.to, amount: Number(p.amount) || 0, decision: result.decision, id: result.id });
    s.log = s.log.slice(0, 50);
    return s;
  }

  return { defaultPolicy: defaultPolicy, emptyState: emptyState, evaluate: evaluate, apply: apply, spentInHour: spentInHour, hash: hash, AUTH_TTL_MS: AUTH_TTL_MS };
});
