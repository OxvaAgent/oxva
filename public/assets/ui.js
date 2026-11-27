/* Oxva shared browser helpers: formatting, the calls API, and the call card. */
(function () {
  'use strict';
  var CHAIN_NAMES = { ethereum: 'Ethereum', bsc: 'BNB Chain', base: 'Base', arbitrum: 'Arbitrum', polygon: 'Polygon' };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function price(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 });
    var m = Number(n).toFixed(20).match(/^0\.(0*)(\d{1,4})/);
    return m ? '$0.' + m[1] + m[2] : '$' + Number(n).toPrecision(3);
  }
  function usd(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Number(n).toFixed(2);
  }
  function pct(n) { return n == null ? '—' : (n > 0 ? '+' : '') + Number(n).toFixed(Math.abs(n) < 10 ? 1 : 0) + '%'; }
  function ago(t, now) {
    var s = Math.max(0, ((now || Date.now()) - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 129600) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + ' days ago';
  }
  function until(t, now) {
    var m = Math.max(0, Math.round((t - (now || Date.now())) / 60000));
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min';
  }
  function dots(n) {
    var d = el('span', 'dots'); d.setAttribute('aria-label', 'Conviction ' + n + ' of 5');
    for (var i = 1; i <= 5; i++) d.appendChild(el('span', i <= n ? 'on' : ''));
    return d;
  }
  function pill(action) { var p = el('span', 'pill a-' + action); p.appendChild(el('i')); p.appendChild(document.createTextNode(action)); return p; }

  var STATUS_TEXT = { working: 'Working', against: 'Against', invalidated: 'Invalidated', watching: 'Watching', open: 'Open' };

  /* ---------- share ----------
   * A Share button: on phones it opens the system share sheet (WhatsApp, Telegram, X…); elsewhere, or if that is
   * not available, it copies the link. Shared links show the Oxva card (Open Graph tags from scripts/build.js).
   * get() is called on click and returns { url, title, text }; url may be relative. */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var t = el('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? ok() : fail(new Error('copy failed')); } catch (e) { fail(e); } finally { t.remove(); }
    });
  }
  function shareButton(get, label) {
    var b = el('button', 'share-btn'); b.type = 'button';
    var SVG = 'http://www.w3.org/2000/svg', s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6'); s.appendChild(p);
    var t = el('span', '', label || 'Share'); b.appendChild(s); b.appendChild(t);
    var timer;
    function flash(msg) { t.textContent = msg; b.classList.add('done'); clearTimeout(timer); timer = setTimeout(function () { t.textContent = label || 'Share'; b.classList.remove('done'); }, 1800); }
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var d = get() || {}; var url = new URL(d.url || location.href, location.href).href;
      var phone = window.matchMedia && matchMedia('(pointer: coarse)').matches;
      if (phone && navigator.share) {
        navigator.share({ title: d.title || document.title, text: d.text || '', url: url }).catch(function (err) {
          if (err && err.name === 'AbortError') return; // the visitor closed the sheet
          copyText(url).then(function () { flash('Link copied'); }, function () { flash('Copy failed'); });
        });
        return;
      }
      copyText(url).then(function () { flash('Link copied'); }, function () { flash('Copy failed'); });
    });
    return b;
  }

  /** A call card (all API strings set as text, never HTML). The symbol is the link; it stretches over the card,
   *  so the Share button can sit on top of it without nesting a button in a link. */
  function callCard(c, now) {
    var a = el('div', 'call c-card');
    var href = '/read/?t=' + c.address + '&c=' + c.chain;
    var top = el('div', 'c-top');
    var link = el('a', 'c-sym c-link', c.sym); link.href = href; link.setAttribute('aria-label', c.action + ' call on ' + c.sym);
    top.appendChild(link); top.appendChild(el('span', 'mono muted', CHAIN_NAMES[c.chain] || c.chain)); a.appendChild(top);
    var r1 = el('div', 'c-row'); r1.appendChild(pill(c.action)); r1.appendChild(dots(c.conviction)); a.appendChild(r1);
    var mv = el('div', 'c-move');
    mv.appendChild(el('b', '', price(c.price)));
    if (c.now && c.now.price != null && c.now.at > c.at) {
      mv.appendChild(el('span', 'arrow', '→')); mv.appendChild(el('b', '', price(c.now.price)));
      mv.appendChild(el('span', 'mono ' + (c.now.move >= 0 ? 's-working' : 's-invalidated'), pct(c.now.move)));
    }
    a.appendChild(mv);
    var st = el('div', 'c-row');
    st.appendChild(el('span', 'mono muted', ago(c.at, now)));
    st.appendChild(el('span', 'mono s-' + c.status, (STATUS_TEXT[c.status] || c.status) + (c.final && c.status !== 'invalidated' ? ' · closed' : '')));
    a.appendChild(st);
    var lv = el('div', 'c-levels');
    var e1 = el('div'); e1.appendChild(el('span', '', 'Entry ')); e1.appendChild(document.createTextNode(price(c.entry[0]) + '–' + price(c.entry[1]).replace('$', ''))); lv.appendChild(e1);
    var e2 = el('div'); e2.appendChild(el('span', '', 'Invalid ')); e2.appendChild(document.createTextNode(c.invalidation != null ? price(c.invalidation) : '—')); lv.appendChild(e2);
    a.appendChild(lv);
    a.appendChild(el('p', 'c-reason', c.reason));
    var rk = el('p', 'c-risk'); rk.appendChild(el('b', '', 'Risk. ')); rk.appendChild(document.createTextNode(c.risk)); a.appendChild(rk);
    var foot = el('div', 'c-share');
    foot.appendChild(shareButton(function () {
      return { url: href, title: 'Oxva call: ' + c.action + ' ' + c.sym, text: 'Oxva call on ' + c.sym + ' (' + (CHAIN_NAMES[c.chain] || c.chain) + '): ' + c.action + '.' };
    }));
    a.appendChild(foot);
    return a;
  }

  var cache = null;
  function getCalls() {
    if (!cache) cache = fetch('/api/calls', { headers: { accept: 'application/json' } }).then(function (r) {
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status); return d; });
    });
    return cache;
  }

  // placeholders while calls load; skipped when the page already came with calls in its HTML (lib/live-html.mjs)
  function skeletonCards(box, n) {
    if (!box || box.children.length) return;
    box.textContent = '';
    for (var i = 0; i < n; i++) {
      var d = el('div', 'call'); d.setAttribute('aria-hidden', 'true');
      [['30px', '40%'], ['24px', '55%'], ['22px', '70%'], ['40px', '100%']].forEach(function (s) { var k = el('div', 'skel'); k.style.height = s[0]; k.style.width = s[1]; d.appendChild(k); });
      box.appendChild(d);
    }
  }

  // mark the current page in the nav
  var here = document.body.getAttribute('data-page');
  Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) { if (a.getAttribute('data-nav') === here) a.setAttribute('aria-current', 'page'); });

  // any <button data-copy="…"> copies its value (the $OXVA contract on home and Docs)
  Array.prototype.forEach.call(document.querySelectorAll('button[data-copy]'), function (b) {
    var label = b.textContent;
    b.addEventListener('click', function () {
      copyText(b.getAttribute('data-copy')).then(function () { b.textContent = 'Copied'; b.classList.add('done'); setTimeout(function () { b.textContent = label; b.classList.remove('done'); }, 1500); }, function () { /* blocked */ });
    });
  });

  window.OxvaUI = { el: el, price: price, usd: usd, pct: pct, ago: ago, until: until, dots: dots, pill: pill, callCard: callCard, shareButton: shareButton, copyText: copyText, getCalls: getCalls, skeletonCards: skeletonCards, CHAIN_NAMES: CHAIN_NAMES };

  /* ---------- phone menu ----------
   * On phones the top bar keeps the logo and the wallet button, plus a ≡ button that opens a full-screen menu built from
   * the nav's own links, with Ask Oxva and Connect wallet underneath . */
  (function phoneMenu() {
    var nav = document.getElementById('nav'), bar = nav && nav.querySelector('.nav-in'), links = nav && nav.querySelector('.links');
    if (!bar || !links || document.getElementById('nav-burger')) return;
    var SVG = 'http://www.w3.org/2000/svg';
    function icon(d) { var s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.appendChild(p); return s; }
    var burger = el('button', 'nav-burger'); burger.type = 'button'; burger.id = 'nav-burger';
    burger.setAttribute('aria-label', 'Open menu'); burger.setAttribute('aria-expanded', 'false'); burger.setAttribute('aria-controls', 'nav-menu');
    burger.appendChild(icon('M4 7h16M4 12h16M4 17h16'));
    bar.appendChild(burger);
    nav.classList.add('has-menu');

    var menu = el('div', 'nav-menu'); menu.id = 'nav-menu'; menu.hidden = true;
    menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-modal', 'true'); menu.setAttribute('aria-label', 'Menu');
    var top = el('div', 'nm-top');
    var brand = nav.querySelector('.brand').cloneNode(true); top.appendChild(brand);
    var x = el('button', 'nav-burger nm-close'); x.type = 'button'; x.setAttribute('aria-label', 'Close menu'); x.appendChild(icon('M6 6l12 12M18 6L6 18'));
    top.appendChild(x); menu.appendChild(top);
    var list = el('nav', 'nm-links'); list.setAttribute('aria-label', 'Menu');
    var home = el('a', '', 'Home'); home.href = '/'; if (document.body.getAttribute('data-page') === 'home') home.setAttribute('aria-current', 'page'); list.appendChild(home);
    Array.prototype.forEach.call(links.querySelectorAll('a'), function (a) { var c = el('a', '', a.textContent); c.href = a.getAttribute('href'); if (a.hasAttribute('aria-current')) c.setAttribute('aria-current', 'page'); list.appendChild(c); });
    menu.appendChild(list);
    var cta = el('div', 'nm-cta');
    var ask = el('a', 'btn btn-ink', 'Ask Oxva'); ask.href = '/chat/'; cta.appendChild(ask);
    var wal = el('button', 'btn btn-line', 'Connect wallet'); wal.type = 'button'; cta.appendChild(wal);
    menu.appendChild(cta);
    // GitHub, X and Telegram: copied from the footer, so a link added there shows up here too
    var soc = document.querySelector('footer .socials');
    if (soc) { var sc = soc.cloneNode(true); sc.classList.add('nm-socials'); menu.appendChild(sc); }
    document.body.appendChild(menu);

    function open() { menu.hidden = false; document.body.classList.add('nav-open'); burger.setAttribute('aria-expanded', 'true'); syncWallet(); x.focus(); }
    function close() { menu.hidden = true; document.body.classList.remove('nav-open'); burger.setAttribute('aria-expanded', 'false'); }
    // the menu's wallet button mirrors the top bar's one (address once connected)
    function syncWallet() { var nw = document.getElementById('nav-wallet'), long = nw && nw.querySelector('.nw-long'); wal.textContent = nw && nw.classList.contains('on') && long ? long.textContent : 'Connect wallet'; }
    burger.addEventListener('click', open);
    x.addEventListener('click', function () { close(); burger.focus(); });
    wal.addEventListener('click', function () { close(); var nw = document.getElementById('nav-wallet'); if (nw) nw.click(); });
    menu.addEventListener('click', function (e) { if (e.target.closest('.nm-links a, .nm-cta a')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { close(); burger.focus(); } });
    window.addEventListener('resize', function () { if (window.innerWidth > 760 && !menu.hidden) close(); });
  })();

  /* ---------- light mode ----------
   * Only on request: ?lite=1 gives a plain ground and no animations (for very slow machines). The owner wants the
   * motion everywhere else, so there is no automatic switch; an old remembered switch is cleared. */
  (function lite() {
    try { sessionStorage.removeItem('oxva.lite'); } catch (e) { /* storage blocked */ }
    if (/[?&]lite=1\b/.test(location.search)) { document.documentElement.classList.add('lite'); document.documentElement.setAttribute('data-lite', 'forced'); }
  })();

  /* ---------- reveal on scroll, both ways ----------
   * Headings, cards and blocks start a little lower and transparent, then rise into place as they come into view;
   * siblings follow one another 80 ms apart. When an element leaves the screen it resets, so it comes in again on the
   * way back: from below when scrolling down, from above when scrolling up. Content added later (calls loading in)
   * does the same. Nothing is hidden without JavaScript, and it moves whatever the system motion setting. CSS: .rv in site.css. */
  (function reveal() {
    var main = document.querySelector('main');
    if (!main || !('IntersectionObserver' in window) || !Element.prototype.closest) return;
    if (document.documentElement.classList.contains('lite')) return; // light mode: everything simply shows
    if (document.querySelector('.lp-hero')) return; // the home page scrolls as slides (slides.js)
    var SEL = [
      '.kicker', '.h1', '.lede', '.eyebrow', '.lp-h1', '.lp-lede', '.sec-head > *', '.lp-head > *',
      '.lp-hero .stats > *', '.lp-hero .status', '.lp-hero .ca', '.lp-hero .hint', '.lp-hero .cta', '.lp-hero .chips',
      '.calls-grid > *', '.bento > *', '.anat > *', '.trio > *', '.rec > *', '.ways > *', '.grid2 > *', '.outcomes > *',
      '.honest', '.flow-wrap', '.sub', '.more', '.token', '.final', '.faq details',
      '.sec > .wrap > *:not(.sec-head)', '.panel', '.wtable-wrap', '.tscroll', '.danger', '.warnbox', '.netpick', '.steps > *'
    ].join(',');
    var pending = [];
    function show(t) {
      enter.unobserve(t);
      var i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1);
      if (t.classList.contains('rv')) t.classList.add('in');
      t.setAttribute('data-rv-shown', '');
    }
    // comes into view: rise in (8% short of the bottom edge, so it happens where the eye is)
    var enter = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) show(e.target); });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    // fully off screen again: reset, ready to come in from the side it left by
    var leave = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var t = e.target;
        if (e.isIntersecting || !t.hasAttribute('data-rv-shown')) return;
        t.removeAttribute('data-rv-shown');
        t.setAttribute('data-from', e.boundingClientRect.top < 0 ? 'above' : 'below');
        t.classList.remove('in'); t.classList.add('rv');
        enter.observe(t);
      });
    }, { threshold: 0 });
    // a fast scroll or a jump (End key, an in-page link) can carry elements straight past without them ever
    // intersecting: anything already above the fold line comes in too, so nothing stays hidden
    var ticking = false;
    function sweep() {
      ticking = false;
      var line = window.innerHeight * 0.92;
      pending.slice().forEach(function (t) { if (t.getBoundingClientRect().top < line) show(t); });
    }
    window.addEventListener('scroll', function () { if (!ticking && pending.length) { ticking = true; requestAnimationFrame(sweep); } }, { passive: true });
    // once in place, drop the classes so hover effects and the element's own styles apply
    function settle(e) {
      var t = e.currentTarget;
      if (e.target !== t || e.propertyName !== 'opacity' || !t.classList.contains('in')) return;
      t.classList.remove('rv', 'in'); t.removeAttribute('data-from');
    }
    function prep(list) {
      list.forEach(function (n) {
        if (n.hasAttribute('data-rv') || n.closest('dialog, [data-no-reveal]')) return;
        var up = n.parentElement && n.parentElement.closest(SEL);
        if (up && main.contains(up)) return; // inside a block that already moves as a whole
        var sibs = Array.prototype.filter.call(n.parentElement.children, function (c) { return c.matches(SEL); });
        n.setAttribute('data-rv', '');
        n.style.setProperty('--i', Math.min(8, sibs.indexOf(n)));
        n.classList.add('rv');
        n.addEventListener('transitionend', settle);
        pending.push(n);
        enter.observe(n);
        leave.observe(n);
      });
    }
    prep(Array.prototype.slice.call(main.querySelectorAll(SEL)));
    if (window.MutationObserver) new MutationObserver(function (muts) {
      var add = [];
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches(SEL)) add.push(n);
          Array.prototype.push.apply(add, n.querySelectorAll(SEL));
        });
      });
      if (add.length) prep(add);
    }).observe(main, { childList: true, subtree: true });
  })();
})();
