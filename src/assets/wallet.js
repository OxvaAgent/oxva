/* Oxva wallet picker.
 * Finds every browser wallet the visitor has installed through EIP-6963 (MetaMask, Rabby, Coinbase Wallet,
 * OKX, Trust, Phantom, Brave, Rainbow, Zerion, Bitget and any other wallet that announces itself), falls back
 * to window.ethereum for older wallets, and offers "open in wallet app" links for phones.
 * It only forwards requests to the wallet the visitor picks: keys and seed phrases never pass through here. */
(function () {
  'use strict';
  var el = window.OxvaUI.el;
  var KEY = 'oxva.wallet';
  var found = new Map();
  var current = null;
  var subs = [];
  var dlg = null, pending = null;

  /* ---------- discovery ---------- */
  window.addEventListener('eip6963:announceProvider', function (e) {
    var d = e.detail;
    if (!d || !d.info || !d.provider || typeof d.provider.request !== 'function') return;
    found.set(d.info.rdns || d.info.uuid || d.info.name, d);
    if (dlg && dlg.open) renderList();
  });
  function ask() { try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* very old browser */ } }
  ask();

  function nameOf(p) {
    if (p.isRabby) return 'Rabby';
    if (p.isCoinbaseWallet) return 'Coinbase Wallet';
    if (p.isOkxWallet || p.isOKExWallet) return 'OKX Wallet';
    if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
    if (p.isPhantom) return 'Phantom';
    if (p.isBraveWallet) return 'Brave Wallet';
    if (p.isRainbow) return 'Rainbow';
    if (p.isZerion) return 'Zerion';
    if (p.isBitKeep || p.isBitget) return 'Bitget Wallet';
    if (p.isMetaMask) return 'MetaMask';
    return 'Browser wallet';
  }
  function legacy() {
    var e = window.ethereum;
    if (!e || typeof e.request !== 'function') return [];
    var list = Array.isArray(e.providers) && e.providers.length ? e.providers : [e];
    return list.map(function (p, i) { var n = nameOf(p); return { info: { uuid: 'legacy-' + i, name: n, icon: '', rdns: 'legacy.' + n.toLowerCase().replace(/\s+/g, '') }, provider: p }; });
  }
  function wallets() {
    var list = Array.from(found.values());
    return list.length ? list : legacy();
  }
  // icons come from the wallet itself; only accept image data URIs
  function icon(src) { return typeof src === 'string' && /^data:image\/(png|svg\+xml|webp|jpe?g|gif)[;,]/i.test(src) ? src : ''; }

  /* ---------- phone + install links ---------- */
  var INSTALL = [
    ['MetaMask', 'https://metamask.io/download/'],
    ['Rabby', 'https://rabby.io/'],
    ['Coinbase Wallet', 'https://www.coinbase.com/wallet/downloads'],
    ['OKX Wallet', 'https://web3.okx.com/download'],
    ['Trust Wallet', 'https://trustwallet.com/download'],
    ['Rainbow', 'https://rainbow.me/download']
  ];
  function deepLinks() {
    var url = location.href, hostPath = location.host + location.pathname + location.search;
    return [
      ['MetaMask', 'https://metamask.app.link/dapp/' + hostPath],
      ['Trust Wallet', 'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(url)],
      ['Coinbase Wallet', 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(url)],
      ['OKX Wallet', 'okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(url)]
    ];
  }
  var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  /* ---------- WalletConnect: scan a QR code with a phone wallet ---------- */
  var WC_SRC = '/assets/vendor/walletconnect.js';
  var WC_CHAINS = [4663, 46630, 1]; // Robinhood Chain mainnet and testnet, plus Ethereum so every wallet can approve the session
  var WC_RPC = { 4663: 'https://rpc.mainnet.chain.robinhood.com', 46630: 'https://rpc.testnet.chain.robinhood.com' };
  var wc = null, wcStarting = null, wcLoading = null;
  function wcEnabled() { return !!(window.OXVA_WC && window.OXVA_WC.projectId); }
  function wcLoad() {
    if (window.OxvaWC) return Promise.resolve(window.OxvaWC);
    if (wcLoading) return wcLoading;
    wcLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = WC_SRC; s.async = true;
      s.onload = function () { window.OxvaWC ? resolve(window.OxvaWC) : reject(new Error('WalletConnect did not load.')); };
      s.onerror = function () { wcLoading = null; s.remove(); reject(new Error('WalletConnect could not be loaded. Check your connection.')); };
      document.head.appendChild(s);
    });
    return wcLoading;
  }
  function wcInit() {
    if (wc) return Promise.resolve(wc);
    if (wcStarting) return wcStarting; // the nav and the vault page may both ask at once: share one session
    wcStarting = wcLoad().then(function (lib) {
      return lib.EthereumProvider.init({
        projectId: window.OXVA_WC.projectId,
        showQrModal: false,
        optionalChains: WC_CHAINS,
        rpcMap: WC_RPC,
        metadata: { name: 'Oxva', description: 'Reads the market, guards every move.', url: location.origin, icons: [location.origin + '/assets/brand/icon-512.png'] }
      });
    }).then(function (p) {
      wc = p;
      p.on('display_uri', onUri);
      p.on('disconnect', function () { if (current && current.provider === p) onAccounts([]); });
      return p;
    }, function (e) { wcStarting = null; throw e; });
    return wcStarting;
  }
  function wcEntry(p) {
    var peer = p.session && p.session.peer && p.session.peer.metadata;
    return { info: { uuid: 'walletconnect', name: (peer && peer.name ? peer.name + ' via WalletConnect' : 'WalletConnect'), icon: '', rdns: 'walletconnect' }, provider: p };
  }

  /* Speed: the bundle downloads while the browser is idle (no network contact with WalletConnect yet). When the
   * visitor shows intent (hovers the button, opens the picker) the relay connection and a pairing code are
   * prepared, so the QR is on screen the moment they choose "Scan with your phone". */
  var pairing = null, pairGen = 0, lastUri = null, uriAt = 0, wantQr = false;
  var URI_FRESH_MS = 4 * 60 * 1000; // pairing codes expire after five minutes
  function onUri(uri) { lastUri = uri; uriAt = Date.now(); if (wantQr) drawQr(uri); }
  function startPairing(p) {
    if (pairing && lastUri && Date.now() - uriAt > URI_FRESH_MS) { pairing = null; lastUri = null; } // stale code: make a new one
    if (pairing) return pairing;
    var gen = ++pairGen; lastUri = null;
    pairing = p.connect().then(function (r) { if (gen === pairGen) pairing = null; return r; },
      function (e) { if (gen === pairGen) { pairing = null; lastUri = null; } throw e; });
    pairing.catch(function () { /* whoever awaits it reports the error */ });
    return pairing;
  }
  function warm(pair) {
    if (!wcEnabled() || (current && current.provider === wc && wc)) return;
    wcInit().then(function (p) { if (pair && !p.session) startPairing(p); }, function () { /* tried again on click */ });
  }

  var qrShown = false;
  function drawQr(uri) {
    qrShown = true;
    var box = document.getElementById('wdlg-qr'); if (!box) return;
    box.hidden = false;
    var qr = window.OxvaWC.qrcode(0, 'M'); qr.addData(uri); qr.make();
    var n = qr.getModuleCount(), quiet = 3, cell = 6, size = (n + quiet * 2) * cell;
    var cv = document.getElementById('wdlg-qr-canvas'); cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#15140f';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    document.getElementById('wdlg-qr-wait').hidden = true; cv.hidden = false;
    var open = document.getElementById('wdlg-qr-open'); open.href = uri;
    var copy = document.getElementById('wdlg-qr-copy');
    copy.onclick = function () {
      var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy link'; }, 1500); };
      try { navigator.clipboard.writeText(uri).then(done, function () {}); } catch (e) { /* no clipboard */ }
    };
  }

  async function chooseWc(btn) {
    btn.disabled = true;
    var box = document.getElementById('wdlg-qr');
    box.hidden = false; document.getElementById('wdlg-qr-canvas').hidden = true; document.getElementById('wdlg-qr-wait').hidden = false;
    say('Scan the code with your phone wallet, then approve the connection there.');
    qrShown = false; wantQr = true;
    try {
      var p = await wcInit();
      if (p.session && !pairing) { try { await p.disconnect(); } catch (e) { /* stale session */ } }
      var conn = startPairing(p);
      if (lastUri) drawQr(lastUri); // prepared in advance: show it at once
      var stalled = new Promise(function (_, reject) {
        setTimeout(function () { if (!qrShown) reject(new Error('WalletConnect is not answering right now. Try again in a minute.')); }, 15000);
      });
      await Promise.race([conn, stalled]);
      var w = wcEntry(p);
      use(w);
      try { localStorage.setItem(KEY, 'walletconnect'); } catch (e) { /* storage blocked */ }
      box.hidden = true; say('');
      var pend = pending; pending = null; dlg.close(); if (pend) pend.resolve(w);
    } catch (e) {
      box.hidden = true;
      say(/rejected|denied|4001/i.test((e && e.message) || '') ? 'You declined the connection in your wallet.' : 'WalletConnect did not connect: ' + ((e && e.message) || e), true);
    }
    wantQr = false;
    btn.disabled = false;
  }

  /* ---------- dialog ---------- */
  function build() {
    dlg = el('dialog', 'wdlg'); dlg.setAttribute('aria-labelledby', 'wdlg-title');
    var head = el('div', 'wdlg-head');
    var h = el('h2', '', 'Connect a wallet'); h.id = 'wdlg-title'; head.appendChild(h);
    var x = el('button', 'wdlg-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', function () { close(new Error('closed')); });
    head.appendChild(x); dlg.appendChild(head);
    dlg.appendChild(el('p', 'wdlg-sub', 'Pick the wallet you want to use. Every wallet installed in this browser is listed.'));
    var list = el('div', 'wdlg-list'); list.id = 'wdlg-list'; dlg.appendChild(list);
    if (wcEnabled()) {
      var wcb = el('button', 'wdlg-w wdlg-wc'); wcb.type = 'button'; wcb.id = 'wdlg-wc';
      wcb.appendChild(el('span', 'wdlg-ph wdlg-qrph', '▦'));
      wcb.appendChild(el('span', 'wdlg-name', 'Scan with your phone'));
      wcb.appendChild(el('span', 'wdlg-tag', 'WalletConnect'));
      wcb.addEventListener('click', function () { chooseWc(wcb); });
      dlg.appendChild(wcb);
      var qrBox = el('div', 'wdlg-qr'); qrBox.id = 'wdlg-qr'; qrBox.hidden = true;
      var wait = el('p', 'wdlg-qr-wait', 'Preparing a secure code…'); wait.id = 'wdlg-qr-wait'; qrBox.appendChild(wait);
      var cv = el('canvas'); cv.id = 'wdlg-qr-canvas'; cv.hidden = true; cv.setAttribute('aria-label', 'QR code to scan with a phone wallet'); qrBox.appendChild(cv);
      qrBox.appendChild(el('p', 'wdlg-note', 'Open your wallet app (MetaMask, Trust, OKX, Rainbow, Bitget, Zerion…), tap scan, and point it here.'));
      var acts = el('div', 'wdlg-qr-acts');
      var cp = el('button', 'small-btn', 'Copy link'); cp.type = 'button'; cp.id = 'wdlg-qr-copy'; acts.appendChild(cp);
      var op = el('a', 'small-btn', 'Open in wallet on this phone'); op.id = 'wdlg-qr-open'; op.rel = 'noopener'; acts.appendChild(op);
      qrBox.appendChild(acts);
      dlg.appendChild(qrBox);
    }
    var msg = el('p', 'wdlg-msg'); msg.id = 'wdlg-msg'; msg.setAttribute('role', 'status'); dlg.appendChild(msg);

    var phone = el('details', 'wdlg-more'); if (mobile) phone.open = true;
    phone.appendChild(el('summary', '', 'On your phone? Open Oxva inside your wallet app'));
    var pl = el('div', 'wdlg-links');
    deepLinks().forEach(function (d) { var a = el('a', '', d[0] + ' ↗'); a.href = d[1]; a.rel = 'noopener'; pl.appendChild(a); });
    phone.appendChild(pl);
    phone.appendChild(el('p', 'wdlg-note', 'This opens this page in the wallet’s own browser, where it connects like a browser wallet.'));
    dlg.appendChild(phone);

    var get = el('details', 'wdlg-more');
    get.appendChild(el('summary', '', 'No wallet yet? Get one'));
    var gl = el('div', 'wdlg-links');
    INSTALL.forEach(function (d) { var a = el('a', '', d[0] + ' ↗'); a.href = d[1]; a.target = '_blank'; a.rel = 'noopener'; gl.appendChild(a); });
    get.appendChild(gl); dlg.appendChild(get);

    dlg.appendChild(el('p', 'wdlg-safe', 'Oxva never sees your keys or seed phrase, and will never ask for them. Anyone who does is a scammer.'));
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(new Error('closed')); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(new Error('closed')); });
    document.body.appendChild(dlg);
  }

  function renderList() {
    var list = document.getElementById('wdlg-list'); if (!list) return;
    list.textContent = '';
    var ws = wallets();
    if (!ws.length) { list.appendChild(el('p', 'wdlg-none', mobile ? 'No wallet found in this browser. Open Oxva inside your wallet app below.' : 'No wallet found in this browser. Install one below, then reload this page.')); return; }
    ws.forEach(function (w) {
      var b = el('button', 'wdlg-w'); b.type = 'button';
      var src = icon(w.info.icon);
      if (src) { var img = el('img'); img.src = src; img.alt = ''; img.width = 28; img.height = 28; b.appendChild(img); }
      else b.appendChild(el('span', 'wdlg-ph', (w.info.name || '?').slice(0, 1)));
      b.appendChild(el('span', 'wdlg-name', w.info.name || 'Browser wallet'));
      b.appendChild(el('span', 'wdlg-tag', 'Detected'));
      b.addEventListener('click', function () { choose(w, b); });
      list.appendChild(b);
    });
  }

  function say(t, err) { var m = document.getElementById('wdlg-msg'); if (m) { m.textContent = t; m.className = 'wdlg-msg' + (err ? ' err' : ''); } }

  async function choose(w, btn) {
    btn.disabled = true; say('Waiting for ' + (w.info.name || 'your wallet') + '… confirm the connection there.');
    try {
      await w.provider.request({ method: 'eth_requestAccounts' });
      use(w);
      try { localStorage.setItem(KEY, w.info.rdns || w.info.name); } catch (e) { /* storage blocked */ }
      say('');
      var p = pending; pending = null; dlg.close(); if (p) p.resolve(w);
    } catch (e) {
      btn.disabled = false;
      say(e && (e.code === 4001 || e.code === 'ACTION_REJECTED') ? 'You cancelled the connection in your wallet.' : 'The wallet did not connect: ' + ((e && e.message) || e), true);
    }
  }

  function close(err) { wantQr = false; if (dlg && dlg.open) dlg.close(); var p = pending; pending = null; if (p) p.reject(err); }

  /* ---------- current wallet + events ---------- */
  var bound = null;
  function emit(type) { subs.forEach(function (f) { try { f(type, current); } catch (e) { /* subscriber error */ } }); }
  function onAccounts(a) { if (!a || !a.length) { current = null; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } emit('disconnect'); } else emit('accounts'); }
  function onChain() { emit('chain'); }
  function use(w) {
    if (bound && bound.removeListener) { bound.removeListener('accountsChanged', onAccounts); bound.removeListener('chainChanged', onChain); }
    current = w; bound = w.provider;
    if (bound.on) { bound.on('accountsChanged', onAccounts); bound.on('chainChanged', onChain); }
    emit('connect');
  }

  window.OxvaWallet = {
    /** Opens the picker. Resolves with { info, provider } once the visitor has approved the connection. */
    connect: function () {
      ask();
      if (!dlg) build();
      renderList(); say('');
      warm(true); // prepare the QR while the visitor looks at the list
      if (!dlg.open) dlg.showModal();
      return new Promise(function (resolve, reject) { pending = { resolve: resolve, reject: reject }; });
    },
    /** Reconnects silently to the wallet used last time, if it is still installed and still authorized. */
    restore: function () {
      var saved; try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
      if (!saved) return Promise.resolve(null);
      if (saved === 'walletconnect') {
        if (!wcEnabled()) return Promise.resolve(null);
        return wcInit().then(function (p) { if (p.session && p.accounts && p.accounts.length) { var w = wcEntry(p); use(w); return w; } return null; }, function () { return null; });
      }
      return new Promise(function (r) { setTimeout(r, 350); }).then(function () {
        var w = wallets().filter(function (x) { return (x.info.rdns || x.info.name) === saved; })[0];
        if (!w) return null;
        return w.provider.request({ method: 'eth_accounts' }).then(function (a) { if (a && a.length) { use(w); return w; } return null; }, function () { return null; });
      });
    },
    /** Forgets the wallet here and asks it to drop this site's permission where the wallet supports that. */
    disconnect: function () {
      var w = current; current = null;
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      if (w && w.provider === wc) wc.disconnect().catch(function () { /* already gone */ });
      else if (w) w.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(function () { /* not supported */ });
      emit('disconnect');
    },
    /** Prepares WalletConnect ahead of time, pairing code included (call on hover, focus or touch of a connect button). */
    warm: function () { warm(true); },
    current: function () { return current; },
    on: function (f) { subs.push(f); },
    count: function () { return wallets().length; }
  };

  // download the WalletConnect bundle while the browser is idle, unless the visitor asked to save data
  if (wcEnabled()) window.addEventListener('load', function () {
    if (navigator.connection && navigator.connection.saveData) return;
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1500); };
    setTimeout(function () { idle(function () { wcLoad().catch(function () { /* tried again on click */ }); }); }, 1200);
  });
})();
