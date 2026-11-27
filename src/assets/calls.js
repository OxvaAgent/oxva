/* Oxva calls page: the record, batches of calls with filters, the rules. */
(function () {
  'use strict';
  var U = window.OxvaUI;
  var $ = function (id) { return document.getElementById(id); };
  var data = null, fAction = 'all', fStatus = 'all';

  U.skeletonCards($('loading-grid'), 6);

  function renderRecord(d) {
    var r = d.record;
    $('r-total').textContent = r.total; $('r-graded').textContent = r.graded;
    $('r-working').textContent = r.working; $('r-against').textContent = r.against; $('r-invalid').textContent = r.invalidated;
    var split = $('split'); split.textContent = '';
    if (r.graded) [['working', 'var(--up)'], ['against', 'var(--flat)'], ['invalidated', 'var(--down)']].forEach(function (x) {
      var i = U.el('i'); i.style.width = (r[x[0]] / r.graded * 100) + '%'; i.style.background = x[1]; split.appendChild(i);
    });
    $('r-rate').textContent = r.hitRate == null ? 'Hit rate: not enough graded calls yet' : 'Hit rate ' + r.hitRate + '%';
    $('r-next').textContent = 'Next batch in ' + U.until(d.nextCallAt);
    Array.prototype.forEach.call(document.querySelectorAll('[data-rule]'), function (s) { var k = s.getAttribute('data-rule'); if (d.rules && d.rules[k] != null) s.textContent = d.rules[k]; });
    renderArchive(d.archive || [], d.oldestLiveAt ? d.oldestLiveAt + ((d.rules && d.rules.keepDays) || 14) * 864e5 : null);
  }

  // calls older than two weeks: one link per month to the archived calls (JSON from /api/calls?archive=YYYY-MM)
  function renderArchive(months, firstAt) {
    var p = $('archive'); if (!p) return;
    p.textContent = '';
    var valid = months.filter(function (m) { return /^\d{4}-\d{2}$/.test(m); });
    if (!valid.length) {
      var first = firstAt ? ' (the first on ' + new Date(firstAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ')' : '';
      p.textContent = 'Calls stay here for two weeks, then move to a monthly archive' + first + '. None archived yet.';
      return;
    }
    p.appendChild(document.createTextNode('Older calls, by month:'));
    valid.slice().reverse().forEach(function (m) {
      var label = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)).toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      var a = U.el('a', '', label); a.href = '/api/calls?archive=' + m; a.title = 'Every archived call of ' + label + ' (JSON)';
      p.appendChild(a);
    });
  }

  function renderBatches() {
    var box = $('batches'); box.textContent = '';
    var now = Date.now();
    var list = data.calls.filter(function (c) { return (fAction === 'all' || c.action === fAction) && (fStatus === 'all' || c.status === fStatus); });
    if (!list.length) { box.appendChild(U.el('p', 'notice empty', data.calls.length ? 'No calls match these filters.' : 'The first batch of calls is being made. Check back in a minute.')); return; }
    var groups = {};
    list.forEach(function (c) { (groups[c.slot] = groups[c.slot] || []).push(c); });
    Object.keys(groups).sort(function (a, b) { return b - a; }).forEach(function (slot) {
      var calls = groups[slot];
      var sec = U.el('div', 'batch');
      var head = U.el('div', 'batch-head mono');
      var when = new Date(Number(slot));
      head.appendChild(U.el('b', '', when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) + ', ' + when.toISOString().slice(11, 16) + ' UTC'));
      head.appendChild(U.el('span', '', calls.length + ' call' + (calls.length === 1 ? '' : 's') + ' · ' + U.ago(Number(slot), now)));
      sec.appendChild(head);
      var grid = U.el('div', 'calls-grid');
      calls.sort(function (a, b) { return a.sym.localeCompare(b.sym); }).forEach(function (c) { grid.appendChild(U.callCard(c, now)); });
      sec.appendChild(grid);
      box.appendChild(sec);
    });
  }

  function wire(groupId, set) {
    Array.prototype.forEach.call($(groupId).querySelectorAll('.chip'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call($(groupId).querySelectorAll('.chip'), function (x) { x.setAttribute('aria-pressed', x === b); });
        set(b.getAttribute('data-v')); if (data) renderBatches();
      });
    });
  }
  wire('f-action', function (v) { fAction = v; });
  wire('f-status', function (v) { fStatus = v; });

  U.getCalls().then(function (d) { data = d; renderRecord(d); renderBatches(); }).catch(function () {
    var box = $('batches'); box.textContent = '';
    box.appendChild(U.el('p', 'notice err', 'Calls could not be loaded right now. Try again in a minute.'));
  });
})();
