/* Mockup-only interactions. Not part of the PW app — this exists purely so the
   static mockups exercise the CSS states (.open, .show, .active, .voted) and
   you can feel the v3.1 micro-animations. No network, no storage, no deps. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- drawer ---- */
  function setDrawer(open) {
    var d = $('.drawer'), b = $('.drawer-backdrop');
    if (!d) return;
    d.classList.toggle('open', open);
    if (b) b.classList.toggle('open', open);
    var t = $('[data-drawer-open]');
    if (t) t.setAttribute('aria-expanded', String(open));
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-drawer-open]')) setDrawer(true);
    if (e.target.closest('[data-drawer-close]') || e.target.classList.contains('drawer-backdrop')) setDrawer(false);
  });

  /* ---- modal ---- */
  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-modal]');
    if (opener) {
      var m = document.getElementById(opener.getAttribute('data-modal'));
      if (m) { m.classList.add('open'); var f = m.querySelector('input,textarea,select'); if (f) f.focus(); }
    }
    if (e.target.closest('[data-modal-close]')) {
      var box = e.target.closest('.modal');
      if (box) box.classList.remove('open');
    }
    /* click the dimmed area, not the sheet */
    if (e.target.classList.contains('modal')) e.target.classList.remove('open');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $$('.modal.open').forEach(function (m) { m.classList.remove('open'); }); setDrawer(false); }
  });

  /* ---- toast ---- */
  var toastTimer;
  window.toast = function (msg, isErr) {
    var t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    /* restart the entrance animation even on back-to-back toasts */
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-toast]');
    if (el) window.toast(el.getAttribute('data-toast'), el.hasAttribute('data-toast-err'));
  });

  /* ---- chips: single-select filter row ---- */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('.chips .chip');
    if (!chip) return;
    $$('.chip', chip.parentNode).forEach(function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
    /* re-run the staggered card entrance, the way a real filter re-render would */
    var list = $('[data-cards]');
    if (list) { var clone = list.cloneNode(true); list.parentNode.replaceChild(clone, list); }
  });

  /* ---- polls ---- */
  document.addEventListener('click', function (e) {
    var opt = e.target.closest('.poll-opt');
    if (!opt || opt.closest('[data-voted]')) return;
    var wrap = opt.parentNode;
    wrap.setAttribute('data-voted', '1');
    var pcts = [58, 27, 15];
    $$('.poll-opt', wrap).forEach(function (o, i) {
      var pct = pcts[i] === undefined ? 0 : pcts[i];
      var fill = $('.fill', o);
      if (fill) fill.style.width = pct + '%';
      var out = $('[data-pct]', o);
      if (out) out.textContent = pct + '%';
      if (o === opt) o.classList.add('voted');
    });
  });

  /* ---- fake upload, to watch the progress sheen ---- */
  window.fakeUpload = function (btn) {
    var wrap = btn.closest('[data-upload]');
    if (!wrap || wrap.dataset.busy) return;
    wrap.dataset.busy = '1';
    var bar = $('.bar', wrap), label = $('.progress-label', wrap);
    var pct = 0;
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner"></span> Uploading';
    var id = setInterval(function () {
      pct = Math.min(100, pct + Math.random() * 9 + 2);
      bar.style.width = pct + '%';
      label.textContent = pct < 100
        ? 'Uploading… ' + pct.toFixed(0) + '%  ·  ' + (pct * 2.4).toFixed(1) + ' MB of 240 MB'
        : 'Done — 240 MB uploaded';
      if (pct >= 100) {
        clearInterval(id);
        btn.classList.remove('loading');
        btn.textContent = 'Upload file';
        delete wrap.dataset.busy;
        window.toast('Uploaded to the library');
      }
    }, 260);
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-upload-start]');
    if (b) window.fakeUpload(b);
  });

  /* ---- skeleton -> content, so the loading path is visible ---- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-reload]');
    if (!b) return;
    var target = document.getElementById(b.getAttribute('data-reload'));
    if (!target) return;
    var real = target.innerHTML;
    target.innerHTML =
      '<div class="skeleton" style="height:150px;margin-bottom:14px"></div>' +
      '<div class="skeleton" style="height:150px;margin-bottom:14px"></div>';
    setTimeout(function () { target.innerHTML = real; }, 1400);
  });

  /* ---- share-link highlight flash ---- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-flash]');
    if (!b) return;
    var c = document.getElementById(b.getAttribute('data-flash'));
    if (!c) return;
    c.classList.remove('highlight');
    void c.offsetWidth;
    c.classList.add('highlight');
    c.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  /* ---- chat: send a message so bubble entrance direction is visible ---- */
  window.mockSend = function (form) {
    var input = $('input[type=text]', form);
    var txt = (input.value || '').trim();
    if (!txt) return false;
    var msgs = $('.chat-msgs');
    var el = document.createElement('div');
    el.className = 'msg mine';
    el.innerHTML = '<div class="bubble"></div><div class="when">now</div>';
    $('.bubble', el).textContent = txt;
    msgs.appendChild(el);
    input.value = '';
    msgs.scrollTop = msgs.scrollHeight;
    return false;
  };
})();
