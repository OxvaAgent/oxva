/* Oxva wall page: wires the policy form and proposal form to the policy engine (wall-core.js). */
(function () {
  'use strict';
  var W = window.OxvaWallCore, U = window.OxvaUI, el = U.el;
  var $ = function (id) { return document.getElementById(id); };
  var ROUTER = '0x2222222222222222222222222222222222a91c', VENDOR = '0x8c1d00000000000000000000000000000077e0', UNKNOWN = '0x9f0300000000000000000000000000000000e21b';
  var state = W.emptyState(), lastAllowed = null, pending = null;
  var ICON = { pass: '✓', hold: '!', fail: '✕' };
  var DEC = { allow: 'Allowed', approve: 'Needs approval', deny: 'Denied' };

  function policy() {
    var p = W.defaultPolicy();
    p.hourlyBudget = Number($('p-budget').value) || 0;
    p.perTradeCap = Number($('p-cap').value) || 0;
    p.approvalAbove = Number($('p-approve').value) || 0;
    p.maxSlippage = Number($('p-slip').value) || 0;
    p.paused = $('p-paused').checked;
    return p;
  }
  function proposal() {
    return {
      nonce: String($('q-nonce').value), to: $('q-to').value, method: $('q-method').value,
      amount: Number($('q-amount').value) || 0, slippage: Number($('q-slip').value) || 0,
      unlimited: $('q-unlimited').checked, tokenVerdict: $('q-token').value || undefined
    };
  }
  function setForm(p) {
    $('q-method').value = p.method; $('q-to').value = p.to; $('q-amount').value = p.amount;
    $('q-slip').value = p.slippage; $('q-token').value = p.tokenVerdict || ''; $('q-unlimited').checked = !!p.unlimited;
    if (p.nonce) $('q-nonce').value = p.nonce;
  }
  function nextNonce() { var n = 1; state.nonces.concat(state.log.map(function (l) { return String(l.nonce); })).forEach(function (x) { n = Math.max(n, Number(x) + 1); }); return n; }

  var PRESETS = {
    swap: function () { return { method: 'swap', to: ROUTER, amount: 40, slippage: 0.3, tokenVerdict: 'allow', nonce: nextNonce() }; },
    vendor: function () { return { method: 'transfer', to: VENDOR, amount: 180, slippage: 0, tokenVerdict: '', nonce: nextNonce() }; },
    unknown: function () { return { method: 'swap', to: UNKNOWN, amount: 25, slippage: 0.5, tokenVerdict: 'allow', nonce: nextNonce() }; },
    unlimited: function () { return { method: 'approve', to: ROUTER, amount: 0, slippage: 0, tokenVerdict: '', unlimited: true, nonce: nextNonce() }; },
    replay: function () { return lastAllowed ? Object.assign({}, lastAllowed) : PRESETS.swap(); },
    scam: function () { return { method: 'swap', to: ROUTER, amount: 30, slippage: 0.4, tokenVerdict: 'deny', nonce: nextNonce() }; }
  };

  function show(result, p) {
    var d = $('d-dec'); d.className = 'dec ' + result.decision; d.textContent = DEC[result.decision];
    var id = $('d-id'); id.hidden = false; id.textContent = result.id + (result.expiresAt ? ' · expires ' + new Date(result.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
    $('d-note').textContent = result.note;
    $('d-when').textContent = p.method + '() · $' + p.amount + ' · nonce ' + p.nonce;
    var ul = $('d-checks'); ul.textContent = '';
    result.checks.forEach(function (c) {
      var li = el('li', c.status); li.appendChild(el('span', 'ic', ICON[c.status]));
      li.appendChild(el('b', '', c.label)); li.appendChild(el('span', 'd', c.detail)); ul.appendChild(li);
    });
    $('d-approve').hidden = result.decision !== 'approve';
  }

  function meter() {
    var p = policy(), spent = W.spentInHour(state, Date.now());
    $('m-text').textContent = '$' + spent.toLocaleString('en-US') + ' of $' + p.hourlyBudget.toLocaleString('en-US');
    var b = $('m-bar'); b.style.width = Math.min(100, p.hourlyBudget ? spent / p.hourlyBudget * 100 : 0) + '%';
    b.className = spent >= p.hourlyBudget * 0.9 ? 'full' : '';
  }

  function renderLog() {
    var ol = $('log'); ol.textContent = '';
    if (!state.log.length) { ol.appendChild(el('li', 'empty', 'Nothing yet.')); return; }
    state.log.forEach(function (l) {
      var li = el('li');
      li.appendChild(el('span', '', new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
      li.appendChild(el('span', l.decision, DEC[l.decision].split(' ')[0]));
      li.appendChild(el('span', '', l.method + ' $' + l.amount + ' #' + l.nonce + ' · ' + l.id));
      ol.appendChild(li);
    });
  }

  function propose(opts) {
    var p = opts && opts.p ? opts.p : proposal();
    var result = W.evaluate(policy(), p, state, Date.now(), opts && opts.approved ? { approved: true } : null);
    state = W.apply(state, p, result);
    if (result.decision === 'allow') { lastAllowed = Object.assign({}, p); $('q-nonce').value = nextNonce(); }
    pending = result.decision === 'approve' ? p : null;
    show(result, p); meter(); renderLog();
  }

  $('propose').addEventListener('click', function () { propose(); });
  $('d-approve').addEventListener('click', function () { if (pending) propose({ p: pending, approved: true }); });
  Array.prototype.forEach.call(document.querySelectorAll('.preset'), function (b) {
    b.addEventListener('click', function () { var p = PRESETS[b.getAttribute('data-p')](); setForm(p); propose({ p: proposal() }); });
  });
  ['p-budget', 'p-cap', 'p-approve', 'p-slip', 'p-paused'].forEach(function (id) { $(id).addEventListener('change', meter); });
  $('reset').addEventListener('click', function () {
    state = W.emptyState(); lastAllowed = null; pending = null;
    $('d-dec').className = 'dec'; $('d-dec').textContent = '—'; $('d-id').hidden = true; $('d-approve').hidden = true;
    $('d-note').textContent = 'Pick a preset or fill in a proposal, then send it to the wall.'; $('d-when').textContent = 'Waiting for a proposal';
    $('d-checks').textContent = ''; $('q-nonce').value = 1; meter(); renderLog();
  });
  meter();
})();
