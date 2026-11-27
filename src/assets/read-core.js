/* Oxva Read core: turns public pool data into one market read, and merges it with the contract checks.
 * Pure rules, no model: the same data always gives the same read.
 * Runs in the browser (window.OxvaReadCore) and in Node (module.exports) for tests.
 *
 * Input: DexScreener pairs for one token on one chain (sorted by liquidity, deepest first),
 * as returned by OxvaGateCore.gather().
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OxvaReadCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Time windows, their weight in the read, and the price move that counts as "strong" in each.
  var WINDOWS = [
    { key: 'm5', label: '5m', weight: 0.10, strong: 2 },
    { key: 'h1', label: '1h', weight: 0.25, strong: 5 },
    { key: 'h6', label: '6h', weight: 0.30, strong: 10 },
    { key: 'h24', label: '24h', weight: 0.35, strong: 20 }
  ];

  var RULES = {
    leanAt: 0.18,          // |score| needed to lean up or down
    trendShare: 0.6,       // score = 60% price trend + 40% order flow
    minWindowTrades: 4,    // a window needs this many trades to count for order flow
    minDayTrades: 12,      // fewer trades in 24h means no read at all
    thinLiquidity: 100000, // USD; below this, conviction drops by one
    quietRatio: 0.03,      // 24h volume / liquidity below this is a quiet market
    frenzyRatio: 4,        // above this, moves can reverse fast
    convictionSteps: [0.18, 0.3, 0.45, 0.6], // |score| at which conviction reaches 2, 3, 4, 5
    // Robinhood stock tokens move like stocks (1–3% a day), not like crypto: for them a quarter of the
    // "strong" move counts (5% in 24h instead of 20%), so a normal stock day can still lean one way.
    stockScale: 0.25
  };

  /** True for Robinhood’s tokenized stocks (official name ends in "• Robinhood Token"). */
  function isStock(pair) { return !!(pair && pair.baseToken && /•\s*Robinhood Token\s*$/i.test(pair.baseToken.name || "")); }

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : null; }
  function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function usd(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  }
  function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(Math.abs(n) < 10 ? 1 : 0) + '%'; }
  function joinList(items) { return items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }

  /**
   * market(pairs) -> the market read for one token.
   * lean: 'up' | 'down' | 'flat';  conviction: 1..5
   */
  function market(pairs) {
    pairs = pairs || [];
    if (!pairs.length) return { available: false, reason: 'No trading pool, so there is no market to read.' };
    var main = pairs[0];
    var scale = isStock(main) ? RULES.stockScale : 1;
    var change = main.priceChange || {};

    var windows = WINDOWS.map(function (w) {
      var buys = 0, sells = 0, vol = 0;
      pairs.forEach(function (p) {
        var t = p.txns && p.txns[w.key]; if (t) { buys += t.buys || 0; sells += t.sells || 0; }
        vol += (p.volume && num(p.volume[w.key])) || 0;
      });
      var c = num(change[w.key]);
      return {
        key: w.key, label: w.label, weight: w.weight, strong: w.strong,
        change: c, buys: buys, sells: sells, volume: vol,
        flow: buys + sells >= RULES.minWindowTrades ? (buys - sells) / (buys + sells) : null
      };
    });

    // price trend: each window's move squashed to -1..1, weighted
    var tw = 0, ts = 0, fw = 0, fs = 0;
    windows.forEach(function (w) {
      if (w.change != null) { ts += w.weight * Math.tanh(w.change / (w.strong * scale)); tw += w.weight; }
      if (w.flow != null) { fs += w.weight * w.flow; fw += w.weight; }
    });
    var trend = tw ? ts / tw : 0;
    var flow = fw ? fs / fw : 0;
    var score = RULES.trendShare * trend + (1 - RULES.trendShare) * flow;

    var liq = pairs.reduce(function (s, p) { return s + ((p.liquidity && p.liquidity.usd) || 0); }, 0);
    var day = windows[3];
    var dayTrades = day.buys + day.sells;
    var ratio = liq > 0 ? day.volume / liq : 0;
    var disagree = Math.abs(trend) > 0.1 && Math.abs(flow) > 0.1 && sign(trend) !== sign(flow);

    var lean = score >= RULES.leanAt ? 'up' : score <= -RULES.leanAt ? 'down' : 'flat';
    var conviction = 1;
    RULES.convictionSteps.forEach(function (s) { if (Math.abs(score) >= s) conviction++; });
    var notes = [];
    if (disagree) { conviction = Math.min(conviction, 2); notes.push('disagree'); }
    if (liq < RULES.thinLiquidity) { conviction--; notes.push('thin'); }
    if (ratio < RULES.quietRatio) { conviction--; notes.push('quiet'); }
    if (ratio > RULES.frenzyRatio) notes.push('frenzy');
    if (dayTrades < RULES.minDayTrades) { lean = 'flat'; conviction = 1; notes.push('dead'); }
    if (lean === 'flat') conviction = Math.min(conviction, 2);
    conviction = clamp(conviction, 1, 5);

    return {
      available: true,
      lean: lean, conviction: conviction, score: score, trend: trend, flow: flow,
      windows: windows, liquidity: liq, volume24h: day.volume, trades24h: dayTrades, ratio: ratio,
      notes: notes,
      reason: reasonFor(windows, notes),
      catch: catchFor(lean, notes, liq, ratio)
    };
  }

  function reasonFor(windows, notes) {
    if (notes.indexOf('dead') >= 0) return 'Almost nobody traded it in the last 24 hours, so there is nothing to read.';
    var d = windows[3].change, h = windows[1].change;
    var parts = [];
    if (d == null) parts.push('No 24-hour price history yet');
    else if (Math.abs(d) < 0.5) parts.push('Flat over 24 hours');
    else parts.push((d > 0 ? 'Up ' : 'Down ') + Math.abs(d).toFixed(1) + '% in 24 hours');
    if (h != null && d != null && Math.abs(h) >= 0.5 && sign(h) !== sign(d) && Math.abs(d) >= 0.5) parts.push(h > 0 ? 'but bouncing in the last hour' : 'and slipping in the last hour');
    var counted = windows.filter(function (w) { return w.flow != null; });
    var up = counted.filter(function (w) { return w.flow > 0.05; }).length;
    var dn = counted.filter(function (w) { return w.flow < -0.05; }).length;
    var flowText = !counted.length ? 'too few trades to see who is in control'
      : up > dn ? 'buyers lead in ' + up + ' of ' + counted.length + ' windows'
      : dn > up ? 'sellers lead in ' + dn + ' of ' + counted.length + ' windows'
      : 'buyers and sellers are even';
    return parts.join(', ') + '; ' + flowText + '.';
  }

  function catchFor(lean, notes, liq, ratio) {
    if (notes.indexOf('dead') >= 0) return 'No trades means no exit. You may not be able to sell at the price shown.';
    if (notes.indexOf('thin') >= 0) return 'Thin pool: ' + usd(liq) + ' of liquidity, so even a modest order moves the price.';
    if (notes.indexOf('frenzy') >= 0) return 'Frenzy: a day’s volume is ' + ratio.toFixed(1) + '× the pool. Moves this fast reverse fast.';
    if (notes.indexOf('quiet') >= 0) return 'Quiet market: a day’s volume is only ' + (ratio * 100).toFixed(1) + '% of the pool, so signals are weak.';
    if (notes.indexOf('disagree') >= 0) return 'Price and order flow point different ways, so this read is weak.';
    if (lean === 'up') return 'Momentum fades. If sellers take the 1-hour window, this read flips.';
    if (lean === 'down') return 'Falling markets bounce hard. If buyers take the 1-hour window, this read flips.';
    return 'No edge either way. Waiting is a position too.';
  }

  var TITLES = { up: 'Leaning up', down: 'Leaning down', flat: 'No clear edge' };

  /**
   * combine(marketRead, safety) -> the one answer shown to people.
   * safety is OxvaGateCore.evaluate() output, or null when only the market was read.
   * tone: 'up' | 'down' | 'flat' | 'stop'
   */
  function combine(m, safety) {
    if (safety && safety.verdict.level === 'deny') {
      var fail = safety.checks.filter(function (c) { return c.status === 'fail'; })[0];
      return { tone: 'stop', title: 'Stay out', conviction: null,
        reason: 'The contract fails the gate. ' + (fail ? fail.detail : ''),
        catch: m && m.available ? 'The market read (' + TITLES[m.lean].toLowerCase() + ') does not matter while the contract fails.' : 'Market data does not matter while the contract fails.' };
    }
    if (!m || !m.available) return { tone: 'flat', title: 'No read', conviction: null, reason: (m && m.reason) || 'No market data.', catch: 'Without a pool there is no price and no exit.' };
    var out = { tone: m.lean, title: TITLES[m.lean], conviction: m.conviction, reason: m.reason, catch: m.catch };
    if (safety && safety.verdict.level === 'hold') {
      var looks = safety.checks.filter(function (c) { return c.status === 'warn' || (c.status === 'unknown' && c.critical); })
        .map(function (c) { return c.label.toLowerCase() + (c.status === 'unknown' ? ' (not readable)' : ''); });
      out.title += ', check first';
      out.catch = 'Check the contract before acting: ' + joinList(looks) + (looks.length > 1 ? ' need' : ' needs') + ' a closer look.';
    }
    return out;
  }

  return { WINDOWS: WINDOWS, RULES: RULES, isStock: isStock, TITLES: TITLES, market: market, combine: combine, usd: usd, pct: pct };
});
