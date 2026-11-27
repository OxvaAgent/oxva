/* The "Connect wallet" button in the nav, on every page.
 * Uses the shared picker in wallet.js (any EIP-6963 browser wallet, or window.ethereum). Once connected it shows
 * the address; clicking it opens a small menu with the wallet, the network, a link to the vault and Disconnect.
 * Connecting only shares the address: nothing is signed or sent from here. Wallet names are set as text only. */
(function () {
  'use strict';
  var W = window.OxvaWallet, el = window.OxvaUI.el;
  var btn = document.getElementById('nav-wallet');
  if (!W || !btn) return;
  var CHAINS = { 4663: 'Robinhood Chain', 46630: 'Robinhood Chain testnet', 1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 56: 'BNB Chain', 137: 'Polygon' };
  var state = { account: null, chain: null };
  var menu = null;

  function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }

  async function read() {
    var c = W.current();
    if (!c) { state.account = null; state.chain = null; return; }
    try {
      var r = await Promise.all([c.provider.request({ method: 'eth_accounts' }), c.provider.request({ method: 'eth_chainId' })]);
      state.account = r[0] && r[0][0] ? String(r[0][0]) : null;
      state.chain = r[1] ? parseInt(r[1], 16) : null;
    } catch (e) { state.account = null; state.chain = null; }
  }

  function render() {
    btn.textContent = '';
    if (!state.account) {
      btn.className = 'btn btn-line nav-wallet';
      btn.appendChild(el('span', 'nw-long', 'Connect wallet'));
      btn.appendChild(el('span', 'nw-short', 'Connect'));
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.removeAttribute('aria-expanded');
      closeMenu();
    } else {
      btn.className = 'btn btn-line nav-wallet on';
      var known = state.chain === 4663 || state.chain === 46630;
      btn.appendChild(el('i', 'nw-dot' + (known ? '' : ' off')));
      btn.appendChild(el('span', 'nw-long', short(state.account)));
      btn.appendChild(el('span', 'nw-short', state.account.slice(0, 4) + '…' + state.account.slice(-2)));
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', menu && !menu.hidden ? 'true' : 'false');
      if (menu && !menu.hidden) fillMenu();
    }
    btn.hidden = false;
  }

  async function refresh() { await read(); render(); }

  /* ---------- the small menu once connected ---------- */
  function buildMenu() {
    menu = el('div', 'nw-menu'); menu.id = 'nw-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    btn.parentNode.insertBefore(menu, btn.nextSibling);
    document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); btn.focus(); } });
  }
  function fillMenu() {
    var c = W.current(); menu.textContent = '';
    menu.appendChild(el('p', 'nw-name', (c && c.info && c.info.name) || 'Wallet'));
    var a = el('p', 'nw-addr', state.account); menu.appendChild(a);
    var known = state.chain === 4663 || state.chain === 46630;
    menu.appendChild(el('p', 'nw-net' + (known ? '' : ' off'), state.chain == null ? 'Network unknown' : (CHAINS[state.chain] || 'Chain ' + state.chain)));
    var acts = el('div', 'nw-acts');
    var v = el('a', '', 'Open the vault →'); v.href = '/vault/'; v.setAttribute('role', 'menuitem'); acts.appendChild(v);
    var cp = el('button', '', 'Copy address'); cp.type = 'button'; cp.setAttribute('role', 'menuitem');
    cp.addEventListener('click', function () {
      var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy address'; }, 1400); };
      if (navigator.clipboard) navigator.clipboard.writeText(state.account).then(done, function () { /* blocked */ }); else done();
    });
    acts.appendChild(cp);
    var off = el('button', 'nw-off', 'Disconnect'); off.type = 'button'; off.setAttribute('role', 'menuitem');
    off.addEventListener('click', function () { closeMenu(); W.disconnect(); });
    acts.appendChild(off);
    menu.appendChild(acts);
  }
  function openMenu() { if (!menu) buildMenu(); fillMenu(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  function closeMenu() { if (menu && !menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }

  btn.addEventListener('click', function () {
    if (!state.account) { W.connect().then(refresh, function () { /* closed the picker */ }); return; }
    if (menu && !menu.hidden) closeMenu(); else openMenu();
  });
  ['pointerenter', 'focus', 'touchstart'].forEach(function (ev) { btn.addEventListener(ev, function () { if (!state.account && W.warm) W.warm(); }, { passive: true }); });
  W.on(function () { refresh(); });

  render();
  W.restore().then(refresh, function () { /* wallet locked */ });
})();
