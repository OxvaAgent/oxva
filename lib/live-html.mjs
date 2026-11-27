// Live numbers in the HTML itself (used by netlify/edge-functions/live.js).
// Pages mark places with <!--live:key-->fallback<!--/live:key-->. render() swaps each fallback for what the calls API
// says right now, so the page shows real calls and the last batch before any script runs (people with slow phones,
// search engines and link readers see the record, not dashes). The page scripts then keep them fresh as before.
// Pure: no network, no Deno or Node APIs. Every value from the API is escaped: token names and reasons come from
// outside data and are not trusted.

const STATUS = { working: 'Working', against: 'Against', invalidated: 'Invalidated', watching: 'Watching', open: 'Open' };
const CHAINS = { robinhood: 'Robinhood Chain', ethereum: 'Ethereum', bsc: 'BNB Chain', base: 'Base', arbitrum: 'Arbitrum', polygon: 'Polygon' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const num = (n) => (typeof n === 'number' && isFinite(n) ? n : null);
const pad = (n) => (n < 10 ? '0' : '') + n;

/** "27 Nov, 04:05 UTC" */
export function utc(t) {
  const d = new Date(t);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}
/** "5 Dec 2026" */
export function day(t) {
  const d = new Date(t);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
export function pct(n) {
  n = num(n);
  return n == null ? '' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(Math.abs(n) < 10 ? 1 : 0) + '%';
}
export function price(n) {
  n = num(n);
  if (n == null) return '—';
  if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 });
  const m = n.toFixed(20).match(/^0\.(0*)(\d{1,4})/);
  return m ? '$0.' + m[1] + m[2] : '$' + n.toPrecision(3);
}
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return MONTHS[mo - 1] + ' ' + y;
}

const GRADED = (c) => (c.action === 'BUY' || c.action === 'SELL') && (c.status === 'working' || c.status === 'against' || c.status === 'invalidated');
const pill = (a) => '<span class="pill a-' + esc(a) + '"><i></i>' + esc(a) + '</span>';
const status = (s) => '<span class="mono s-' + esc(s) + '">' + esc(STATUS[s] || s) + '</span>';

/** A plain call card in the same classes the page scripts use, replaced by the full card once they run. */
function card(c) {
  const moved = c.now && c.now.at > c.at && num(c.now.move) != null ? ' <span class="mono ' + (c.now.move >= 0 ? 's-working' : 's-invalidated') + '">' + pct(c.now.move) + '</span>' : '';
  return '<div class="call c-card">' +
    '<div class="c-top"><span class="c-sym">' + esc(c.sym) + '</span><span class="mono muted">' + esc(CHAINS[c.chain] || c.chain) + '</span></div>' +
    '<div class="c-row">' + pill(c.action) + '</div>' +
    '<div class="c-move"><b>' + price(c.price) + '</b>' + moved + '</div>' +
    '<div class="c-row"><span class="mono muted">' + utc(c.at) + '</span>' + status(c.status) + '</div>' +
    (c.reason ? '<p class="c-reason">' + esc(c.reason) + '</p>' : '') +
    '</div>';
}

/** The hit rate in context. Same wording as OxvaUI.recordContext() in src/assets/ui.js. All text escaped. */
function shortDay(t) { const d = new Date(t); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
function hours(h) { return h < 1 ? Math.round(h * 60) + ' min' : (h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)) + ' h'; }
export function recordContext(ctx) {
  if (!ctx || !Array.isArray(ctx.versions)) return '';
  const rows = ctx.versions.slice().reverse().map((v) => {
    const when = v.from && v.to ? shortDay(v.from) + ' – ' + shortDay(v.to) : v.from ? 'since ' + shortDay(v.from) : (v.to ? 'until ' + shortDay(v.to) : '');
    let nums = num(v.graded) ? v.graded + ' graded · ' + v.hitRate + '% working' : 'none graded yet';
    if (num(v.running)) nums += ' · ' + v.running + ' still running';
    return '<li><span class="ctx-v">' + esc('Rules v' + v.v + (when ? ' · ' + when : '')) + '</span><span class="ctx-l">' + esc(v.label) + '</span><span class="ctx-n">' + esc(nums) + '</span></li>';
  }).join('');
  const note = [];
  if (num(ctx.running)) note.push(ctx.running + ' buy and sell call' + (ctx.running > 1 ? 's are' : ' is') + ' still running and can still change grade.');
  if (num(ctx.stopMedianHours) != null) note.push(ctx.stopsMeasured + ' hit their stop, a median ' + hours(ctx.stopMedianHours) + ' after the call.');
  if (num(ctx.closedAvgHours) != null) note.push('Closed calls lasted ' + hours(ctx.closedAvgHours) + ' on average; a call is graded for up to ' + ctx.gradeHours + ' h.');
  if (num(ctx.since)) note.push('Record since ' + shortDay(ctx.since) + ' (' + ctx.days + ' day' + (ctx.days > 1 ? 's' : '') + '). Nothing is removed.');
  return '<p class="ctx-head mono">The hit rate in context</p><ul class="ctx-rows">' + rows + '</ul><p class="ctx-note">' + esc(note.join(' ')) + '</p>';
}

/** Everything a page can ask for, from one /api/calls answer. */
export function values(d, now) {
  const calls = Array.isArray(d.calls) ? d.calls : [];
  const r = d.record || {};
  const graded = calls.filter(GRADED).sort((a, b) => b.at - a.at);
  const proof = graded[0];
  const batches = Array.isArray(d.batches) ? d.batches : [];
  // the newest batch that ran; an older API answer without batches falls back to the newest call
  const lastRun = batches.find((b) => !b.missed) || (calls.length ? { at: Math.max(...calls.map((c) => c.at)) } : null);
  const universe = Array.isArray(d.universe) ? d.universe : [];
  const chains = new Set(universe.map((u) => u.chain)).size;
  const latest = (Array.isArray(d.latest) ? d.latest : []).slice().sort((a, b) => (b.conviction - a.conviction) || (b.at - a.at)).slice(0, 6);
  const rate = num(r.hitRate) == null ? '—' : r.hitRate + '%';
  const next = num(d.nextCallAt) ? utc(d.nextCallAt).replace(/^\d+ \w+, /, '') : '';
  const lastLine = lastRun ? 'Last batch ran ' + utc(lastRun.at) + (next ? ' · next at ' + next : '') : 'Making its first calls';
  const archive = Array.isArray(d.archive) ? d.archive.filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const keepDays = (d.rules && d.rules.keepDays) || 14;
  const firstArchive = num(d.oldestLiveAt) ? day(d.oldestLiveAt + keepDays * 864e5) : null;

  const v = {
    'hs-last': proof ? esc(proof.sym + ' ' + proof.action) : 'None yet',
    'hs-last-sub': proof
      ? status(proof.status) + esc((proof.now && proof.now.at > proof.at && num(proof.now.move) != null ? ' · ' + pct(proof.now.move) + ' since' : '') + ' · ' + utc(proof.at))
      : 'The first buy or sell call is being graded',
    'hs-total': esc(r.total == null ? '—' : r.total),
    'hs-tokens': esc(universe.length || '—'),
    'hs-tokens-sub': chains ? 'On ' + chains + ' chains, every four hours' : 'Every four hours',
    'status-last': esc(lastLine),
    'rec-total': esc(r.total == null ? '—' : r.total),
    'rec-graded': esc(r.graded == null ? '—' : r.graded),
    'rec-working': esc(r.working == null ? '—' : r.working),
    'rec-rate': esc(rate),
    'ctx': recordContext(d.context),
    'rec-note': r.graded ? esc(r.against + ' against · ' + r.invalidated + ' invalidated · ' + r.waits + ' waits') : 'No buy or sell call has been graded yet.',
    'rec-list': graded.slice(0, 5).map((c) => '<li><span class="what"><b>' + esc(c.sym + ' ' + c.action) + '</b>' +
      esc(' at ' + price(c.price) + (c.now && num(c.now.move) != null ? ' · ' + pct(c.now.move) + ' since' : '')) + '</span>' +
      '<span class="when">' + utc(c.at) + '</span><span class="st s-' + esc(c.status) + '">' + esc(STATUS[c.status]) + '</span></li>').join('') ||
      '<li class="when">No buy or sell call has been graded yet.</li>',
    'latest-grid': latest.map(card).join(''),
    'latest-time': num(d.updatedAt) ? 'Graded ' + utc(d.updatedAt) : '',
    'r-total': esc(r.total == null ? '—' : r.total),
    'r-graded': esc(r.graded == null ? '—' : r.graded),
    'r-working': esc(r.working == null ? '—' : r.working),
    'r-against': esc(r.against == null ? '—' : r.against),
    'r-invalid': esc(r.invalidated == null ? '—' : r.invalidated),
    'r-rate': num(r.hitRate) == null ? 'Hit rate: not enough graded calls yet' : 'Hit rate ' + esc(r.hitRate) + '%',
    'r-next': next ? 'Next batch at ' + esc(next) : '',
    'split': r.graded ? [['working', 'var(--up)'], ['against', 'var(--flat)'], ['invalidated', 'var(--down)']]
      .map(([k, c]) => '<i style="width:' + (100 * (num(r[k]) || 0) / r.graded).toFixed(2) + '%;background:' + c + '"></i>').join('') : '',
    'archive': archive.length
      ? 'Older calls, by month:' + archive.slice().reverse().map((m) => '<a href="/calls/?archive=' + m + '#archive-view">' + monthLabel(m) + '</a>').join('')
      : 'Calls stay here for two weeks, then move to a monthly archive' + (firstArchive ? ' (the first on ' + firstArchive + ')' : '') + '. None archived yet.',
    'batches': batchCards(calls, batches),
    'status-summary': statusSummary(d, lastRun, now),
    'status-rows': statusRows(batches),
    'status-errors': (Array.isArray(d.lastRunErrors) && d.lastRunErrors.length)
      ? 'Last run notes: ' + d.lastRunErrors.slice(0, 8).map(esc).join(' · ')
      : 'The last run reached every data source.'
  };
  return v;
}

/** The newest two batches as plain cards, so /calls/ shows calls before its script draws the full list. */
function batchCards(calls, batches) {
  const shown = batches.filter((b) => !b.missed).slice(0, 2);
  return shown.map((b) => {
    const list = calls.filter((c) => c.slot === b.slot);
    return '<div class="batch"><p class="mono muted">Batch of ' + utc(b.at) + ' · ' + list.length + ' calls</p><div class="calls-grid">' + list.map(card).join('') + '</div></div>';
  }).join('');
}

function statusSummary(d, lastRun, now) {
  if (!lastRun) return 'No batch has run yet.';
  const age = Math.round(((now || Date.now()) - lastRun.at) / 60000);
  const late = age > 4 * 60 + 40;
  const ago = age < 90 ? age + ' min ago' : Math.round(age / 60) + 'h ago';
  return '<b class="' + (late ? 's-invalidated' : 's-working') + '">' + (late ? 'Late' : 'Running') + '</b> · last batch ' + esc(utc(lastRun.at)) + ' (' + esc(ago) + ')' +
    (num(d.nextCallAt) ? ' · next at ' + esc(utc(d.nextCallAt)) : '');
}

function statusRows(batches) {
  if (!batches.length) return '<tr><td colspan="6" class="muted">No batches yet.</td></tr>';
  return batches.slice(0, 42).map((b) => b.missed
    ? '<tr class="missed"><td>' + utc(b.slot) + '</td><td colspan="5" class="s-invalidated">Missed: no calls in this slot</td></tr>'
    : '<tr><td>' + utc(b.at) + '</td><td class="r">' + b.calls + '</td><td class="r s-working">' + (b.BUY || 0) + '</td><td class="r s-invalidated">' + (b.SELL || 0) +
      '</td><td class="r s-against">' + (b.WAIT || 0) + '</td><td class="r">' + (b.AVOID || 0) + '</td></tr>').join('');
}

/** Swap every <!--live:key-->…<!--/live:key--> whose key has a value; leave the rest as they are. */
export function render(html, d, now) {
  const v = values(d || {}, now);
  return html.replace(/<!--live:([a-z0-9-]+)-->[\s\S]*?<!--\/live:\1-->/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(v, key) ? '<!--live:' + key + '-->' + v[key] + '<!--/live:' + key + '-->' : whole);
}
