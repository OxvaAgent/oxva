/* Oxva Gate core: reads public token data and decides Allow / Needs approval / Block.
 * Runs in the browser (window.OxvaGateCore) and in Node (module.exports) so the rules can be tested.
 * Data sources, all free and keyless:
 *   DexScreener  https://api.dexscreener.com   pools, liquidity, price, activity
 *   GoPlus       https://api.gopluslabs.io     contract security flags, holders, LP holders
 *   Honeypot.is  https://api.honeypot.is       buy/sell simulation and taxes
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OxvaGateCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHAINS = {
    robinhood: { id: '4663', name: 'Robinhood Chain', honeypot: false, explorer: 'https://robinhoodchain.blockscout.com/token/' },
    ethereum: { id: '1', name: 'Ethereum', honeypot: true, explorer: 'https://etherscan.io/token/' },
    bsc: { id: '56', name: 'BNB Chain', honeypot: true, explorer: 'https://bscscan.com/token/' },
    base: { id: '8453', name: 'Base', honeypot: true, explorer: 'https://basescan.org/token/' },
    arbitrum: { id: '42161', name: 'Arbitrum', honeypot: false, explorer: 'https://arbiscan.io/token/' },
    polygon: { id: '137', name: 'Polygon', honeypot: false, explorer: 'https://polygonscan.com/token/' }
  };

  // Every threshold the gate uses, in one place so the page can show them.
  var LIMITS = {
    taxPass: 5, taxWarn: 10,               // percent
    liqPass: 250000, liqWarn: 25000,       // USD
    lpLockPass: 90, lpLockWarn: 50,        // percent of LP locked or burned
    top10Pass: 40, top10Warn: 70,          // percent held by top 10 wallets
    devWarn: 20,                           // percent held by creator or owner
    minTx24h: 10, newPoolDays: 7
  };

  var DEAD = {
    '0x0000000000000000000000000000000000000000': 1,
    '0x000000000000000000000000000000000000dead': 1,
    '0xdead000000000000000042069420694206942069': 1
  };

  var POWER_NAMES = {
    hidden_owner: 'a hidden owner',
    can_take_back_ownership: 'reclaim ownership after renouncing',
    selfdestruct: 'self-destruct the contract',
    owner_change_balance: 'change wallet balances',
    slippage_modifiable: 'change the trading tax',
    personal_slippage_modifiable: 'set a different tax per wallet',
    is_mintable: 'mint new tokens',
    transfer_pausable: 'pause trading',
    is_blacklisted: 'blacklist wallets',
    trading_cooldown: 'force a cooldown between trades',
    anti_whale_modifiable: 'change the max wallet or max trade',
    external_call: 'call other contracts during transfers'
  };
  var ALWAYS_BAD = ['hidden_owner', 'can_take_back_ownership', 'selfdestruct'];
  var SEVERE = ['owner_change_balance', 'slippage_modifiable', 'personal_slippage_modifiable'];
  var MODERATE = ['is_mintable', 'transfer_pausable', 'is_blacklisted', 'trading_cooldown', 'anti_whale_modifiable', 'external_call'];

  function isAddress(s) { return /^0x[0-9a-fA-F]{40}$/.test(String(s || '').trim()); }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : null; }
  function flag(x) { return x === '1' || x === 1 ? true : (x === '0' || x === 0 ? false : null); }
  function lc(s) { return String(s || '').toLowerCase(); }

  function usd(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    if (a >= 1) return '$' + n.toFixed(2);
    if (a === 0) return '$0';
    return '$' + n.toPrecision(3);
  }
  function pct(n, d) { return n == null ? '—' : n.toFixed(d == null ? 1 : d).replace(/\.0+$/, '') + '%'; }
  function list(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  /* ---------------- data gathering ---------------- */

  function getJSON(fetchFn, url) {
    return fetchFn(url, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function pairsByChain(pairs, address) {
    var a = lc(address), out = {};
    (pairs || []).forEach(function (p) {
      if (!CHAINS[p.chainId]) return;
      if (lc(p.baseToken && p.baseToken.address) !== a && lc(p.quoteToken && p.quoteToken.address) !== a) return;
      (out[p.chainId] = out[p.chainId] || []).push(p);
    });
    Object.keys(out).forEach(function (k) {
      out[k].sort(function (x, y) { return ((y.liquidity && y.liquidity.usd) || 0) - ((x.liquidity && x.liquidity.usd) || 0); });
    });
    return out;
  }

  function liquidityOf(pairs) {
    return (pairs || []).reduce(function (s, p) { return s + ((p.liquidity && p.liquidity.usd) || 0); }, 0);
  }

  /**
   * gather(address, chain) -> raw data for evaluate().
   * chain: a CHAINS key, or 'auto' to pick the chain with the most liquidity.
   */
  function gather(address, chain, fetchFn) {
    fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : this) : null);
    address = String(address || '').trim();
    if (!isAddress(address)) return Promise.reject(Object.assign(new Error('Not a token address'), { code: 'BAD_ADDRESS' }));
    var errors = {};

    return getJSON(fetchFn, 'https://api.dexscreener.com/latest/dex/tokens/' + address)
      .catch(function (e) { errors.dexscreener = e.message; return { pairs: [] }; })
      .then(function (ds) {
        var grouped = pairsByChain(ds.pairs, address);
        var picked = chain;
        if (!chain || chain === 'auto') {
          picked = Object.keys(grouped).sort(function (a, b) { return liquidityOf(grouped[b]) - liquidityOf(grouped[a]); })[0];
          if (!picked) {
            var err = new Error('No trading pool found on a supported chain');
            err.code = errors.dexscreener ? 'SOURCE_DOWN' : 'NO_MARKET';
            throw err;
          }
        }
        if (!CHAINS[picked]) throw Object.assign(new Error('Unsupported chain'), { code: 'BAD_CHAIN' });
        var c = CHAINS[picked];

        var gp = getJSON(fetchFn, 'https://api.gopluslabs.io/api/v1/token_security/' + c.id + '?contract_addresses=' + address)
          .then(function (d) {
            if (d.code !== 1) throw new Error(d.message || 'GoPlus error');
            var r = d.result && (d.result[lc(address)] || d.result[Object.keys(d.result)[0]]);
            return r && Object.keys(r).length ? r : null;
          })
          .catch(function (e) { errors.goplus = e.message; return null; });
        var hp = c.honeypot
          ? getJSON(fetchFn, 'https://api.honeypot.is/v2/IsHoneypot?address=' + address + '&chainID=' + c.id)
              .catch(function (e) { errors.honeypot = e.message; return null; })
          : Promise.resolve(null);

        return Promise.all([gp, hp]).then(function (res) {
          return {
            address: address, chain: picked, pairs: grouped[picked] || [],
            otherChains: Object.keys(grouped).filter(function (k) { return k !== picked; }),
            goplus: res[0], honeypot: res[1], errors: errors, fetchedAt: Date.now()
          };
        });
      });
  }

  /* ---------------- the nine checks ---------------- */

  function checkContract(gp) {
    var c = { id: 'contract', label: 'Contract code', critical: false };
    if (!gp) return Object.assign(c, { status: 'unknown', value: 'No data', detail: 'Security data for this contract is not available.' });
    if (flag(gp.trust_list)) return Object.assign(c, { status: 'pass', value: 'Trusted list', detail: 'This token is on GoPlus’s list of well-known tokens.' });
    var open = flag(gp.is_open_source), proxy = flag(gp.is_proxy);
    if (open === false) return Object.assign(c, { status: 'fail', value: 'Not verified', detail: 'The source code is not published, so nobody can read what the contract does.' });
    if (open && proxy) return Object.assign(c, { status: 'warn', value: 'Upgradeable', detail: 'The code is published, but it sits behind a proxy. Whoever controls it can swap in new code later.' });
    if (open) return Object.assign(c, { status: 'pass', value: 'Verified', detail: 'The source code is published and the contract cannot be upgraded.' });
    return Object.assign(c, { status: 'unknown', value: 'Unknown', detail: 'Could not tell whether the source code is published.' });
  }

  function checkSell(gp, hp) {
    var c = { id: 'sell', label: 'Test sell', critical: true };
    var hpSays = hp && hp.honeypotResult ? hp.honeypotResult.isHoneypot : null;
    if (hpSays === true) {
      var why = hp.honeypotResult.honeypotReason ? ' Reason given: ' + hp.honeypotResult.honeypotReason + '.' : '';
      return Object.assign(c, { status: 'fail', value: 'Honeypot', detail: 'A simulated sell failed. You could buy this token and never sell it.' + why });
    }
    if (gp && flag(gp.is_honeypot)) return Object.assign(c, { status: 'fail', value: 'Honeypot', detail: 'The contract has a honeypot pattern: buying works, selling does not.' });
    if (gp && flag(gp.cannot_sell_all)) return Object.assign(c, { status: 'fail', value: 'Partial sells only', detail: 'Holders cannot sell their whole balance.' });
    if (hp && hp.simulationSuccess && hpSays === false) return Object.assign(c, { status: 'pass', value: 'Sells work', detail: 'A simulated buy and sell both went through.' });
    if (gp && flag(gp.is_honeypot) === false) return Object.assign(c, { status: 'pass', value: 'No pattern', detail: 'No honeypot pattern in the contract. A live sell simulation was not available on this chain.' });
    if (gp && flag(gp.trust_list)) return Object.assign(c, { status: 'pass', value: 'Trusted', detail: 'Well-known token; no sell restrictions expected.' });
    return Object.assign(c, { status: 'unknown', value: 'Not tested', detail: 'Neither a sell simulation nor a contract scan was available.' });
  }

  function taxes(gp, hp) {
    var sim = hp && hp.simulationSuccess && hp.simulationResult ? hp.simulationResult : null;
    var g = function (k) { var v = gp ? num(gp[k]) : null; return v == null ? null : v * 100; };
    return {
      buy: sim && num(sim.buyTax) != null ? num(sim.buyTax) : g('buy_tax'),
      sell: sim && num(sim.sellTax) != null ? num(sim.sellTax) : g('sell_tax'),
      transfer: sim && num(sim.transferTax) != null ? num(sim.transferTax) : g('transfer_tax'),
      source: sim ? 'simulation' : 'contract scan'
    };
  }

  function checkTax(kind, t, gp) {
    var v = t[kind], name = kind === 'buy' ? 'Buy tax' : 'Sell tax';
    var c = { id: kind + 'Tax', label: name, critical: true };
    if (v == null) {
      if (gp && flag(gp.trust_list)) return Object.assign(c, { status: 'pass', value: '0%', detail: 'Well-known token without a trading tax.' });
      return Object.assign(c, { status: 'unknown', value: 'Unknown', detail: 'The ' + kind + ' tax could not be read.' });
    }
    var extra = kind === 'sell' && t.transfer ? ' Wallet-to-wallet transfers are taxed ' + pct(t.transfer) + '.' : '';
    var from = ' (from the ' + t.source + ')';
    if (v <= LIMITS.taxPass) return Object.assign(c, { status: 'pass', value: pct(v), detail: 'At or under ' + LIMITS.taxPass + '%' + from + '.' + extra });
    if (v <= LIMITS.taxWarn) return Object.assign(c, { status: 'warn', value: pct(v), detail: 'Higher than usual. Every ' + kind + ' loses ' + pct(v) + from + '.' + extra });
    return Object.assign(c, { status: 'fail', value: pct(v), detail: 'Over ' + LIMITS.taxWarn + '%. You would lose ' + pct(v) + ' on every ' + kind + from + '.' + extra });
  }

  function checkOwner(gp) {
    var c = { id: 'owner', label: 'Owner powers', critical: true };
    if (!gp) return Object.assign(c, { status: 'unknown', value: 'No data', detail: 'Could not read what the owner is allowed to do.' });
    if (flag(gp.trust_list)) return Object.assign(c, { status: 'pass', value: 'Trusted', detail: 'Well-known token. Admin controls, if any, belong to a known issuer.' });
    var on = function (k) { return flag(gp[k]) === true; };
    var owner = lc(gp.owner_address);
    var renounced = !owner || !!DEAD[owner];
    var bad = ALWAYS_BAD.filter(on);
    if (bad.length) return Object.assign(c, { status: 'fail', value: 'Hidden control', detail: 'The contract has ' + list(bad.map(function (k) { return POWER_NAMES[k]; })) + '. Even a “renounced” owner can come back.' });
    var severe = SEVERE.filter(on), moderate = MODERATE.filter(on);
    if (renounced) {
      var dormant = severe.length + moderate.length;
      return Object.assign(c, { status: 'pass', value: 'Renounced', detail: 'Nobody owns the contract.' + (dormant ? ' It has ' + dormant + ' admin switch' + (dormant > 1 ? 'es' : '') + ', but no one can use them.' : '') });
    }
    if (severe.length) return Object.assign(c, { status: 'fail', value: severe.length > 1 ? severe.length + ' risky switches' : 'Risky switch', detail: 'An active owner can ' + list(severe.concat(moderate).map(function (k) { return POWER_NAMES[k]; })) + '.' });
    if (moderate.length) return Object.assign(c, { status: 'warn', value: moderate.length + ' switch' + (moderate.length > 1 ? 'es' : ''), detail: 'An active owner can ' + list(moderate.map(function (k) { return POWER_NAMES[k]; })) + '.' });
    return Object.assign(c, { status: 'pass', value: 'No risky switches', detail: 'There is an owner, but no switch that can trap or drain holders.' });
  }

  function checkLiquidity(pairs) {
    var c = { id: 'liquidity', label: 'Liquidity depth', critical: false };
    if (!pairs.length) return Object.assign(c, { status: 'fail', value: 'No pool', detail: 'No trading pool found on this chain, so there is nowhere to sell.' });
    var liq = liquidityOf(pairs);
    var where = pairs.length + ' pool' + (pairs.length > 1 ? 's' : '') + ', deepest on ' + (pairs[0].dexId || 'a DEX');
    if (liq >= LIMITS.liqPass) return Object.assign(c, { status: 'pass', value: usd(liq), detail: 'Deep enough for normal trade sizes. ' + where + '.' });
    if (liq >= LIMITS.liqWarn) return Object.assign(c, { status: 'warn', value: usd(liq), detail: 'Thin. A large order will move the price a lot. ' + where + '.' });
    return Object.assign(c, { status: 'fail', value: usd(liq), detail: 'Under ' + usd(LIMITS.liqWarn) + '. Even small sells can crash the price. ' + where + '.' });
  }

  function checkLpLock(gp, liq) {
    var c = { id: 'lpLock', label: 'Liquidity locked', critical: false };
    var holders = gp && gp.lp_holders;
    if (gp && flag(gp.trust_list)) return Object.assign(c, { status: 'pass', value: 'Trusted', detail: 'Well-known token with many independent pools.' });
    if (!holders || !holders.length) return Object.assign(c, { status: 'unknown', value: 'No data', detail: 'LP holder data is not available. This is common for concentrated-liquidity (v3) pools.' });
    var locked = holders.reduce(function (s, h) {
      var safe = flag(h.is_locked) || DEAD[lc(h.address)];
      return s + (safe ? (num(h.percent) || 0) : 0);
    }, 0) * 100;
    if (locked >= LIMITS.lpLockPass) return Object.assign(c, { status: 'pass', value: pct(locked) + ' safe', detail: 'Most of the pool’s LP tokens are locked or burned, so the pool cannot be pulled.' });
    if (locked >= LIMITS.lpLockWarn) return Object.assign(c, { status: 'warn', value: pct(locked) + ' safe', detail: 'Only part of the LP is locked or burned. The rest could be withdrawn.' });
    if (liq < LIMITS.liqPass) return Object.assign(c, { status: 'fail', value: pct(locked) + ' safe', detail: 'Most of the LP is unlocked and the pool is small. Whoever holds it can pull the liquidity (a rug pull).' });
    return Object.assign(c, { status: 'warn', value: pct(locked) + ' safe', detail: 'Most of the LP is not locked. The pool is deep, but its holders could still withdraw it.' });
  }

  function checkHolders(gp) {
    var c = { id: 'holders', label: 'Holder spread', critical: false };
    if (!gp || !gp.holders || !gp.holders.length) return Object.assign(c, { status: 'unknown', value: 'No data', detail: 'Top holder data is not available.' });
    if (flag(gp.trust_list)) return Object.assign(c, { status: 'pass', value: 'Trusted', detail: 'Well-known token held across exchanges and custodians.' });
    var people = gp.holders.filter(function (h) { return !flag(h.is_contract) && !flag(h.is_locked) && !DEAD[lc(h.address)]; }).slice(0, 10);
    var top = people.reduce(function (s, h) { return s + (num(h.percent) || 0); }, 0) * 100;
    var dev = Math.max(num(gp.creator_percent) || 0, num(gp.owner_percent) || 0) * 100;
    var count = num(gp.holder_count);
    var tail = (count ? ' ' + Math.round(count).toLocaleString('en-US') + ' holders in total.' : '');
    if (dev > LIMITS.devWarn) return Object.assign(c, { status: top > LIMITS.top10Warn ? 'fail' : 'warn', value: 'Dev ' + pct(dev), detail: 'The creator or owner holds ' + pct(dev) + ' of the supply. Top 10 wallets hold ' + pct(top) + '.' + tail });
    if (top <= LIMITS.top10Pass) return Object.assign(c, { status: 'pass', value: 'Top 10: ' + pct(top), detail: 'Supply is spread out. Pools, locks and burn addresses are not counted.' + tail });
    if (top <= LIMITS.top10Warn) return Object.assign(c, { status: 'warn', value: 'Top 10: ' + pct(top), detail: 'A few wallets hold a lot. If they sell together, the price drops hard.' + tail });
    return Object.assign(c, { status: 'fail', value: 'Top 10: ' + pct(top), detail: 'Ten wallets control most of the supply.' + tail });
  }

  function checkActivity(pairs, now) {
    var c = { id: 'activity', label: 'Market activity', critical: false };
    if (!pairs.length) return Object.assign(c, { status: 'unknown', value: 'No pool', detail: 'No pool to read activity from.' });
    var buys = 0, sells = 0;
    pairs.forEach(function (p) { var t = p.txns && p.txns.h24; if (t) { buys += t.buys || 0; sells += t.sells || 0; } });
    var created = pairs.map(function (p) { return p.pairCreatedAt; }).filter(Boolean).sort()[0];
    var days = created ? (now - created) / 864e5 : null;
    var age = days == null ? 'unknown age' : days < 1 ? Math.max(1, Math.round(days * 24)) + 'h old' : Math.round(days).toLocaleString('en-US') + ' days old';
    var tx = buys + ' buys and ' + sells + ' sells in 24h';
    if (buys >= 20 && sells === 0) return Object.assign(c, { status: 'fail', value: 'No sellers', detail: tx + '. Nobody has sold, which is a honeypot warning sign.' });
    if (days != null && days < 1) return Object.assign(c, { status: 'warn', value: age, detail: 'Brand-new pool. Most rug pulls happen in the first day. ' + tx + '.' });
    if (days != null && days < LIMITS.newPoolDays) return Object.assign(c, { status: 'warn', value: age, detail: 'Young pool with little history. ' + tx + '.' });
    if (buys + sells < LIMITS.minTx24h) return Object.assign(c, { status: 'warn', value: (buys + sells) + ' trades', detail: 'Very little trading in the last day. Oldest pool is ' + age + '.' });
    return Object.assign(c, { status: 'pass', value: age, detail: 'Active market: ' + tx + '.' });
  }

  /* ---------------- verdict ---------------- */

  function evaluate(data, now) {
    now = now || Date.now();
    var gp = data.goplus, hp = data.honeypot, pairs = data.pairs || [];
    var main = pairs[0] || null;
    var liq = liquidityOf(pairs);
    var t = taxes(gp, hp);

    var checks = [
      checkContract(gp),
      checkSell(gp, hp),
      checkTax('buy', t, gp),
      checkTax('sell', t, gp),
      checkOwner(gp),
      checkLiquidity(pairs),
      checkLpLock(gp, liq),
      checkHolders(gp),
      checkActivity(pairs, now)
    ];

    var fails = checks.filter(function (c) { return c.status === 'fail'; });
    var warns = checks.filter(function (c) { return c.status === 'warn'; });
    var unknownCritical = checks.filter(function (c) { return c.status === 'unknown' && c.critical; });

    var verdict;
    if (fails.length) {
      verdict = { level: 'deny', title: 'Blocked',
        note: fails[0].detail + (fails.length > 1 ? ' ' + (fails.length - 1) + ' other check' + (fails.length > 2 ? 's' : '') + ' failed too.' : '') + ' Oxva would not sign an order for this token.' };
    } else if (unknownCritical.length || warns.length >= 2 || warns.some(function (c) { return c.critical; })) {
      var reasons = warns.map(function (c) { return c.label.toLowerCase(); }).concat(unknownCritical.map(function (c) { return c.label.toLowerCase() + ' (not readable)'; }));
      verdict = { level: 'hold', title: 'Needs approval',
        note: 'Nothing failed outright, but ' + list(reasons) + ' need a closer look. Oxva would hold an order until you confirm it yourself.' };
    } else {
      verdict = { level: 'allow', title: 'Allowed',
        note: 'Passed the gate' + (warns.length ? ' with one note: ' + warns[0].detail.charAt(0).toLowerCase() + warns[0].detail.slice(1) : '.') + ' These are checks, not a recommendation to buy.' };
    }

    var tokenInfo = main ? (lc(main.baseToken.address) === lc(data.address) ? main.baseToken : main.quoteToken) : null;
    var vol = pairs.reduce(function (s, p) { return s + ((p.volume && p.volume.h24) || 0); }, 0);
    var token = {
      address: data.address,
      chain: data.chain,
      chainName: CHAINS[data.chain].name,
      name: (tokenInfo && tokenInfo.name) || (gp && gp.token_name) || 'Unknown token',
      symbol: (tokenInfo && tokenInfo.symbol) || (gp && gp.token_symbol) || '?',
      priceUsd: main && lc(main.baseToken.address) === lc(data.address) ? num(main.priceUsd) : null,
      liquidityUsd: pairs.length ? liq : null,
      volume24h: pairs.length ? vol : null,
      fdv: main ? num(main.fdv) : null,
      change24h: main && main.priceChange && lc(main.baseToken.address) === lc(data.address) ? num(main.priceChange.h24) : null,
      pairUrl: main && /^https:\/\/dexscreener\.com\//.test(main.url || '') ? main.url : null,
      explorerUrl: CHAINS[data.chain].explorer + data.address,
      holders: gp ? num(gp.holder_count) : null,
      otherChains: (data.otherChains || []).map(function (k) { return CHAINS[k].name; })
    };

    var sources = [
      { name: 'DexScreener', ok: !data.errors || !data.errors.dexscreener },
      { name: 'GoPlus', ok: !!gp },
      { name: 'Honeypot.is', ok: !!hp, skipped: !CHAINS[data.chain].honeypot }
    ];

    return { token: token, checks: checks, verdict: verdict, sources: sources,
      counts: { pass: checks.length - fails.length - warns.length - checks.filter(function (c) { return c.status === 'unknown'; }).length,
        warn: warns.length, fail: fails.length } };
  }

  return { CHAINS: CHAINS, LIMITS: LIMITS, isAddress: isAddress, gather: gather, evaluate: evaluate, usd: usd, pct: pct };
});
