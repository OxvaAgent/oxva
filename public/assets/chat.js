/* Oxva chat page: sends the conversation to /api/chat and streams the answer in. Plain text only. */
(function () {
  'use strict';
  var U = window.OxvaUI, el = U.el;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'oxva.chat.session';
  var MARK = document.querySelector('.hello-row svg').outerHTML;
  var history = [];
  var busy = false;

  function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-20))); } catch (e) { /* storage blocked */ } }

  function scroll() { var l = $('log'); l.scrollTop = l.scrollHeight; }
  function addUser(text) { var d = el('div', 'msg user', text); $('log').appendChild(d); scroll(); }
  function addOxva(text, cls) {
    var d = el('div', 'msg oxva' + (cls ? ' ' + cls : ''));
    d.insertAdjacentHTML('afterbegin', MARK); // our own static SVG, not user content
    var t = el('div', 'txt'); if (text != null) t.textContent = text;
    d.appendChild(t); $('log').appendChild(d); scroll();
    return t;
  }
  function typing(t) { t.textContent = ''; var s = el('span', 'typing'); s.appendChild(el('i')); s.appendChild(el('i')); s.appendChild(el('i')); t.appendChild(s); }

  function setBusy(b) { busy = b; $('send').disabled = b; $('send').textContent = b ? '…' : 'Send'; }

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    if (text.length > 1200) text = text.slice(0, 1200);
    history.push({ role: 'user', content: text }); save();
    addUser(text);
    $('input').value = ''; resize(); count();
    var out = addOxva(''); typing(out);
    setBusy(true);
    var tok = $('tok').value.trim();
    var body = { messages: history.slice(-12) };
    if (/^0x[0-9a-fA-F]{40}$/.test(tok)) body.token = { address: tok, chain: $('tok-chain').value };

    fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            history.pop(); save();
            out.parentNode.classList.add('err');
            out.textContent = j.error || 'Something went wrong (' + r.status + '). Try again in a minute.';
          });
        }
        var reader = r.body.getReader(), dec = new TextDecoder(), acc = '';
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) { acc += dec.decode(); out.textContent = acc.trim() || 'No answer came back. Try again.'; history.push({ role: 'assistant', content: acc.trim() }); save(); return; }
            acc += dec.decode(res.value, { stream: true });
            out.textContent = acc; scroll();
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        history.pop(); save();
        out.parentNode.classList.add('err');
        out.textContent = 'Could not reach Oxva. Check your connection and try again.';
      })
      .then(function () { setBusy(false); $('input').focus(); });
  }

  function resize() { var t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
  function count() { $('count').textContent = $('input').value.length + ' / 1200'; }

  $('form').addEventListener('submit', function (e) { e.preventDefault(); send($('input').value); });
  $('input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('input').value); } });
  $('input').addEventListener('input', function () { resize(); count(); });
  Array.prototype.forEach.call(document.querySelectorAll('.sug'), function (b) { b.addEventListener('click', function () { send(b.textContent); }); });
  $('clear').addEventListener('click', function () {
    history = []; save();
    Array.prototype.slice.call($('log').children, 1).forEach(function (n) { n.remove(); });
    $('input').focus();
  });

  // restore this tab's conversation
  history = load();
  history.forEach(function (m) { if (m.role === 'user') addUser(m.content); else addOxva(m.content); });
  var q = new URLSearchParams(location.search).get('q');
  if (q) send(q.slice(0, 1200));
})();
