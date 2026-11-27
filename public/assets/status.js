/* Oxva status page: redraws the batch log from /api/calls (the page already arrives with it filled in by
 * netlify/edge-functions/live.js; this keeps it fresh and covers the case where that step was skipped).
 * Everything is set with textContent. */
(function () {
  'use strict';
  var U = window.OxvaUI;
  var $ = function (id) { return document.getElementById(id); };
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function utc(t) { var d = new Date(t); return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'; }
  function cell(tr, text, cls) { var td = U.el('td', cls || '', text); tr.appendChild(td); return td; }

  function draw(d) {
    // an API answer from before batches existed: keep what the page came with
    if (!Array.isArray(d.batches)) return;
    var now = Date.now();
    var batches = d.batches || [];
    var last = batches.filter(function (b) { return !b.missed; })[0];
    var sum = $('st-sum'); sum.textContent = '';
    if (!last) sum.textContent = 'No batch has run yet.';
    else {
      var age = Math.round((now - last.at) / 60000), late = age > 4 * 60 + 40;
      sum.appendChild(U.el('b', late ? 's-invalidated' : 's-working', late ? 'Late' : 'Running'));
      sum.appendChild(document.createTextNode(' · last batch ' + utc(last.at) + ' (' + U.ago(last.at, now) + ')' + (d.nextCallAt ? ' · next at ' + utc(d.nextCallAt) : '')));
    }
    var body = $('st-rows'); body.textContent = '';
    if (!batches.length) { var tr0 = U.el('tr'); var td0 = cell(tr0, 'No batches yet.', 'muted'); td0.colSpan = 6; body.appendChild(tr0); }
    batches.slice(0, 42).forEach(function (b) {
      var tr = U.el('tr', b.missed ? 'missed' : '');
      if (b.missed) { cell(tr, utc(b.slot)); var td = cell(tr, 'Missed: no calls in this slot', 's-invalidated'); td.colSpan = 5; }
      else {
        cell(tr, utc(b.at)); cell(tr, String(b.calls), 'r'); cell(tr, String(b.BUY || 0), 'r s-working');
        cell(tr, String(b.SELL || 0), 'r s-invalidated'); cell(tr, String(b.WAIT || 0), 'r s-against'); cell(tr, String(b.AVOID || 0), 'r');
      }
      body.appendChild(tr);
    });
    var errs = d.lastRunErrors || [];
    $('st-errors').textContent = errs.length ? 'Last run notes: ' + errs.slice(0, 8).join(' · ') : 'The last run reached every data source.';
  }

  function load() { U.getCalls().then(draw).catch(function () { $('st-sum').textContent = 'The calls API could not be reached right now. Try again in a minute.'; }); }
  load();
  setInterval(function () { if (document.visibilityState === 'visible') load(); }, 120000);
})();
