/* Oxva markets: live DexScreener numbers for the watched tokens, joined with the latest calls. */
(function () {
  'use strict';
  var U = window.OxvaUI;
  var $ = function (id) { return document.getElementById(id); };
  var el = U.el;

  function pairsFor(t) {
    return fetch('https://api.dexscreener.com/latest/dex/tokens/' + t.address, { headers: { accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var a = t.address.toLowerCase();
        return (d.pairs || []).filter(function (p) { return p.chainId === t.chain && p.baseToken && p.baseToken.address.toLowerCase() === a; })
          .sort(function (x, y) { return ((y.liquidity && y.liquidity.usd) || 0) - ((x.liquidity && x.liquidity.usd) || 0); });
      });
  }

  // One cell per column. The class names the column, so on phones a row can lay out as a card (markets.html);
  // data-l is the label shown above a number there, where the table header is hidden.
  var COLS = ['price', 'chg', 'liq', 'vol', 'share', 'call', 'go'];
  var LABELS = { liq: 'Liquidity', vol: '24h volume', share: 'Buys, 24h' };
  var RIGHT = { price: 1, chg: 1, liq: 1, vol: 1 };
  function cell(col, extra, text) {
    var td = el('td', 'col-' + col + (RIGHT[col] ? ' r' : '') + (extra ? ' ' + extra : ''), text);
    if (LABELS[col]) td.setAttribute('data-l', LABELS[col]);
    return td;
  }

  function placeholder(universe) {
    var tb = $('rows'); tb.textContent = '';
    universe.forEach(function (t) {
      var tr = el('tr', 'row');
      var td = el('td', 'tok'); td.appendChild(el('span', 'sym', t.sym)); td.appendChild(el('span', 'mono muted', U.CHAIN_NAMES[t.chain])); tr.appendChild(td);
      COLS.forEach(function (col) { var c = cell(col); var s = el('div', 'skel'); s.style.height = '14px'; s.style.width = '60px'; c.appendChild(s); tr.appendChild(c); });
      tb.appendChild(tr);
    });
  }

  function row(t, pairs, call) {
    var main = pairs[0];
    var liq = pairs.reduce(function (s, p) { return s + ((p.liquidity && p.liquidity.usd) || 0); }, 0);
    var vol = pairs.reduce(function (s, p) { return s + ((p.volume && p.volume.h24) || 0); }, 0);
    var buys = 0, sells = 0;
    pairs.forEach(function (p) { var x = p.txns && p.txns.h24; if (x) { buys += x.buys || 0; sells += x.sells || 0; } });
    var chg = main && main.priceChange ? parseFloat(main.priceChange.h24) : null;

    var tr = el('tr', 'row');
    var td = el('td', 'tok'); td.appendChild(el('span', 'sym', (main && main.baseToken.symbol) || t.sym)); td.appendChild(el('span', 'mono muted', U.CHAIN_NAMES[t.chain])); tr.appendChild(td);
    tr.appendChild(cell('price', '', main ? U.price(parseFloat(main.priceUsd)) : '—'));
    tr.appendChild(cell('chg', 'mono chg ' + (chg == null ? '' : chg >= 0 ? 'pos' : 'neg'), chg == null ? '—' : U.pct(chg)));
    tr.appendChild(cell('liq', '', main ? U.usd(liq) : '—'));
    tr.appendChild(cell('vol', '', main ? U.usd(vol) : '—'));
    var sh = cell('share'); var w = el('div', 'share'); var trk = el('div', 'tr'); var b = el('b');
    var share = buys + sells ? buys / (buys + sells) : 0; b.style.width = Math.round(share * 100) + '%'; trk.appendChild(b); w.appendChild(trk);
    w.appendChild(el('span', 'mono muted', buys + sells ? Math.round(share * 100) + '%' : '—')); sh.appendChild(w); tr.appendChild(sh);
    var cc = cell('call'); var cw = el('div', 'callcell');
    if (call) { cw.appendChild(U.pill(call.action)); cw.appendChild(U.dots(call.conviction)); cw.appendChild(el('span', 'mono s-' + call.status, call.status)); }
    else cw.appendChild(el('span', 'mono muted', 'No call yet'));
    cc.appendChild(cw); tr.appendChild(cc);
    var go = cell('go'); var a = el('a', 'go', 'Read →'); a.href = '/read/?t=' + t.address + '&c=' + t.chain; go.appendChild(a); tr.appendChild(go);
    return tr;
  }

  var loading = false;
  function load() {
    if (loading) return; loading = true;
    $('m-time').textContent = 'Reading markets…';
    U.getCalls().catch(function () { return null; }).then(function (d) {
      var universe = d ? d.universe : [];
      if (!universe.length) { $('m-time').textContent = 'The token list could not be loaded. Try again in a minute.'; loading = false; return; }
      if (!$('rows').children.length) placeholder(universe);
      var latest = {}; (d.latest || []).forEach(function (c) { latest[c.address.toLowerCase()] = c; });
      return Promise.all(universe.map(function (t) { return pairsFor(t).then(function (p) { return row(t, p, latest[t.address.toLowerCase()]); }, function () { return row(t, [], latest[t.address.toLowerCase()]); }); }))
        .then(function (rows) {
          var tb = $('rows'); tb.textContent = ''; rows.forEach(function (r) { tb.appendChild(r); });
          $('m-time').textContent = 'Read at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · prices from DexScreener · calls ' + (d.updatedAt ? 'graded ' + U.ago(d.updatedAt) : '');
          loading = false;
        });
    });
  }
  $('refresh').addEventListener('click', load);
  load();
  setInterval(function () { if (document.visibilityState === 'visible') load(); }, 120000);
})();
