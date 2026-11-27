/* Oxva Read page: form, the answer, the evidence and the rules. Logic lives in gate-core.js and read-core.js. */
(function () {
  'use strict';
  var G = window.OxvaGateCore, R = window.OxvaReadCore;
  var L = G.LIMITS, RU = R.RULES;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };

  // The nine contract checks with what each one reads. Used for the idle list and the rules table.
  var INFO = [
    { id: 'contract', label: 'Contract code', reads: 'Is the source code published? Can it be swapped out through a proxy?', pass: 'Verified, not upgradeable', warn: 'Upgradeable proxy', fail: 'Source not published' },
    { id: 'sell', label: 'Test sell', reads: 'A simulated buy and sell, plus a scan for honeypot code.', pass: 'Sell goes through', warn: '—', fail: 'Sell fails, or only part of a balance can be sold' },
    { id: 'buyTax', label: 'Buy tax', reads: 'Tax taken on every buy, from the simulation when available.', pass: '≤ ' + L.taxPass + '%', warn: '≤ ' + L.taxWarn + '%', fail: '> ' + L.taxWarn + '%' },
    { id: 'sellTax', label: 'Sell tax', reads: 'Tax taken on every sell, plus any wallet-to-wallet tax.', pass: '≤ ' + L.taxPass + '%', warn: '≤ ' + L.taxWarn + '%', fail: '> ' + L.taxWarn + '%' },
    { id: 'owner', label: 'Owner powers', reads: 'What an owner can still do: mint, pause, blacklist, change tax or balances, hide ownership.', pass: 'Renounced, or no risky switch', warn: 'Mint, pause, blacklist, cooldown', fail: 'Change tax or balances, hidden owner' },
    { id: 'liquidity', label: 'Liquidity depth', reads: 'USD in all pools for this token on the chain.', pass: '≥ ' + G.usd(L.liqPass), warn: '≥ ' + G.usd(L.liqWarn), fail: '< ' + G.usd(L.liqWarn) + ', or no pool' },
    { id: 'lpLock', label: 'Liquidity locked', reads: 'Share of LP tokens that are locked or burned.', pass: '≥ ' + L.lpLockPass + '%', warn: '≥ ' + L.lpLockWarn + '%, or unlocked in a deep pool', fail: 'Unlocked in a pool under ' + G.usd(L.liqPass) },
    { id: 'holders', label: 'Holder spread', reads: 'Supply held by the top 10 personal wallets. Pools, locks and burn wallets are left out.', pass: '≤ ' + L.top10Pass + '%', warn: '≤ ' + L.top10Warn + '%, or dev holds > ' + L.devWarn + '%', fail: '> ' + L.top10Warn + '%' },
    { id: 'activity', label: 'Market activity', reads: 'Pool age and buys versus sells over 24 hours.', pass: 'Over ' + L.newPoolDays + ' days, normal trading', warn: 'New pool, or under ' + L.minTx24h + ' trades', fail: 'Many buys, zero sells' }
  ];
  var ICON = { pass: '✓', warn: '!', fail: '✕', unknown: '?', wait: '', busy: '' };
  var STORE = 'oxva.read.recent';
  var running = false;

  /* ---------- helpers ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  function price(n) {
    if (n == null) return '—';
    if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 });
    var m = n.toFixed(20).match(/^0\.(0*)(\d{1,4})/);
    return m ? '$0.' + m[1] + m[2] : '$' + n.toPrecision(3);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduce ? 0 : ms); }); }
  function showMsg(t) { var m = $('msg'); m.textContent = t; m.hidden = !t; }

  /* ---------- the contract list ---------- */
  function renderChecks(state) {
    var ol = $('checks'); ol.textContent = '';
    INFO.forEach(function (c) {
      var li = el('li', 'check ' + state);
      li.appendChild(el('span', 'ic', ICON[state]));
      li.appendChild(el('span', 'c-label', c.label));
      li.appendChild(el('span', 'c-val', state === 'busy' ? 'reading…' : ''));
      li.appendChild(el('p', 'c-detail', c.reads));
      ol.appendChild(li);
    });
  }
  function fillCheck(c, i) {
    var li = $('checks').children[i];
    li.className = 'check ' + c.status;
    li.querySelector('.ic').textContent = ICON[c.status];
    li.querySelector('.c-val').textContent = c.value;
    li.querySelector('.c-detail').textContent = c.detail;
  }

  /* ---------- the market table ---------- */
  function renderWindows(m) {
    var tb = $('m-rows'); tb.textContent = '';
    R.WINDOWS.forEach(function (w, i) {
      var d = m && m.available ? m.windows[i] : null;
      var tr = el('tr');
      tr.appendChild(el('td', '', w.label));
      var pc = el('td', 'num', d && d.change != null ? R.pct(d.change) : '—');
      if (d && d.change != null) pc.className += d.change >= 0 ? ' pos' : ' neg';
      tr.appendChild(pc);
      tr.appendChild(el('td', 'num', d ? d.buys.toLocaleString('en-US') : '—'));
      tr.appendChild(el('td', 'num hide-sm', d ? d.sells.toLocaleString('en-US') : '—'));
      var td = el('td'), tr2 = el('div', 'ptrack' + (d && d.buys + d.sells ? '' : ' none')), b = el('b');
      var share = d && d.buys + d.sells ? d.buys / (d.buys + d.sells) : 0;
      b.style.width = Math.round(share * 100) + '%';
      tr2.appendChild(b); td.appendChild(tr2);
      td.title = d && d.buys + d.sells ? Math.round(share * 100) + '% of trades were buys' : 'No trades';
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    $('d-liq').textContent = m && m.available ? R.usd(m.liquidity) : '—';
    $('d-vol').textContent = m && m.available ? R.usd(m.volume24h) : '—';
    $('d-ratio').textContent = m && m.available ? m.ratio.toFixed(2) + '×' : '—';
  }

  /* ---------- the answer ---------- */
  function setAnswer(out) {
    var t = $('a-title'); t.className = 'a-title t-' + out.tone; t.textContent = out.title;
    var conv = $('a-conv'); conv.hidden = !out.conviction;
    if (out.conviction) {
      var dots = $('a-dots'); dots.textContent = '';
      for (var i = 1; i <= 5; i++) dots.appendChild(el('span', i <= out.conviction ? 'on' : ''));
      $('a-conv-text').textContent = 'Conviction ' + out.conviction + '/5';
    }
    $('a-reason').textContent = out.reason;
    var c = $('a-catch'); c.textContent = ''; c.appendChild(el('b', '', 'The catch. ')); c.appendChild(document.createTextNode(out.catch)); c.hidden = false;
  }

  function renderToken(tok, m) {
    var sub = $('a-sub'); sub.textContent = '';
    sub.appendChild(el('span', 'chainpill', tok.chainName));
    if (tok.holders) sub.appendChild(el('span', '', Math.round(tok.holders).toLocaleString('en-US') + ' holders'));
    $('a-name').textContent = tok.name + ' (' + tok.symbol + ')';
    $('a-addr').textContent = tok.address; $('a-addr').title = tok.address;
    $('s-price').textContent = price(tok.priceUsd);
    var ch = $('s-change'); ch.textContent = tok.change24h == null ? '—' : R.pct(tok.change24h);
    ch.className = tok.change24h == null ? '' : tok.change24h >= 0 ? 'pos' : 'neg';
    $('s-liq').textContent = G.usd(tok.liquidityUsd);
    $('s-vol').textContent = G.usd(tok.volume24h);
    var links = $('a-links'); links.textContent = '';
    if (tok.pairUrl) { var a = el('a', '', 'Chart on DexScreener ↗'); a.href = tok.pairUrl; a.target = '_blank'; a.rel = 'noopener'; links.appendChild(a); }
    var b = el('a', '', 'Contract on explorer ↗'); b.href = tok.explorerUrl; b.target = '_blank'; b.rel = 'noopener'; links.appendChild(b);
    var other = $('a-other'); other.hidden = !tok.otherChains.length;
    if (tok.otherChains.length) other.textContent = 'Also trades on ' + tok.otherChains.join(', ') + '. Pick that chain above to read it there.';
    $('a-more').hidden = false;
  }

  function renderSources(sources) {
    var s = $('sources'); s.textContent = '';
    sources.forEach(function (x) { s.appendChild(el('span', x.skipped ? 'skip' : x.ok ? '' : 'off', x.name + (x.skipped ? ' (not on this chain)' : x.ok ? '' : ' (unavailable)'))); });
  }

  /* ---------- recent reads (this browser only) ---------- */
  function loadRecent() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; } }
  function saveRecent(item) {
    var list = loadRecent().filter(function (x) { return !(x.a.toLowerCase() === item.a.toLowerCase() && x.c === item.c); });
    list.unshift(item); list = list.slice(0, 8);
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
    renderRecent();
  }
  function renderRecent() {
    var list = loadRecent(), box = $('recent-list'); box.textContent = '';
    $('recent').hidden = !list.length;
    list.forEach(function (x) {
      var b = el('button'); b.type = 'button';
      b.appendChild(el('span', 'dot ' + x.v)); b.appendChild(document.createTextNode(x.s));
      b.appendChild(el('small', '', (G.CHAINS[x.c] || {}).name || x.c));
      b.addEventListener('click', function () { $('address').value = x.a; $('chain').value = x.c; run(); });
      box.appendChild(b);
    });
  }

  /* ---------- run ---------- */
  var ERRORS = {
    BAD_ADDRESS: 'That does not look like a token address. It starts with 0x and has 42 characters in total.',
    NO_MARKET: 'No trading pool found for this address on Robinhood Chain, Ethereum, BNB Chain, Base, Arbitrum or Polygon. If you know the chain, pick it above and read again.',
    SOURCE_DOWN: 'Could not reach DexScreener to find the token’s chain. Pick the chain above, or try again in a minute.',
    BAD_CHAIN: 'That chain is not supported yet.'
  };

  function resetAnswer(addr) {
    $('a-more').hidden = true;
    $('a-sub').textContent = ''; $('a-sub').appendChild(el('span', '', short(addr)));
    $('a-name').textContent = 'Reading…';
    var t = $('a-title'); t.className = 'a-title'; t.textContent = 'Reading';
    $('a-conv').hidden = true; $('a-catch').hidden = true;
    $('a-reason').textContent = 'Reading pools, simulating a sell and checking the contract…';
  }

  function run() {
    if (running) return;
    var addr = $('address').value.trim(), chain = $('chain').value;
    showMsg('');
    if (!G.isAddress(addr)) { showMsg(ERRORS.BAD_ADDRESS); $('address').focus(); return; }
    running = true; $('run').disabled = true; $('run').textContent = 'Reading…';
    try { history.replaceState(null, '', '?t=' + addr + (chain !== 'auto' ? '&c=' + chain : '')); } catch (e) { /* ignore */ }
    resetAnswer(addr); renderChecks('busy'); renderWindows(null);

    G.gather(addr, chain).then(function (data) {
      var safety = G.evaluate(data), m = R.market(data.pairs), out = R.combine(m, safety);
      renderToken(safety.token, m);
      renderWindows(m);
      $('m-time').textContent = 'Read ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var p = Promise.resolve();
      safety.checks.forEach(function (c, i) { p = p.then(function () { fillCheck(c, i); return wait(90); }); });
      return p.then(function () {
        $('c-count').textContent = safety.counts.pass + ' pass · ' + safety.counts.warn + ' note' + (safety.counts.warn === 1 ? '' : 's') + ' · ' + safety.counts.fail + ' fail';
        renderSources(safety.sources);
        setAnswer(out);
        if (chain === 'auto') $('chain').value = data.chain;
        saveRecent({ a: addr, c: data.chain, s: safety.token.symbol, v: out.tone });
      });
    }).catch(function (e) {
      renderChecks('wait'); renderWindows(null);
      $('a-name').textContent = 'No read';
      var t = $('a-title'); t.className = 'a-title'; t.textContent = 'No answer';
      $('a-reason').textContent = 'The data needed for a read could not be loaded, so Oxva gives no answer rather than a guess.';
      showMsg(ERRORS[e.code] || 'Something went wrong while reading the chain (' + e.message + '). Try again in a minute.');
    }).then(function () { running = false; $('run').disabled = false; $('run').textContent = 'Read it →'; });
  }

  /* ---------- rules tables ---------- */
  function renderRules() {
    var rows = [
      ['Price trend', 'Each window’s price move is squashed to −1…+1 (a move of ' + R.WINDOWS.map(function (w) { return w.strong + '% in ' + w.label; }).join(', ') + ' counts as strong; for Robinhood stock tokens a quarter of that, since stocks move less) and weighted ' + R.WINDOWS.map(function (w) { return Math.round(w.weight * 100) + '% ' + w.label; }).join(', ') + '.'],
      ['Order flow', 'Buys minus sells over all trades, per window, with the same weights. A window needs at least ' + RU.minWindowTrades + ' trades to count.'],
      ['Score', Math.round(RU.trendShare * 100) + '% price trend + ' + Math.round((1 - RU.trendShare) * 100) + '% order flow, from −1 to +1.'],
      ['Lean', 'Leaning up at +' + RU.leanAt + ' or more, leaning down at −' + RU.leanAt + ' or less, otherwise no clear edge.'],
      ['Conviction', 'Starts at 1 and rises at a score of ' + RU.convictionSteps.join(', ') + '. Capped at 2 when price and flow disagree; minus 1 when liquidity is under ' + R.usd(RU.thinLiquidity) + ' or a day’s volume is under ' + RU.quietRatio * 100 + '% of liquidity.'],
      ['No read', 'Fewer than ' + RU.minDayTrades + ' trades in 24 hours: no clear edge, conviction 1.']
    ];
    var tb = $('rules-market');
    rows.forEach(function (r) { var tr = el('tr'); tr.appendChild(el('td', '', r[0])); tr.appendChild(el('td', '', r[1])); tb.appendChild(tr); });
    var tc = $('rules-contract');
    INFO.forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', '', c.label)); tr.appendChild(el('td', '', c.reads));
      [['p', c.pass], ['w', c.warn], ['f', c.fail]].forEach(function (x) { var td = el('td'); td.appendChild(el('span', 't ' + x[0], x[1])); tr.appendChild(td); });
      tc.appendChild(tr);
    });
  }

  /* ---------- wire up ---------- */
  $('read-form').addEventListener('submit', function (e) { e.preventDefault(); run(); });
  Array.prototype.forEach.call(document.querySelectorAll('.ex'), function (b) {
    b.addEventListener('click', function () { $('address').value = b.dataset.a; $('chain').value = b.dataset.c; run(); });
  });
  $('address').addEventListener('paste', function () { setTimeout(function () { if (G.isAddress($('address').value)) run(); }, 0); });
  $('copy-addr').addEventListener('click', function () {
    var btn = this, text = $('a-addr').textContent;
    var done = function () { btn.textContent = 'COPIED'; btn.classList.add('done'); setTimeout(function () { btn.textContent = 'COPY'; btn.classList.remove('done'); }, 1500); };
    try { navigator.clipboard.writeText(text).then(done, function () {}); } catch (e) { /* no clipboard */ }
  });

  // Share this read: the address bar already holds ?t=<address>, so the link opens the same token
  if (window.OxvaUI && OxvaUI.shareButton) $('share-slot').replaceWith(OxvaUI.shareButton(function () {
    var name = $('a-name').textContent, verdict = $('a-title').textContent;
    return { url: location.pathname + location.search, title: 'Oxva read: ' + name, text: 'Oxva read on ' + name + ': ' + verdict + '.' };
  }));

  renderChecks('wait'); renderWindows(null); renderRules(); renderRecent();
  var q = new URLSearchParams(location.search), t = q.get('t'), c = q.get('c');
  if (c && G.CHAINS[c]) $('chain').value = c;
  if (t && G.isAddress(t)) { $('address').value = t; run(); }
})();
