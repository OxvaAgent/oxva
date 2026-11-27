/* Home page as framed "slides": every section becomes a framed panel with
 * a slide number, a name and corner brackets. As a slide comes into view its frame lights up, the heading rises word by
 * word and the rest follows in a short cascade. Each slide animates once. Only with ?lite=1 (ui.js) or no
 * IntersectionObserver is everything simply shown. CSS: the "slides" block in src/index.html.
 * Each slide's name comes from data-name on it (the hero: on .frame), so sections can be moved freely. The section
 * rail (a dot per slide on the right edge, CSS ".rail" in index.html) jumps to a slide and marks the one on screen. */
(function () {
  'use strict';
  var root = document.documentElement;
  var hero = document.querySelector('.lp-hero .frame');
  var slides = (hero ? [hero] : []).concat(Array.prototype.slice.call(document.querySelectorAll('main > section.lp-sec')));
  if (!slides.length) return;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nameOf(el) { return el.getAttribute('data-name') || ''; }

  slides.forEach(function (el, i) {
    el.classList.add('slide');
    var tag = document.createElement('div');
    tag.className = 'slide-tag'; tag.setAttribute('aria-hidden', 'true');
    var a = document.createElement('span'); a.textContent = pad(i + 1); var tot = document.createElement('span'); tot.className = 'st-total'; tot.textContent = ' / ' + pad(slides.length); a.appendChild(tot); // the total is hidden on phones
    var b = document.createElement('span'); b.textContent = nameOf(el);
    tag.appendChild(a); tag.appendChild(b);
    el.insertBefore(tag, el.firstChild);
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) { var s = document.createElement('i'); s.className = 'corner ' + c; s.setAttribute('aria-hidden', 'true'); el.appendChild(s); });
  });

  /* ---------- the section rail ---------- */
  (function rail() {
    var nav = document.createElement('nav');
    nav.className = 'rail'; nav.setAttribute('aria-label', 'Sections on this page');
    var links = slides.map(function (el) {
      var target = el.id ? el : el.closest('section');
      var a = document.createElement('a');
      a.href = '#' + (target && target.id ? target.id : '');
      var label = document.createElement('span'); label.textContent = nameOf(el);
      a.appendChild(label); a.setAttribute('aria-label', nameOf(el));
      nav.appendChild(a);
      return a;
    });
    document.body.appendChild(nav);
    var current = -1, queued = false;
    function mark() {
      queued = false;
      var line = innerHeight * 0.4, at = 0;
      slides.forEach(function (el, i) { if (el.getBoundingClientRect().top <= line) at = i; });
      if (at === current) return;
      if (current >= 0) links[current].removeAttribute('aria-current');
      links[at].setAttribute('aria-current', 'true');
      current = at;
    }
    window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(mark); } }, { passive: true });
    window.addEventListener('resize', mark);
    mark();
  })();

  if (root.classList.contains('lite') || !('IntersectionObserver' in window)) { slides.forEach(function (s) { s.classList.add('in'); }); return; }
  root.classList.add('slides-anim');

  // wrap every word of a heading in a mask so it can rise from below its line; child elements (the italic word) keep
  // their styling and line breaks stay where they are
  function split(el) {
    var n = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          var frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var w = document.createElement('span'); w.className = 'w';
            var inner = document.createElement('span'); inner.textContent = part; inner.style.setProperty('--i', n++);
            w.appendChild(inner); frag.appendChild(w);
          });
          ch.parentNode.replaceChild(frag, ch);
        } else if (ch.nodeType === 1 && ch.tagName !== 'BR') walk(ch);
      });
    })(el);
    return n;
  }

  var CASCADE = '.eyebrow, .lp-head .mono, .lp-lede, .lp-head p, .stats > *, .status, .ca, .hint, .cta, .chips, .hero-art, ' +
    '.bento > *, .calls-grid, .more, .anat > *, .honest, .flow-wrap, .trio > *, .sub, .rec > *, .token .big, .token .lp-lede, .facts, .warn, .faq details';
  slides.forEach(function (s) {
    var words = 0;
    Array.prototype.forEach.call(s.querySelectorAll('.lp-h1, .lp-h2'), function (h) { words = Math.max(words, split(h)); h.classList.add('split'); });
    var start = Math.min(words, 14) * 45 + 220; // the rest begins as the heading settles
    Array.prototype.forEach.call(s.querySelectorAll(CASCADE), function (el, k) {
      el.classList.add('rise');
      el.style.setProperty('--d', (el.matches('.eyebrow, .lp-head .mono') ? 0 : start + Math.min(k, 10) * 70) + 'ms');
    });
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
  slides.forEach(function (s) { io.observe(s); });

  // safety net: a slide on screen (or already passed) is always shown, even if the observer never fires
  function sweep() { slides.forEach(function (s) { if (s.getBoundingClientRect().top < innerHeight * 0.95) s.classList.add('in'); }); }
  setTimeout(sweep, 2000);
  var t = 0;
  window.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(sweep, 400); }, { passive: true });
})();
