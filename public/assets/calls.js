/* Oxva calls page: the record, batches of calls with filters, the rules. */
(function () {
  'use strict';
  var U = window.OxvaUI;
  var $ = function (id) { return document.getElementById(id); };
  var data = null, fAction = 'all', fStatus = 'all';
  // /calls/?archive=YYYY-MM shows that month's archived calls as cards instead of the live list
  var ARCHIVE = (new URLSearchParams(location.search).get('archive') || '').trim();
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(ARCHIVE)) ARCHIVE = '';
  function monthLabel(m, len) { return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)).toLocaleString('en', { month: len || 'long', year: 'numeric', timeZone: 'UTC' }); }

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
    U.recordContext($('r-context'), d.context);
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
      var a = U.el('a', '', monthLabel(m, 'short')); a.href = '/calls/?archive=' + m + '#archive-view'; a.title = 'Every archived call of ' + monthLabel(m);
      if (m === ARCHIVE) a.setAttribute('aria-current', 'page');
      p.appendChild(a);
    });
  }

  // the archive view: a banner, then the month's calls in the same cards and batches as the live list
  function showArchive() {
    var box = $('archive-view'); box.hidden = false; box.textContent = '';
    box.appendChild(U.el('span', 'mono kicker', 'Archive'));
    box.appendChild(U.el('h2', '', monthLabel(ARCHIVE)));
    box.appendChild(U.el('p', '', 'Calls from this month that left the live list after two weeks, with the grade they closed on. They still count in the record above.'));
    var links = U.el('p', 'mono links');
    var back = U.el('a', '', '← Live calls'); back.href = '/calls/'; links.appendChild(back);
    var raw = U.el('a', '', 'The same data as JSON'); raw.href = '/api/calls?archive=' + ARCHIVE; links.appendChild(raw);
    box.appendChild(links);
    $('batches').textContent = ''; U.skeletonCards($('batches'), 3);
    return fetch('/api/calls?archive=' + ARCHIVE, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status); return d; }); })
      .then(function (a) {
        data = { calls: Array.isArray(a.calls) ? a.calls : [] };
        if (!data.calls.length) { var b = $('batches'); b.textContent = ''; b.appendChild(U.el('p', 'notice empty', 'No calls are archived for ' + monthLabel(ARCHIVE) + '.')); return; }
        renderBatches();
      });
  }

  // every BUY/SELL still being graded, however old: the newest 120 calls in the batch list can be all waits
  function renderRunning(d) {
    if (!Array.isArray(d.running)) return; // an older API answer: keep what the page came with
    var grid = $('running-grid'); grid.textContent = '';
    var now = Date.now();
    var list = d.running.slice().sort(function (a, b) { return b.at - a.at; });
    $('running-count').textContent = list.length ? list.length + ' running · graded for up to ' + ((d.rules && d.rules.gradeHours) || 72) + ' h' : '';
    if (!list.length) { grid.appendChild(U.el('p', 'notice empty', 'No buy or sell call is running right now.')); return; }
    // the newest few first; the rest behind one button, so a long list does not push the batches far down
    var SHOWN = 6;
    list.slice(0, SHOWN).forEach(function (c) { grid.appendChild(U.callCard(c, now)); });
    var more = $('running-more'); if (more) more.remove();
    if (list.length > SHOWN) {
      more = U.el('button', 'chip running-more', 'Show all ' + list.length + ' running calls');
      more.id = 'running-more'; more.type = 'button';
      more.addEventListener('click', function () {
        list.slice(SHOWN).forEach(function (c) { grid.appendChild(U.callCard(c, now)); });
        more.remove();
      });
      grid.parentNode.appendChild(more);
    }
  }

  function renderBatches() {
    var box = $('batches'); box.textContent = '';
    var now = Date.now();
    // readings per slot that matched a running call (no new call was made for them)
    var seenBy = {};
    (data.batches || []).forEach(function (b) { seenBy[b.slot] = b.seen || 0; });
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
      var again = seenBy[slot] ? ' · ' + seenBy[slot] + ' running call' + (seenBy[slot] === 1 ? '' : 's') + ' read again' : '';
      head.appendChild(U.el('span', '', calls.length + ' call' + (calls.length === 1 ? '' : 's') + again + ' · ' + U.ago(Number(slot), now)));
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

  function failed() {
    var box = $('batches'); box.textContent = '';
    box.appendChild(U.el('p', 'notice err', 'Calls could not be loaded right now. Try again in a minute.'));
  }
  if (ARCHIVE) {
    $('running').hidden = true; // the archive view is about one month; running calls are on the live page
    U.getCalls().then(renderRecord, function () { /* the record is optional here */ });
    showArchive().catch(failed);
  } else {
    U.getCalls().then(function (d) { data = d; renderRecord(d); renderRunning(d); renderBatches(); }).catch(failed);
  }
})();
