/* Oxva vault page: connect a browser wallet, create or open an OxvaVault on Robinhood Chain (testnet, or mainnet
 * beta with real ETH), and act as its agent or owner. Every write is signed in the visitor's own wallet; reads use
 * the public RPC. Text from the chain (addresses, numbers) is set with textContent only. */
(function () {
  'use strict';
  var E = window.ethers, A = window.OxvaVaultArtifact, U = window.OxvaUI, el = U.el;
  var $ = function (id) { return document.getElementById(id); };
  // floor: a block from before 19 Nov 2026, when the first Oxva vault was made; history is never looked for below it
  var NETS = {
    testnet: { key: 'testnet', main: false, id: 46630, hex: '0xb626', name: 'Robinhood Chain Testnet', label: 'Robinhood Chain testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com', floor: 155100000 },
    mainnet: { key: 'mainnet', main: true, id: 4663, hex: '0x1237', name: 'Robinhood Chain', label: 'Robinhood Chain mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com', floor: 117700000 }
  };
  var params = new URLSearchParams(location.search);
  var NET = params.get('net') === 'mainnet' ? NETS.mainnet : NETS.testnet;
  // Share the open vault: the address bar holds ?net=…&v=<vault> once one is open
  (function () {
    var slot = document.getElementById('v-share');
    if (slot && U.shareButton) slot.replaceWith(U.shareButton(function () {
      return { url: location.pathname + location.search, title: 'Oxva Vault on ' + NET.label, text: 'An Oxva vault on ' + NET.label + ': an agent can only spend inside the rules its owner set.' };
    }));
  })();
  /* Robinhood's public RPC sometimes answers browsers with a doubled CORS header ("*,*") for a few seconds at a time,
   * which the browser rejects as a network error. Reads are safe to repeat: the page tries the RPC directly once more,
   * then reads through Oxva's own read-only relay (/api/rpc/<net>, same origin, so no CORS) and keeps using it for a
   * minute. Writes never go through this reader: they are signed and sent by the visitor's wallet. */
  var baseGet = E.FetchRequest.createGetUrlFunc();
  var RELAY = '/api/rpc/' + NET.key, relayUntil = 0;
  function viaRelay(req, signal) { var r = req.clone(); r.url = new URL(RELAY, location.origin).href; return baseGet(r, signal); }
  function retryingGet(req, signal) {
    if (Date.now() < relayUntil) return viaRelay(req, signal);
    return baseGet(req, signal).catch(function () {
      return new Promise(function (r) { setTimeout(r, 300); }).then(function () { return baseGet(req, signal); });
    }).catch(function () {
      relayUntil = Date.now() + 60000;
      return viaRelay(req, signal);
    });
  }
  var rpcReq = new E.FetchRequest(NET.rpc); rpcReq.getUrlFunc = retryingGet;
  var reader = new E.JsonRpcProvider(rpcReq, E.Network.from(NET.id), { staticNetwork: true });
  var iface = new E.Interface(A.abi);
  var STORE = 'oxva.vaults';
  var S = { provider: null, account: null, chainOk: false, addr: null, info: null, verified: false };
  var STATUS = ['none', 'pending', 'executed', 'rejected'];
  var EXPLAIN = {
    NotOwner: 'Only the vault owner can do that. Connect the owner’s wallet.',
    NotAgent: 'Only the vault’s agent can propose. Connect the agent’s wallet.',
    IsPaused: 'The vault is paused. Nothing can be sent until the owner resumes it.',
    TargetNotAllowed: 'That address is not on the vault’s allowlist, so the call is refused.',
    OverCap: 'That is over the cap per call, so it is refused even with approval.',
    TokenCallBlocked: 'The agent may never call token functions (transfer, approve, permit, NFT transfers): token amounts are not covered by the ETH budget. Only the owner can take tokens out.',
    NotPending: 'That proposal is no longer waiting.',
    CallFailed: 'The call reached the target but the target rejected it, or the vault does not hold enough ETH.',
    Reentrant: 'A re-entrant call was blocked.',
    TransferFailed: 'The transfer failed: check the amount and, for a token, the token address.'
  };

  /* ---------- helpers ---------- */
  function eth(wei) { return Number(E.formatEther(wei)).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ETH'; }
  function short(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; }
  function same(a, b) { return !!a && !!b && a.toLowerCase() === b.toLowerCase(); }
  function decimal(id, what) { var v = String($(id).value || '0').trim(); if (!/^\d*\.?\d*$/.test(v) || v === '.') throw new Error('Enter ' + (what || 'an amount') + ' like 0.005.'); return v || '0'; }
  function amount(id) { return E.parseEther(decimal(id)); }
  function addr(v, what) { v = String(v || '').trim(); if (!E.isAddress(v)) throw new Error((what || 'That') + ' is not a valid address.'); return E.getAddress(v); }
  function link(path, text) { var a = el('a', '', text); a.href = NET.explorer + path; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function say(id, text, kind, hash) {
    var m = $(id); m.className = 'msg' + (kind ? ' ' + kind : ''); m.textContent = text;
    if (hash) { m.appendChild(document.createTextNode(' ')); m.appendChild(link('/tx/' + hash, 'View transaction ↗')); }
  }
  function reason(e) {
    if (e && e.revert && e.revert.name) return EXPLAIN[e.revert.name] || e.revert.name;
    var data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof data === 'string' && data.length >= 10) { try { var p = iface.parseError(data); if (p) return EXPLAIN[p.name] || p.name; } catch (x) { /* not ours */ } }
    if (e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) return 'Cancelled in your wallet.';
    if (e && e.code === 'INSUFFICIENT_FUNDS') return NET.main ? 'Not enough ETH in your wallet for this and its gas.' : 'Not enough test ETH in your wallet for this and its gas. Get some from the faucet.';
    return (e && (e.shortMessage || e.message)) || String(e);
  }

  /** The code at an address is exactly this page's OxvaVault build, once the owner (an immutable) is masked. */
  function codeMatches(code, owner) {
    var want = String(A.deployedBytecode || '').toLowerCase();
    if (want.length < 4 || !owner) return false;
    return String(code).toLowerCase().split('000000000000000000000000' + owner.toLowerCase().slice(2)).join('0'.repeat(64)) === want;
  }

  /** On mainnet, putting money in needs the risk box ticked first. */
  function needAck() {
    if (!NET.main || $('ack').checked) return;
    $('risk').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('ack').focus();
    throw new Error('Tick “I understand the risks” in the red box at the top first.');
  }

  /* ---------- remembered vaults (this browser only) ---------- */
  function mine() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; } }
  function netOf(x) { return x.n === 'mainnet' ? 'mainnet' : 'testnet'; }
  function remember(a, block) {
    var list = mine().filter(function (x) { return !(same(x.a, a) && netOf(x) === NET.key); });
    list.unshift({ a: a, b: block || null, n: NET.key });
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 12))); } catch (e) { /* storage blocked */ }
    renderMine();
  }
  function renderMine() {
    var box = $('mine'); box.textContent = '';
    mine().filter(function (x) { return netOf(x) === NET.key; }).forEach(function (x) {
      var b = el('button', '', short(x.a)); b.type = 'button'; b.title = x.a; b.addEventListener('click', function () { openVault(x.a); }); box.appendChild(b);
    });
  }

  /* ---------- page for the chosen network ---------- */
  function setupPage() {
    document.querySelectorAll('[data-net]').forEach(function (n) { n.hidden = n.getAttribute('data-net') !== NET.key; });
    $('net-test').classList.toggle('on', !NET.main); $('net-main').classList.toggle('on', NET.main);
    (NET.main ? $('net-main') : $('net-test')).setAttribute('aria-current', 'page');
    $('switch').textContent = 'Switch to ' + NET.label;
    $('net-text').textContent = 'Checking ' + NET.label + '…';
    if (NET.main) { $('c-fund').value = ''; $('c-fund').placeholder = '0 (you can deposit later)'; }
  }

  /* ---------- network + wallet ---------- */
  function netStatus() {
    reader.getBlockNumber().then(function (n) {
      $('net-dot').className = 'netdot ok'; $('net-text').textContent = NET.label + ' · block #' + n.toLocaleString('en-US');
    }, function () { $('net-dot').className = 'netdot bad'; $('net-text').textContent = NET.label + ' is not answering right now'; });
  }

  /* the wallet the visitor picked (any EIP-6963 wallet, or window.ethereum) */
  var W = window.OxvaWallet;
  function wallet() { var c = W.current(); return c ? c.provider : null; }
  function walletName() { var c = W.current(); return c ? c.info.name : ''; }

  async function refreshWallet() {
    var eip = wallet();
    if (!eip) {
      S.provider = null; S.account = null; S.chainOk = false;
      $('who').textContent = 'No wallet connected';
      $('connect').hidden = false; $('disconnect').hidden = true; $('switch').hidden = true;
      $('st-1').className = ''; $('st-2').className = ''; $('st-3').className = '';
      if (S.addr) renderRoles();
      return;
    }
    S.provider = new E.BrowserProvider(eip, 'any');
    var accts = await S.provider.send('eth_accounts', []);
    S.account = accts[0] ? E.getAddress(accts[0]) : null;
    var net = await S.provider.getNetwork();
    S.chainOk = Number(net.chainId) === NET.id;
    var bal = S.account && S.chainOk ? await reader.getBalance(S.account) : null;
    $('who').textContent = S.account ? walletName() + ' · ' + short(S.account) + (bal != null ? ' · ' + eth(bal) : ' · wrong network') : 'No wallet connected';
    $('connect').hidden = !!S.account; $('disconnect').hidden = !S.account;
    $('switch').hidden = !S.account || S.chainOk;
    $('st-1').className = S.account ? 'done' : ''; $('st-2').className = S.chainOk ? 'done' : ''; $('st-3').className = bal && bal > 0n ? 'done' : '';
    if (S.addr) renderRoles();
  }

  async function connect() {
    try { await W.connect(); } catch (e) { return false; } // closed the picker
    await refreshWallet();
    return !!S.account;
  }

  async function switchChain() {
    var eip = wallet(); if (!eip) throw new Error('Connect a wallet first.');
    try { await eip.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: NET.hex }] }); }
    catch (e) {
      var code = e && (e.code || (e.data && e.data.originalError && e.data.originalError.code));
      if (code !== 4902 && !(e && /unrecognized|not added|unknown chain/i.test(e.message || ''))) throw e;
      await eip.request({ method: 'wallet_addEthereumChain', params: [{ chainId: NET.hex, chainName: NET.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [NET.rpc], blockExplorerUrls: [NET.explorer] }] });
    }
    await refreshWallet();
  }

  /** Connected, on the right chain, and a signer. */
  async function ready() {
    if (!S.account && !(await connect())) throw new Error('Connect a browser wallet first.');
    if (!S.chainOk) await switchChain();
    if (!S.chainOk) throw new Error('Switch your wallet to ' + NET.label + ' first.');
    return S.provider.getSigner();
  }

  /* ---------- create ---------- */
  async function create(ev) {
    ev.preventDefault();
    try {
      needAck();
      var signer = await ready();
      var me = S.account;
      var agent = $('c-agent').value.trim() ? addr($('c-agent').value, 'The agent') : me;
      var lines = $('c-targets').value.split(/[\s,]+/).filter(Boolean);
      var targets = lines.length ? lines.map(function (t) { return addr(t, t); }) : [me];
      var budget = amount('c-budget'), cap = amount('c-cap'), appr = amount('c-approval'), fund = amount('c-fund');
      $('c-go').disabled = true;
      say('c-msg', 'Confirm the deployment in your wallet…');
      var factory = new E.ContractFactory(A.abi, A.bytecode, signer);
      var c = await factory.deploy(agent, budget, cap, appr, targets, { value: fund });
      var tx = c.deploymentTransaction();
      say('c-msg', 'Creating your vault… waiting for the block.', '', tx.hash);
      var rc = await tx.wait();
      var a = await c.getAddress();
      remember(a, rc.blockNumber);
      say('c-msg', 'Vault created at ' + a + '.', 'ok', tx.hash);
      await openVault(a);
    } catch (e) { say('c-msg', reason(e), 'err'); }
    $('c-go').disabled = false;
  }

  /* ---------- open + render ---------- */
  function vaultAt(a, runner) { return new E.Contract(a, A.abi, runner || reader); }

  async function openVault(a) {
    try { a = addr(a, 'The vault address'); } catch (e) { say('o-msg', e.message, 'err'); return; }
    say('o-msg', 'Reading the vault…');
    var other = NET.main ? 'If it is a testnet vault, choose Testnet above.' : 'If it is a mainnet vault, choose Mainnet beta above.';
    try {
      var code = await reader.getCode(a);
      if (code === '0x') throw new Error('There is no contract at this address on ' + NET.label + '. ' + other);
      var v = vaultAt(a);
      var r = await Promise.all([v.owner(), v.agent(), v.paused(), v.hourlyBudget(), v.perTxCap(), v.approvalAbove(), v.remainingBudget(), v.proposalCount(), reader.getBalance(a), reader.getBlockNumber()]);
      S.addr = a;
      S.info = { owner: r[0], agent: r[1], paused: r[2], budget: r[3], cap: r[4], approval: r[5], left: r[6], count: Number(r[7]), balance: r[8] };
      S.head = r[9]; // the history reads up to this block, without asking for it again
      S.verified = codeMatches(code, r[0]);
      say('o-msg', '');
      try { history.replaceState(null, '', '?' + (NET.main ? 'net=mainnet&' : '') + 'v=' + a); } catch (e) { /* ignore */ }
      renderVault();
      renderProposals();
      renderLog();
      $('vault').hidden = false;
    } catch (e) {
      var offline = e && (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT' || e.code === 'SERVER_ERROR' || /failed to fetch|network|timeout/i.test(e.message || ''));
      say('o-msg', e.message && /no contract/.test(e.message) ? e.message : offline ? NET.label + ' is not answering right now. Try again in a moment.' : 'This address does not look like an Oxva vault on ' + NET.label + '. ' + other, 'err');
    }
  }

  function renderVault() {
    var i = S.info;
    $('v-addr').textContent = ''; $('v-addr').appendChild(link('/address/' + S.addr, S.addr + ' ↗'));
    var badge = $('v-ver');
    if (S.verified) {
      badge.className = 'verify ok'; badge.textContent = 'Verified Oxva code · ' + A.version;
      say('v-check', 'The code at this address is exactly the Oxva vault build this page ships (OxvaVault ' + A.version + ', unaudited).', 'ok');
    } else if (NET.main) {
      badge.className = 'verify bad'; badge.textContent = 'Not Oxva code';
      say('v-check', 'Warning: the code at this address is not the Oxva vault build. Do not send money to it. Deposits are blocked on this page.', 'err');
    } else {
      badge.className = 'verify old'; badge.textContent = 'Older or unknown build';
      say('v-check', 'This is not the current Oxva vault build; it may be an older test vault. Withdrawing tokens needs the current version.');
    }
    $('tok-wrap').hidden = !S.verified;
    $('v-bal').textContent = eth(i.balance);
    $('v-left').textContent = eth(i.left) + ' of ' + eth(i.budget);
    $('v-meter').style.width = (i.budget > 0n ? Number((i.left * 1000n) / i.budget) / 10 : 0) + '%';
    $('v-cap').textContent = eth(i.cap);
    $('v-approve').textContent = eth(i.approval);
    $('r-budget').value = E.formatEther(i.budget); $('r-cap').value = E.formatEther(i.cap); $('r-approval').value = E.formatEther(i.approval);
    $('r-pause').textContent = i.paused ? 'Resume' : 'Pause';
    renderRoles();
  }

  function renderRoles() {
    if (!S.info) return;
    var box = $('v-roles'); box.textContent = '';
    box.appendChild(document.createTextNode('Owner ' + short(S.info.owner)));
    if (same(S.account, S.info.owner)) box.appendChild(el('span', 'role you', 'you'));
    box.appendChild(document.createTextNode(' · Agent ' + short(S.info.agent)));
    if (same(S.account, S.info.agent)) box.appendChild(el('span', 'role you', 'you'));
    if (S.info.paused) box.appendChild(el('span', 'role', 'paused'));
    if (NET.main && same(S.addr, $('vault').getAttribute('data-live'))) box.appendChild(el('span', 'role example', 'Oxva’s example vault'));
  }

  async function renderProposals() {
    var ul = $('props'); ul.textContent = '';
    var n = S.info.count;
    if (!n) { ul.appendChild(el('li', 'what muted', 'None yet.')); return; }
    var v = vaultAt(S.addr), ids = [];
    for (var i = n - 1; i >= Math.max(0, n - 20); i--) ids.push(i);
    var rows = await Promise.all(ids.map(function (id) { return v.getProposal(id).then(function (p) { return { id: id, p: p }; }); }));
    rows.forEach(function (x) {
      var st = STATUS[Number(x.p.status)] || 'none';
      var li = el('li');
      li.appendChild(el('span', 'id', '#' + x.id));
      var sel = x.p.data && x.p.data.length >= 10 ? ' · call ' + x.p.data.slice(0, 10) : '';
      li.appendChild(el('span', 'what', eth(x.p.value) + ' to ' + short(x.p.to) + sel));
      li.appendChild(el('span', 'st ' + st, st));
      if (st === 'pending') {
        var acts = el('div', 'acts');
        var ok = el('button', 'small-btn ink', 'Approve'); ok.type = 'button';
        ok.addEventListener('click', function () { act('r-msg', 'Approved #' + x.id, function (s) { return vaultAt(S.addr, s).approve(x.id); }, true); });
        var no = el('button', 'small-btn', 'Reject'); no.type = 'button';
        no.addEventListener('click', function () { act('r-msg', 'Rejected #' + x.id, function (s) { return vaultAt(S.addr, s).reject(x.id); }, true); });
        acts.appendChild(ok); acts.appendChild(no); li.appendChild(acts);
      }
      ul.appendChild(li);
    });
  }

  /* History from the vault's own events. The public RPCs keep old logs but not old state (about 100,000 blocks of
   * it on mainnet), so the deploy block is never looked up in old state: the page walks back through the logs until
   * it meets the deploy transaction, the only one that emits AgentSet and PolicySet together. The block it finds is
   * remembered in this browser, so the next visit reads forward from it straight away. */
  var LOG_SPAN = 3000000, LOG_PARALLEL = 4, BLOCKS = 'oxva.vaultBlocks', logRun = 0;
  function blockKey(a) { return NET.key + ':' + a.toLowerCase(); }
  function knownBlock(a) {
    var m = mine().filter(function (x) { return same(x.a, a) && netOf(x) === NET.key && x.b; })[0];
    if (m) return m.b;
    try { return (JSON.parse(localStorage.getItem(BLOCKS)) || {})[blockKey(a)] || null; } catch (e) { return null; }
  }
  function saveBlock(a, b) {
    try { var c = JSON.parse(localStorage.getItem(BLOCKS)) || {}; c[blockKey(a)] = b; localStorage.setItem(BLOCKS, JSON.stringify(c)); } catch (e) { /* storage blocked */ }
  }
  /** Logs of vault a in blocks lo..hi. A range the RPC refuses is split in two and asked again. */
  async function logsIn(a, lo, hi, depth) {
    try { return await reader.getLogs({ address: a, fromBlock: lo, toBlock: hi }); }
    catch (e) {
      depth = depth || 0;
      if (depth >= 4 || hi - lo < 10000) throw e;
      var mid = Math.floor((lo + hi) / 2);
      return (await logsIn(a, lo, mid, depth + 1)).concat(await logsIn(a, mid + 1, hi, depth + 1));
    }
  }
  function logsInRanges(a, ranges) {
    return Promise.all(ranges.map(function (r) { return logsIn(a, r[0], r[1]); })).then(function (parts) { return [].concat.apply([], parts); });
  }
  function parsed(logs) {
    return logs.map(function (l) {
      try { var p = iface.parseLog(l); return p ? { block: l.blockNumber, index: l.index, hash: l.transactionHash, name: p.name, text: describe(p) } : null; } catch (e) { return null; }
    }).filter(Boolean);
  }
  /** The block of the deploy transaction among these events, or null when it is not among them. */
  function deployIn(items) {
    var txs = {};
    items.forEach(function (it) { (txs[it.hash] = txs[it.hash] || {})[it.name] = it.block; });
    for (var h in txs) if (txs[h].AgentSet != null && txs[h].PolicySet != null) return txs[h].AgentSet;
    return null;
  }

  function describe(l) {
    var a = l.args;
    switch (l.name) {
      case 'Deposited': return 'Deposit ' + eth(a.amount) + ' from ' + short(a.from);
      case 'Withdrawn': return 'Withdrawal ' + eth(a.amount) + ' to ' + short(a.to);
      case 'TokenWithdrawn': return 'Token withdrawal: ' + a.amount.toString() + ' base units of token ' + short(a.token) + ' to ' + short(a.to);
      case 'PolicySet': return 'Rules: ' + eth(a.hourlyBudget) + '/hour, cap ' + eth(a.perTxCap) + ', approve above ' + eth(a.approvalAbove);
      case 'TargetSet': return (a.allowed ? 'Allowed ' : 'Removed ') + short(a.target);
      case 'AgentSet': return 'Agent set to ' + short(a.agent);
      case 'PausedSet': return a.paused ? 'Paused' : 'Resumed';
      case 'Proposed': return '#' + a.id + ' proposed: ' + eth(a.value) + ' to ' + short(a.to);
      case 'Held': return '#' + a.id + ' held: ' + (Number(a.reason) === 1 ? 'above the approval threshold' : 'over the hourly budget');
      case 'Executed': return '#' + a.id + ' sent: ' + eth(a.value) + ' to ' + short(a.to) + (a.byOwner ? ' (approved by owner)' : '');
      case 'Rejected': return '#' + a.id + ' rejected by owner';
      default: return l.name;
    }
  }

  async function renderLog() {
    var run = ++logRun, a = S.addr, ol = $('log');
    ol.textContent = ''; ol.appendChild(el('li', '', 'Reading the chain…'));
    try {
      var head = S.head || await reader.getBlockNumber(), from = knownBlock(a), items = [];
      if (from != null) {
        var forward = [];
        for (var b = from; b <= head; b += LOG_SPAN) forward.push([b, Math.min(head, b + LOG_SPAN - 1)]);
        items = parsed(await logsInRanges(a, forward));
      } else {
        // walk back from the newest block, a few ranges at a time, until the deploy transaction turns up
        var hi = head, found = null;
        while (hi >= NET.floor && found == null) {
          var back = [];
          for (var k = 0; k < LOG_PARALLEL && hi >= NET.floor; k++) { var lo = Math.max(NET.floor, hi - LOG_SPAN + 1); back.push([lo, hi]); hi = lo - 1; }
          var part = parsed(await logsInRanges(a, back));
          if (run !== logRun) return; // another vault was opened meanwhile
          items = items.concat(part);
          found = deployIn(items);
          if (found == null && hi >= NET.floor) drawLog(items, true); // show what is in while older blocks are read
        }
        if (found != null) saveBlock(a, found);
      }
      if (run === logRun) drawLog(items, false);
    } catch (e) {
      if (run === logRun) { ol.textContent = ''; ol.appendChild(el('li', '', 'The history could not be read right now.')); }
    }
  }

  function drawLog(items, more) {
    var ol = $('log'); ol.textContent = '';
    items = items.slice().sort(function (x, y) { return (y.block - x.block) || (y.index - x.index); }).slice(0, 100);
    if (!items.length) { ol.appendChild(el('li', '', more ? 'Reading older blocks…' : 'No events found yet.')); return; }
    items.forEach(function (it) {
      var li = el('li'); var b = el('span'); b.appendChild(link('/tx/' + it.hash, '#' + it.block.toLocaleString('en-US'))); li.appendChild(b); li.appendChild(el('span', '', it.text)); ol.appendChild(li);
    });
    if (more) ol.appendChild(el('li', 'muted', 'Reading older blocks…'));
  }

  /* ---------- write actions ---------- */
  async function act(msgId, done, fn, ownerOnly) {
    try {
      var signer = await ready();
      if (ownerOnly && S.info && !same(S.account, S.info.owner)) throw new Error(EXPLAIN.NotOwner);
      say(msgId, 'Confirm in your wallet…');
      var tx = await fn(signer);
      say(msgId, 'Waiting for the block…', '', tx.hash);
      await tx.wait();
      say(msgId, done + '.', 'ok', tx.hash);
      await openVault(S.addr); refreshWallet();
    } catch (e) { say(msgId, reason(e), 'err'); }
  }

  function proposal() {
    var to = addr($('p-to').value, 'The target');
    var value = amount('p-value');
    var data = String($('p-data').value || '').trim() || '0x';
    if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new Error('Call data must be hex, like 0x or 0x12345678…');
    return { to: to, value: value, data: data };
  }

  /** Simulate as the agent: no wallet needed, no gas spent. */
  async function check() {
    var sim = $('p-sim');
    try {
      var p = proposal(), i = S.info;
      await vaultAt(S.addr).propose.staticCall(p.to, p.value, p.data, { from: i.agent });
      if (p.value > i.approval) { sim.className = 'sim hold'; sim.textContent = 'Would be held: above the approval threshold. The owner must approve it.'; }
      else if (p.value > i.left) { sim.className = 'sim hold'; sim.textContent = 'Would be held: over what is left of this hour’s budget.'; }
      else { sim.className = 'sim ok'; sim.textContent = 'Would go through at once: within the rules.'; }
      return true;
    } catch (e) { sim.className = 'sim no'; sim.textContent = 'Would be refused: ' + reason(e); return false; }
  }

  async function propose(ev) {
    ev.preventDefault();
    if (!(await check())) return;
    var p;
    try { p = proposal(); } catch (e) { say('p-msg', e.message, 'err'); return; }
    try {
      var signer = await ready();
      if (!same(S.account, S.info.agent)) throw new Error(EXPLAIN.NotAgent);
      say('p-msg', 'Confirm in your wallet…');
      var tx = await vaultAt(S.addr, signer).propose(p.to, p.value, p.data);
      say('p-msg', 'Waiting for the block…', '', tx.hash);
      var rc = await tx.wait();
      var held = rc.logs.some(function (l) { try { var x = iface.parseLog(l); return x && x.name === 'Held'; } catch (e) { return false; } });
      say('p-msg', held ? 'Proposed and held: the owner must approve it.' : 'Proposed and sent.', 'ok', tx.hash);
      await openVault(S.addr); refreshWallet();
    } catch (e) { say('p-msg', reason(e), 'err'); }
  }

  async function withdrawToken() {
    try {
      var t = addr($('k-token').value, 'The token');
      var raw = decimal('k-amt', 'a token amount');
      var tok = new E.Contract(t, ['function decimals() view returns (uint8)'], reader);
      var dec = 18;
      try { dec = Number(await tok.decimals()); } catch (e) { /* no decimals(): assume 18 */ }
      if (!(dec >= 0 && dec <= 36)) throw new Error('That token reports odd decimals; withdraw it with a block explorer instead.');
      var v = E.parseUnits(raw, dec);
      await act('r-msg', 'Withdrew ' + raw + ' of token ' + short(t), function (s) { return vaultAt(S.addr, s).withdrawToken(t, S.account, v); }, true);
    } catch (e) { say('r-msg', reason(e), 'err'); }
  }

  /* ---------- wire up ---------- */
  ['pointerenter', 'focus', 'touchstart'].forEach(function (ev) { $('connect').addEventListener(ev, function () { if (W.warm) W.warm(); }, { passive: true }); });
  $('connect').addEventListener('click', function () { connect().catch(function (e) { $('who').textContent = reason(e); }); });
  $('switch').addEventListener('click', function () { switchChain().catch(function (e) { $('who').textContent = reason(e); }); });
  $('create').addEventListener('submit', create);
  $('open').addEventListener('submit', function (e) { e.preventDefault(); openVault($('o-addr').value); });
  $('agent-box').addEventListener('submit', propose);
  $('p-check').addEventListener('click', check);
  $('r-save').addEventListener('click', function () {
    try { var b = amount('r-budget'), c = amount('r-cap'), a = amount('r-approval'); act('r-msg', 'Rules saved', function (s) { return vaultAt(S.addr, s).setPolicy(b, c, a); }, true); } catch (e) { say('r-msg', e.message, 'err'); }
  });
  $('r-pause').addEventListener('click', function () { var to = !S.info.paused; act('r-msg', to ? 'Paused' : 'Resumed', function (s) { return vaultAt(S.addr, s).setPaused(to); }, true); });
  $('t-add').addEventListener('click', function () { try { var t = addr($('t-addr').value); act('r-msg', 'Allowed ' + short(t), function (s) { return vaultAt(S.addr, s).setTarget(t, true); }, true); } catch (e) { say('r-msg', e.message, 'err'); } });
  $('t-del').addEventListener('click', function () { try { var t = addr($('t-addr').value); act('r-msg', 'Removed ' + short(t), function (s) { return vaultAt(S.addr, s).setTarget(t, false); }, true); } catch (e) { say('r-msg', e.message, 'err'); } });
  $('t-check').addEventListener('click', function () {
    try { var t = addr($('t-addr').value); vaultAt(S.addr).allowed(t).then(function (ok) { say('r-msg', short(t) + (ok ? ' is allowed.' : ' is not allowed.'), ok ? 'ok' : ''); }); } catch (e) { say('r-msg', e.message, 'err'); }
  });
  $('m-dep-go').addEventListener('click', function () {
    try {
      if (NET.main && !S.verified) throw new Error('This address does not run the Oxva vault code, so this page will not send money to it.');
      needAck();
      var v = amount('m-dep');
      act('r-msg', 'Deposited ' + eth(v), function (s) { return s.sendTransaction({ to: S.addr, value: v }); }, false);
    } catch (e) { say('r-msg', e.message, 'err'); }
  });
  $('m-wd-go').addEventListener('click', function () { try { var v = amount('m-wd'); act('r-msg', 'Withdrew ' + eth(v), function (s) { return vaultAt(S.addr, s).withdraw(S.account, v); }, true); } catch (e) { say('r-msg', e.message, 'err'); } });
  $('k-go').addEventListener('click', withdrawToken);
  $('a-go').addEventListener('click', function () { try { var a = addr($('a-new').value, 'The new agent'); act('r-msg', 'Agent set to ' + short(a), function (s) { return vaultAt(S.addr, s).setAgent(a); }, true); } catch (e) { say('r-msg', e.message, 'err'); } });

  $('disconnect').addEventListener('click', function () { W.disconnect(); });
  W.on(function () { refreshWallet().catch(function () { /* wallet locked */ }); });

  setupPage();
  netStatus(); setInterval(netStatus, 30000);
  renderMine();
  W.restore().then(function () { return refreshWallet(); }).catch(function () { /* wallet locked */ });
  var v = params.get('v');
  if (v) { $('o-addr').value = v; openVault(v); }
})();
