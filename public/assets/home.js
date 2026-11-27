/* Oxva home: the hero stats, the live vault, latest calls, the record, the status line. The mark is src/assets/logo3d.js. */
(function () {
  'use strict';
  var U = window.OxvaUI;
  var $ = function (id) { return document.getElementById(id); };
  /* ---------- the live vault (address filled in at build time) ---------- */
  (function liveVault() {
    var box = $('live-ca'); if (!box) return;
    var a = box.getAttribute('data-addr') || '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { box.hidden = true; return; }
    $('live-short').textContent = a.slice(0, 6) + '…' + a.slice(-6);
    $('live-short').title = a;
    var btn = $('live-copy');
    btn.addEventListener('click', function () {
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1400); };
      if (navigator.clipboard) navigator.clipboard.writeText(a).then(done, function () { /* blocked */ });
    });
  })();

  /* ---------- $OXVA on DexScreener ----------
   * The DexScreener page for the official contract only works once DexScreener has indexed a pool for it. Until then the
   * button would open "Token or Pair Not Found", so it points to the token on the explorer and says the listing is pending.
   * Look-alike tokens may have their own pages there: only the official contract (data-ca) is ever linked. */
  (function dexCheck() {
    var btn = $('tok-dex'), row = $('tok-chart'); if (!btn) return;
    var ca = btn.getAttribute('data-ca') || '', explorer = btn.getAttribute('data-explorer') || '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(ca) || !/^https:\/\/robinhoodchain\.blockscout\.com\//.test(explorer)) return;
    fetch('https://api.dexscreener.com/tokens/v1/robinhood/' + ca, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (pairs) {
        if (!Array.isArray(pairs)) return; // DexScreener did not answer: keep the link as it is
        var mine = pairs.filter(function (p) { return p && p.baseToken && String(p.baseToken.address).toLowerCase() === ca.toLowerCase(); });
        if (mine.length) return; // listed: the DexScreener link works
        btn.href = explorer; btn.textContent = 'Explorer '; btn.appendChild(U.el('span', 'arr', '↗'));
        if (row) { row.textContent = 'DexScreener listing pending. '; var a = U.el('a', '', 'See the token on the explorer ↗'); a.href = explorer; a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a); }
      }, function () { /* offline: keep the link */ });
  })();

  /* ---------- the record as a picture: share of working / against / invalidated, and the last graded calls ---------- */
  var STATUS = { working: 'Working', against: 'Against', invalidated: 'Invalidated' };
  function recordChart(r, calls, now) {
    var bar = $('rec-bar'), key = $('rec-key'), list = $('rec-list');
    if (!bar || !list) return;
    bar.textContent = ''; key.textContent = '';
    if (r.graded) {
      [['w', r.working, 'working'], ['a', r.against, 'against'], ['x', r.invalidated, 'invalidated']].forEach(function (p) {
        var i = U.el('i', p[0]); i.style.width = (100 * p[1] / r.graded) + '%'; bar.appendChild(i);
        key.appendChild(U.el('span', 's-' + p[2], p[1] + ' ' + p[2]));
      });
    } else bar.hidden = true;
    var graded = calls.filter(function (c) { return (c.action === 'BUY' || c.action === 'SELL') && STATUS[c.status]; })
      .sort(function (a, b) { return b.at - a.at; }).slice(0, 5);
    list.textContent = '';
    if (!graded.length) { list.appendChild(U.el('li', 'when', 'No buy or sell call has been graded yet.')); return; }
    graded.forEach(function (c) {
      var li = U.el('li'), what = U.el('span', 'what');
      what.appendChild(U.el('b', '', c.sym + ' ' + c.action));
      var mv = c.now && c.now.move != null ? ' · ' + (c.now.move > 0 ? '+' : '') + Number(c.now.move).toFixed(1) + '% since' : '';
      what.appendChild(document.createTextNode(' at ' + U.price(c.price) + mv));
      li.appendChild(what);
      li.appendChild(U.el('span', 'when', U.ago(c.at, now)));
      li.appendChild(U.el('span', 'st s-' + c.status, STATUS[c.status] + (c.final && c.status !== 'invalidated' ? ' · closed' : '')));
      list.appendChild(li);
    });
  }

  /* ---------- calls, record, status ---------- */
  var grid = $('latest-grid');
  U.skeletonCards(grid, 6);

  U.getCalls().then(function (d) {
    var now = Date.now();
    var latest = d.latest.slice().sort(function (a, b) { return (b.conviction - a.conviction) || (b.at - a.at); }).slice(0, 6);
    grid.textContent = '';
    latest.forEach(function (c) { grid.appendChild(U.callCard(c, now)); });
    if (!latest.length) { grid.textContent = ''; grid.appendChild(U.el('p', 'notice', 'The first batch of calls is being made. Check back in a minute.')); }
    $('latest-time').textContent = d.updatedAt ? 'Graded ' + U.ago(d.updatedAt, now) + ' · next call in ' + U.until(d.nextCallAt, now) : '';

    var newest = d.calls.length ? d.calls[0].at : null;
    $('status-last').textContent = newest ? 'Last batch ran ' + U.ago(newest, now) + ' · next in ' + U.until(d.nextCallAt, now) : 'Making its first calls';
    // proof above the fold: the newest buy or sell call that has a grade, whatever the grade is (no picking winners)
    var GRADED = { working: 'Working', against: 'Against', invalidated: 'Invalidated' };
    var proof = d.calls.filter(function (c) { return (c.action === 'BUY' || c.action === 'SELL') && GRADED[c.status]; })
      .sort(function (a, b) { return b.at - a.at; })[0];
    var sub = $('hs-last-sub'); sub.textContent = '';
    if (proof) {
      $('hs-last').textContent = proof.sym + ' ' + proof.action;
      sub.appendChild(U.el('span', 's-' + proof.status, GRADED[proof.status]));
      var moved = proof.now && proof.now.at > proof.at && proof.now.move != null ? ' · ' + U.pct(proof.now.move) + ' since' : '';
      sub.appendChild(document.createTextNode(moved + ' · ' + U.ago(proof.at, now)));
    } else {
      $('hs-last').textContent = 'None yet';
      sub.textContent = 'The first buy or sell call is being graded';
    }
    $('hs-total').textContent = String(d.record.total);
    var chains = {}; (d.universe || []).forEach(function (t) { chains[t.chain] = 1; });
    $('hs-tokens').textContent = String((d.universe || []).length);
    $('hs-tokens-sub').textContent = 'On ' + Object.keys(chains).length + ' chains, every four hours';

    var r = d.record;
    $('rec-total').textContent = r.total;
    $('rec-graded').textContent = r.graded;
    $('rec-working').textContent = r.working;
    $('rec-rate').textContent = r.hitRate == null ? '—' : r.hitRate + '%';
    recordChart(r, d.calls, now);
    U.recordContext($('rec-context'), d.context);
    $('rec-note').textContent = r.graded ? r.against + ' against · ' + r.invalidated + ' invalidated · ' + r.waits + ' waits' : 'No buy or sell call has been graded yet. The record fills in over the next days.';
  }).catch(function () {
    grid.textContent = '';
    grid.appendChild(U.el('p', 'notice err', 'Calls could not be loaded right now. Try again in a minute.'));
    $('status-last').textContent = 'Calls unavailable right now';
    $('hs-last-sub').textContent = 'Unavailable right now';
    $('hs-tokens-sub').textContent = 'Unavailable right now';
    $('rec-note').textContent = 'The record could not be loaded right now.';
    var l = $('rec-list'); if (l) { l.textContent = ''; l.appendChild(U.el('li', 'when', 'The latest graded calls could not be loaded right now.')); }
  });
})();
