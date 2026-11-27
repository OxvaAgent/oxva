/* Docs: highlight the chapter you are reading in the contents list. */
(function () {
  'use strict';
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (!links.length || !('IntersectionObserver' in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove('on'); });
      var a = byId[e.target.id]; if (a) a.classList.add('on');
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  Array.prototype.forEach.call(document.querySelectorAll('.chap[id]'), function (c) { io.observe(c); });
})();
