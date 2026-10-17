/* Image Studio loader
 * Loads studio.js. If anything goes wrong (old browser, error at startup, panel can't be seen) a red ⚠ button appears with the
 * reason and a Copy button, because a phone has no console. Kept in plain old-style JavaScript on purpose so it runs everywhere.
 */
(function () {
  'use strict';
  var errors = (window.__imageStudioErrors = window.__imageStudioErrors || []);
  var badge = null;

  function msg(e) {
    if (!e) return 'unknown error';
    if (typeof e === 'string') return e;
    return String(e.stack || e.message || e).split('\n').slice(0, 6).join('\n');
  }

  function diag() {
    var out = '';
    try { out = window.__imageStudioDiag ? window.__imageStudioDiag() : ''; } catch (e) { out = 'self-check failed: ' + e; }
    if (!out) out = 'Image Studio loader\nUA: ' + navigator.userAgent + '\nstudio.js did not finish loading.';
    if (errors.length && out.indexOf('Errors:') < 0) out += '\nErrors:\n' + errors.slice(-6).join('\n');
    return out;
  }

  function button(label, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font-size:16px;padding:12px 18px;margin:6px 8px 0 0;border-radius:10px;border:1px solid #888;background:#333;color:#fff';
    b.onclick = fn;
    return b;
  }

  function showOverlay() {
    var old = document.getElementById('is_err_overlay');
    if (old) old.parentNode.removeChild(old);
    var ov = document.createElement('div');
    ov.id = 'is_err_overlay';
    ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(10,10,14,.97);color:#eee;padding:14px;overflow:auto;font-family:sans-serif';
    var h = document.createElement('div');
    h.textContent = 'Image Studio hit a problem';
    h.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:8px';
    var pre = document.createElement('pre');
    var text = diag();
    pre.textContent = text;
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:12px;background:#1b1b22;padding:10px;border-radius:8px';
    var hint = document.createElement('div');
    hint.textContent = 'Tap Copy and send this text to whoever maintains the extension.';
    hint.style.cssText = 'font-size:13px;opacity:.75;margin:8px 0';
    ov.appendChild(h); ov.appendChild(hint); ov.appendChild(pre);
    ov.appendChild(button('Copy', function () {
      try { navigator.clipboard.writeText(text); } catch (e) {
        var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    }));
    ov.appendChild(button('Close', function () { ov.parentNode.removeChild(ov); }));
    document.body.appendChild(ov);
  }

  function showBadge() {
    if (badge || !document.body) {
      if (!document.body) document.addEventListener('DOMContentLoaded', showBadge);
      return;
    }
    badge = document.createElement('div');
    badge.id = 'is_err_badge';
    badge.textContent = '⚠';
    badge.title = 'Image Studio problem: tap for details';
    badge.style.cssText = 'position:fixed;left:14px;bottom:96px;z-index:2147483000;width:46px;height:46px;border-radius:50%;background:#b3261e;color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)';
    badge.onclick = showOverlay;
    document.body.appendChild(badge);
  }

  // studio.js reports here. critical = the panel can't be used, so show the badge.
  window.__imageStudioReport = function (where, err, critical) {
    errors.push(where + ': ' + msg(err));
    try { console.error('[Image Studio]', where, err); } catch (e) { /* ignore */ }
    if (critical) showBadge();
  };

  var mine = /image-studio|st-img-studio|studio\.js/i;
  window.addEventListener('error', function (ev) {
    if (mine.test(String(ev.filename || ''))) window.__imageStudioReport('error', ev.error || ev.message, true);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason, s = r && r.stack ? String(r.stack) : '';
    if (mine.test(s)) window.__imageStudioReport('promise', r, true);
  });

  try {
    import('./studio.js').catch(function (e) { window.__imageStudioReport('load', e, true); });
  } catch (e) {
    window.__imageStudioReport('load', e, true);
  }
})();
