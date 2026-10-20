/* Image Studio
 * Part 1 (below, plain old-style JavaScript): a small error reporter. If anything goes wrong (startup error, panel can't be seen)
 * a red ⚠ button appears with the reason and a Copy button, because a phone has no console.
 * Part 2: the extension itself.
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
    if (!out) out = 'Image Studio loader\nUA: ' + navigator.userAgent + '\nImage Studio did not finish starting.';
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

  // The extension code below reports here. critical = the panel can't be used, so show the badge.
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
})();

/* ---------------- Image Studio ---------------- */
try {
/* Image Studio – SillyTavern extension
 * Generates images from its own panel. Never posts anything to chat.
 * Providers: Nano Banana (Gemini API / proxy) and NovelAI 4.5 (via SillyTavern server proxy).
 */
(() => {
  const MODULE = 'image_studio';
  const VERSION = '3.0.0';
  const ctx = () => SillyTavern.getContext();
  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o))); // structuredClone isn't available on older phones
  const report = (where, e, critical) => { try { window.__imageStudioReport && window.__imageStudioReport(where, e, critical); } catch (x) { /* ignore */ } };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (type, msg) => { msg = tr(msg); try { window.toastr?.[type](msg, 'Image Studio'); } catch { console.log(msg); } inlineToast(type, msg); };
  // Top layer: a popover="manual" element is drawn above everything on the page whatever its z-index, and doesn't block the page behind it.
  const hasPopover = () => typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
  const inTop = el => { try { return !!el && el.matches(':popover-open'); } catch (x) { return false; } };
  function topShow(el) { if (!el || !hasPopover()) return; try { if (inTop(el)) el.hidePopover(); el.showPopover(); } catch (x) { /* unsupported or not connected */ } } // re-showing also moves it above anything shown since
  function topHide(el) { try { if (el && inTop(el)) el.hidePopover(); } catch (x) { /* ignore */ } }
  // SillyTavern's toasts are drawn below the top layer, so while the popup is open they are mirrored inside it.
  function inlineToast(type, msg) {
    const p = document.getElementById('is_panel'), el = document.getElementById('is_inline_toast');
    if (!p || !el || !inTop(p)) return;
    el.textContent = String(msg); el.className = 'is-itoast ' + type; el.style.display = '';
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  const DEFAULTS = {
    engine: 'sillyimages', api: 'gemini', fabPos: null, panelPos: null, extPaths: {}, slayStyle: '', slayStyleName: '', slayShare: false, profiles: {}, models: {}, aspectOverride: '', refSlots: [], useRefs: true, extraIds: [], useExtras: true, lang: 'auto',
    gemini: { endpoint: 'https://generativelanguage.googleapis.com', key: '', model: 'gemini-2.5-flash-image', aspect: '2:3', size: '1K' },
    novelai: { model: 'nai-diffusion-4-5-full', sampler: 'k_euler_ancestral', scheduler: 'karras', steps: 28, scale: 5, width: 832, height: 1216, seed: -1, decrisper: false, variety: false },
    prompt: '1girl, {style}, {quality}',
    negative: 'lowres, bad anatomy, text, watermark',
    vars: [
      { name: 'style', value: 'anime, soft shading', options: ['anime, soft shading', 'watercolor', 'photorealistic, 35mm'] },
      { name: 'quality', value: 'masterpiece, best quality', options: [] },
    ],
    opacity: 0.92, autosave: false, showButton: true, minimized: false, tab: 'create',
  };

  const fill = (t, d) => { for (const k in d) { if (t[k] === undefined) t[k] = clone(d[k]); else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) fill(t[k], d[k]); } return t; };
  const S = () => {
    const es = ctx().extensionSettings, o = es[MODULE] = es[MODULE] || {};
    if (o.provider !== undefined) { // migrate 1.x settings
      o.engine = o.provider === 'sillyimages' ? 'sillyimages' : 'standalone'; o.api = o.provider === 'novelai' ? 'novelai' : 'gemini';
      if (o.siProfile) o.profiles = { sillyimages: o.siProfile };
      if (o.siAspect !== undefined) o.aspectOverride = o.siAspect;
      delete o.provider; delete o.siProfile; delete o.siAspect;
    }
    if (o.poseId !== undefined) { if (o.poseId && !(o.extraIds || []).length) o.extraIds = [o.poseId]; delete o.poseId; } // 2.x pose slot -> reference pictures
    if (o.usePose !== undefined) { o.useExtras = o.usePose; delete o.usePose; }
    fill(o, DEFAULTS);
    if (Array.isArray(o.vars)) for (const v of o.vars) v.options = (Array.isArray(v.options) ? v.options : []).map(x => (typeof x === 'string' ? { name: x.length > 40 ? x.slice(0, 38) + '…' : x, value: x } : x));
    return o;
  };
  const save = () => ctx().saveSettingsDebounced();
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };

  const state = { last: null, busy: false, abort: null, libFilter: '', lbId: null, refKind: 'character', pickKind: 'character', varOpen: new Set(), lbEdit: null, lbItem: null, refs: [], refsLoaded: false, toSlot: false, refT: {}, modelCache: {}, modelTried: {}, modelOther: false };

  /* ---------- IndexedDB library ---------- */
  const DB = 'image_studio_lib', STORE = 'items';
  const openDB = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 2); r.onupgradeneeded = () => { for (const n of [STORE, 'refs']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const dbDo = async (mode, fn, store = STORE) => { const d = await openDB(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const rq = fn(t.objectStore(store)); t.oncomplete = () => res(rq?.result); t.onerror = () => rej(t.error); }); };
  const libAll = () => dbDo('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.ts - x.ts));
  const libPut = (it) => dbDo('readwrite', s => s.put(it));
  const libDel = (id) => dbDo('readwrite', s => s.delete(id));
  const makeThumb = (url, w = 360) => new Promise(res => {
    const i = new Image();
    i.onload = () => { const k = Math.min(1, w / i.width), c = document.createElement('canvas'); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/webp', 0.8)); };
    i.onerror = () => res(url); i.src = url;
  });


  /* ---------- Reference library (character refs) ---------- */
  const REFS = 'refs', MAX_REFS = 4;
  const REF_INSTR = 'The reference image(s) above show the exact appearance of the character(s). Copy their face, eye and hair color, hairstyle, skin tone, body type, clothing and distinctive features precisely.';
  const normalizeImg = (url, max = 1024) => new Promise(res => {
    const i = new Image();
    i.onload = () => { const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); };
    i.onerror = () => res(url); i.src = url;
  });
  const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  async function loadRefs() {
    state.refs = ((await dbDo('readonly', s => s.getAll(), REFS)) || []).sort((a, b) => b.ts - a.ts); state.refsLoaded = true;
    const fix = [];
    for (const r of state.refs) { if (r.kind === 'pose') { r.kind = 'ref'; r.role = 'pose'; fix.push(r); } else if (r.kind === 'ref' && !r.role) { r.role = 'whole'; fix.push(r); } } // 2.x poses are reference pictures with the "pose" purpose
    for (const r of fix) await putRef(r);
  }
  const putRef = r => dbDo('readwrite', s => s.put(r), REFS);
  const refLabel = r => { const auto = /^Reference \d+$/.test(r.name); return r.description ? (auto ? r.description : `${r.name}: ${r.description}`) : (auto ? '' : r.name); };
  async function addRef(dataUrl, name, kind = 'character', role = 'whole') {
    const image = await normalizeImg(dataUrl), n = state.refs.filter(r => (r.kind || 'character') === kind).length + 1;
    const rec = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), kind, name: name || (kind === 'ref' ? defaultName(role) : `Reference ${n}`), description: '', negative: '', mode: 'both', image, thumb: await makeThumb(image, 200) };
    if (kind === 'ref') rec.role = role;
    await putRef(rec); state.refs.unshift(rec); return rec;
  }
  async function addTextRef(kind = 'character', role = 'whole') {
    const n = state.refs.filter(r => (r.kind || 'character') === kind).length + 1;
    const rec = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), kind, name: kind === 'ref' ? defaultName(role) : `Reference ${n}`, description: '', negative: '', mode: 'text', image: '', thumb: '' };
    if (kind === 'ref') rec.role = role;
    await putRef(rec); state.refs.unshift(rec); return rec;
  }
  const thumbHtml = (r, cls = '') => r.thumb ? `<img class="${cls}" src="${r.thumb}" alt="">` : `<div class="is-noimg ${cls}">T</div>`;
  const modeSelect = (r) => { const m = modeOf(r), d = r.image ? '' : ' disabled'; return `<select data-act="ref-mode"${d}><option value="both"${m === 'both' ? ' selected' : ''}>Image + text</option><option value="image"${m === 'image' ? ' selected' : ''}>Image only</option><option value="text"${m === 'text' ? ' selected' : ''}>Text only</option></select>`; };
  function slotAdd(id) {
    const s = S(); if (s.refSlots.includes(id)) return true;
    if (s.refSlots.length >= MAX_REFS) { toast('warning', `Up to ${MAX_REFS} references per image.`); return false; }
    s.refSlots.push(id); save(); renderSlots(); return true;
  }
  // ---- reference pictures: any picture with a purpose (pose, style, composition, outfit, background, whole picture)
  const MAX_EXTRA = 3;
  const ROLES = {
    pose: { base: 'pose', inline: n => `the pose from reference image "${n}"`, label: "pose reference only — copy the body pose, limb placement and camera angle; ignore this image's person, face, clothing and background", instr: 'The pose reference shows ONLY the desired pose: copy its body position, limb placement, head angle and camera angle; do not copy its person, face, hair, clothing or background.' },
    style: { base: 'artstyle', inline: n => `the art style of reference image "${n}"`, label: 'style reference only — copy the art style, color palette, lighting and rendering; ignore its subjects and content', instr: 'The style reference shows ONLY the desired look: copy its art style, color palette, lighting and rendering technique; do not copy its subjects, objects or layout.' },
    scene: { base: 'layout', inline: n => `the composition and framing of reference image "${n}"`, label: "composition reference only — copy the layout, framing, camera angle and perspective; ignore its subjects' identity, colors and style", instr: "The composition reference shows ONLY the desired layout: copy its framing, camera angle, perspective and arrangement of elements; do not copy the identity, colors or style of what it shows." },
    outfit: { base: 'outfit', inline: n => `the outfit from reference image "${n}"`, label: 'outfit reference only — copy the clothing and accessories; ignore the person, pose and background', instr: 'The outfit reference shows ONLY the desired clothing: copy the garments and accessories; do not copy the person, face, pose or background.' },
    background: { base: 'bg', inline: n => `the background from reference image "${n}"`, label: 'background reference only — copy the setting and background; ignore any people or foreground', instr: 'The background reference shows ONLY the desired setting: copy the environment and background; do not copy any people or foreground subjects.' },
    whole: { base: 'like', inline: n => `reference image "${n}" (recreate its overall composition, pose, mood and style)`, label: "overall reference — recreate this picture's composition, pose, style and mood, but replace its subjects with the characters described in the prompt", instr: "The overall reference shows the picture to recreate: match its composition, pose, camera angle, lighting, style and mood, but replace its subjects with the characters described in the prompt, keeping their own appearance." },
  };
  const ROLE_ORDER = ['pose', 'style', 'scene', 'outfit', 'background', 'whole'];
  const tagify = n => String(n || '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '');
  const defaultName = (role) => { const base = (ROLES[role] || ROLES.whole).base, have = new Set(state.refs.filter(r => r.kind === 'ref').map(r => String(r.name).toLowerCase())); let i = 1, nm = base; while (have.has(nm.toLowerCase())) nm = base + (++i); return nm; };
  const looksAutoName = n => /^(ref|pose|artstyle|layout|outfit|bg|like)\d*$/i.test(String(n || '').trim());
  function extraItems() { // every reference picture in the slots (ignores the Send checkbox)
    const s = S(), seen = new Set();
    return s.extraIds.map(id => state.refs.find(r => r.id === id)).filter(Boolean).map(r => {
      const role = ROLES[r.role] ? r.role : 'whole', mode = modeOf(r), t0 = tagify(r.name) || ROLES[role].base; let tag = t0, k = 2;
      while (seen.has(tag.toLowerCase())) tag = t0 + (k++); seen.add(tag.toLowerCase());
      return { r, role, mode, name: String(r.name || '').trim() || tag, tag, txt: String(r.description || '').replace(/\s+/g, ' ').trim(), neg: String(r.negative || '').trim(), hasImg: mode !== 'text' && !!r.image };
    });
  }
  const extrasNow = () => (S().useExtras ? extraItems() : []);
  const wantsImages = () => (S().useRefs && chars().some(c => c.mode !== 'text')) || extrasNow().some(x => x.hasImg);
  function extraAdd(id) {
    const s = S(); if (s.extraIds.includes(id)) return true;
    if (s.extraIds.length >= MAX_EXTRA) { toast('warning', `Up to ${MAX_EXTRA} reference pictures per image.`); return false; }
    s.extraIds.push(id); save(); renderExtras(); renderChips(); renderPreview(); return true;
  }
  // {tag} in the prompt -> a phrase that points at that reference picture
  const fillRefTags = (text, xs, fn) => { const used = new Set(); const out = replaceTags(text, (m, n) => { const x = xs.find(y => y.tag.toLowerCase() === n.toLowerCase()); if (!x) return m; used.add(x.tag); return fn(x); }); return { out, used }; };
  const inlinePhrase = (x, fam) => (fam !== 'text' ? (x.mode === 'image' ? '' : x.txt) : x.hasImg ? ROLES[x.role].inline(x.name) + (x.mode !== 'image' && x.txt ? ` (${x.txt})` : '') : x.txt);
  async function buildRefs(fmt, max) {
    if (!state.refsLoaded) await loadRefs();
    const list = S().useRefs ? chars().filter(c => c.mode !== 'text') : [], cap = Math.min(max, MAX_REFS + MAX_EXTRA), used = list.slice(0, cap);
    if (list.length > used.length) toast('warning', `This model takes ${used.length} reference image(s); using the first ${used.length}.`);
    const out = used.map(c => ({ image: fmt === 'dataUrl' ? c.r.image : c.r.image.split(',')[1], description: c.name, source: 'image-studio' }));
    out.names = used.map(c => c.name);
    for (const x of extrasNow().filter(y => y.hasImg)) {
      if (out.length >= cap) { toast('warning', `This model takes ${cap} reference image(s); “${x.name}” was skipped${x.txt ? ' (its text is still used)' : ''}.`); continue; }
      out.push({ image: fmt === 'dataUrl' ? x.r.image : x.r.image.split(',')[1], description: `"${x.name}": ${ROLES[x.role].label}`, source: 'image-studio', extra: true, role: x.role, refName: x.name });
      out.names.push('');
    }
    return out;
  }
  const isAuto = n => !String(n || '').trim() || /^Reference \d+$/.test(String(n).trim());
  const nameRe = n => new RegExp('(^|[^\\p{L}\\p{N}_])' + n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'iu');
  const mentioned = (text, name) => nameRe(name).test(text || '');
  const modeOf = r => (r.image ? (r.mode || 'both') : 'text'); // 'both' | 'image' | 'text'
  const chars = () => S().refSlots.map(id => state.refs.find(r => r.id === id)).filter(Boolean).map(r => ({ r, mode: modeOf(r), name: isAuto(r.name) ? '' : r.name.trim() }));
  // Inline: "personA kissing personB" -> "personA (red hair…) kissing personB (blue hair…)" (first mention only)
  function expandChars(prompt, list) {
    let out = prompt;
    for (const c of list) {
      if (c.mode === 'image' || !c.name) continue;
      const txt = String(c.r.description || '').replace(/\s+/g, ' ').trim();
      if (txt && mentioned(out, c.name)) out = out.replace(nameRe(c.name), (m, pre) => `${pre}${c.name} (${txt})`);
    }
    return out;
  }
  // How text references are delivered depends on the model family:
  //  'nai-chars' NovelAI V4/4.5 via sillyimages: "base | char1 | char2" (its character prompts), negatives aligned the same way
  //  'nai-flat'  NovelAI via SillyTavern's own endpoint (no character prompts): descriptions appended as tags
  //  'text'      Gemini / OpenAI-style / Naistera / SLAY: inline name (text) plus an explicit "Characters" block
  function family() {
    const s = S();
    if (s.engine === 'standalone') return s.api === 'novelai' ? 'nai-flat' : 'text';
    const ext = extCache[s.engine]; if (!ext || ext.kind === 'slay' || !ext.set) return 'text';
    const prof = (ext.set.getSettings().connectionProfiles || []).find(p => p.id === s.profiles[ext.id]);
    return prof?.apiType === 'novelai' ? 'nai-chars' : 'text';
  }
  function buildFinal() {
    const s = S(), list = s.useRefs ? chars() : [], fam = family(), xs = extrasNow();
    const { out: base0, used } = fillRefTags(resolve(s.prompt), xs, x => inlinePhrase(x, fam));
    const unused = xs.filter(x => !used.has(x.tag));
    const xTxt = unused.filter(x => x.mode !== 'image' && x.txt);
    const baseNeg = [resolve(s.negative), ...xs.filter(x => x.mode !== 'image' && x.neg).map(x => x.neg)].filter(Boolean).join(', ');
    const tx = list.filter(c => c.mode !== 'image').map(c => ({ c, txt: String(c.r.description || '').replace(/\s+/g, ' ').trim(), neg: String(c.r.negative || '').trim() })).filter(x => x.txt || x.neg);
    const withTxt = tx.filter(x => x.txt);
    const base = fam === 'text' ? base0 : [base0, ...xTxt.map(x => x.txt)].filter(Boolean).join(', '); // NovelAI: reference text goes in as tags
    let prompt = base, neg = baseNeg;
    if (fam === 'nai-chars') {
      prompt = [base, ...withTxt.map(x => x.txt)].join(' | ');
      const loose = tx.filter(x => !x.txt && x.neg).map(x => x.neg);
      const nb = [baseNeg, ...loose].filter(Boolean).join(', ');
      neg = withTxt.some(x => x.neg) ? [nb, ...withTxt.map(x => x.neg)].join(' | ') : nb;
    } else if (fam === 'nai-flat') {
      prompt = [base, ...withTxt.map(x => x.txt)].filter(Boolean).join(', ');
      neg = [baseNeg, ...tx.map(x => x.neg)].filter(Boolean).join(', ');
    } else {
      prompt = expandChars(base, list);
      if (withTxt.length) prompt += `${prompt ? '\n\n' : ''}Characters (draw each exactly as described):\n${withTxt.map(x => `- ${x.c.name ? x.c.name + ': ' : ''}${x.txt}`).join('\n')}`;
      const lines = unused.map(x => x.hasImg ? `- Use ${ROLES[x.role].inline(x.name)}${x.mode !== 'image' && x.txt ? ` (${x.txt})` : ''}.` : (x.txt ? `- ${x.txt}` : '')).filter(Boolean);
      if (lines.length) prompt += `${prompt ? '\n\n' : ''}Reference pictures:\n${lines.join('\n')}`;
      neg = [baseNeg, ...tx.map(x => x.neg)].filter(Boolean).join(', ');
    }
    return { base: base0, list, fam, prompt, neg, extras: xs };
  }
  function finalText(f, withImages) {
    const sty = S().engine === 'slayimages' ? slayStyleNow() : '', imgs = f.list.filter(c => c.mode !== 'text'), xi = f.extras.filter(x => x.hasImg);
    const fmt = f.fam === 'nai-chars' ? 'Format: NovelAI character prompts  (base | character | character)\n\n' : '';
    return fmt + (sty ? `[STYLE: ${sty}]\n\n` : '') + f.prompt + (f.neg ? `\n\n— Negative —\n${f.neg}` : '')
      + (withImages && (imgs.length || xi.length) ? `\n\n— Reference images —\n${[...imgs.map((c, i) => `${i + 1}. ${c.name || '(unnamed)'}`), ...xi.map((x, i) => `${imgs.length + i + 1}. [${x.role}] ${x.name}`)].join('\n')}` : '');
  }
  const refInstr = refs => {
    const hasChar = refs.some(r => !r.extra), roles = [...new Set(refs.filter(r => r.extra).map(r => r.role))];
    const c = hasChar ? (roles.length ? REF_INSTR.replace('The reference image(s) above show', 'The character reference image(s) above show') : REF_INSTR) : '';
    return [c, ...roles.map(r => ROLES[r].instr)].filter(Boolean).join(' ');
  };
  const slotRefs = () => S().refSlots.map(id => state.refs.find(r => r.id === id)).filter(Boolean);
  const refBlock = refs => {
    const out = [], parts = (refs.names || []).map((n, i) => n ? `image ${i + 1} is ${n}` : '').filter(Boolean);
    if (parts.length) out.push(`Characters in the reference images: ${parts.join('; ')}. Wherever the prompt mentions one of these names, draw that character exactly as shown in their reference image.`);
    refs.forEach((r, i) => { if (r.extra) out.push(`Image ${i + 1} is "${r.refName}" — ${ROLES[r.role].label}.`); });
    return out.join('\n');
  };

  const tagInPrompt = (text, tag) => { let hit = false; replaceTags(text, (m, n) => { if (n.toLowerCase() === tag.toLowerCase()) hit = true; return m; }); return hit; };
  function renderChips() {
    const el = $('#is_chips'); if (!el) return;
    const s = S(), names = slotRefs().map(r => r.name.trim()).filter(n => !isAuto(n)), xs = extraItems();
    const chips = names.map(n => `<button class="is-chip ${mentioned(s.prompt, n) ? 'used' : ''}" data-act="chip" data-name="${esc(n)}">${esc(n)}</button>`)
      .concat(xs.map(x => `<button class="is-chip ${tagInPrompt(s.prompt, x.tag) ? 'used' : ''}" data-act="chip" data-name="{${esc(x.tag)}}">{${esc(x.tag)}}</button>`));
    el.innerHTML = chips.length ? '<span class="is-hint" style="margin:0">Tap to insert:</span>' + chips.join('') : '';
  }
  function renderSlots() {
    const el = $('#is_slots'); if (!el) return;
    const s = S(); let img = 0;
    if (state.refsLoaded) s.refSlots = s.refSlots.filter(id => state.refs.some(r => r.id === id));
    el.innerHTML = s.refSlots.map((id, i) => {
      const r = state.refs.find(x => x.id === id); if (!r) return '';
      const m = modeOf(r), tag = m === 'text' ? 'text only' : `IMAGE_${++img}`;
      return `<div class="is-slotrow" data-i="${i}" data-rid="${r.id}">${thumbHtml(r, m === 'text' ? 'dim' : '')}<div class="is-slotf">
        <div class="is-row"><input type="text" data-act="slot-name" value="${isAuto(r.name) ? '' : esc(r.name)}" placeholder="Name, e.g. personA"><button class="is-ib" data-act="slot-rm" title="Remove">✕</button></div>
        ${modeSelect(r)}<span class="is-tag">${tag}</span>
        <details class="is-slotd"><summary>Text prompt &amp; negative</summary>
        <textarea data-act="ref-desc" placeholder="Prompt for this character (looks, outfit…)">${esc(r.description || '')}</textarea>
        <textarea data-act="ref-neg" placeholder="Negative for this character">${esc(r.negative || '')}</textarea></details></div></div>`;
    }).join('') + (s.refSlots.length < MAX_REFS ? '<button class="is-btn full" style="margin-top:6px" data-act="slot-add">＋ Add character reference</button>' : '');
    $('#is_refcount').textContent = `${s.refSlots.length}/${MAX_REFS}`;
    renderChips(); renderExtras(); renderPreview();
  }
  const ROLE_NAMES = { pose: 'Pose', style: 'Art style', scene: 'Composition', outfit: 'Outfit', background: 'Background', whole: 'Whole picture (recreate it)' };
  const roleSelect = (r) => `<select data-act="ref-role">${ROLE_ORDER.map(k => `<option value="${k}"${(r.role || 'whole') === k ? ' selected' : ''}>${ROLE_NAMES[k]}</option>`).join('')}</select>`;
  function renderExtras() {
    const el = $('#is_extras'); if (!el) return;
    const s = S(); if (state.refsLoaded) { const keep = s.extraIds.filter(id => state.refs.some(r => r.id === id)); if (keep.length !== s.extraIds.length) { s.extraIds = keep; save(); } }
    const items = extraItems();
    $('#is_extracount').textContent = `${items.length}/${MAX_EXTRA}`;
    el.innerHTML = items.map((x, i) => `<div class="is-slotrow" data-rid="${x.r.id}" data-i="${i}">${thumbHtml(x.r, x.mode === 'text' ? 'dim' : '')}<div class="is-slotf">
        <div class="is-row"><input type="text" data-act="ref-name" value="${esc(x.r.name)}" placeholder="Tag name, e.g. pose1"><button class="is-ib" data-act="extra-rm" title="Remove">✕</button></div>
        ${roleSelect(x.r)}${modeSelect(x.r)}<span class="is-tag">{${esc(x.tag)}}</span>
        <details class="is-slotd" ${x.txt || x.neg ? 'open' : ''}><summary>Text &amp; negative</summary>
        <textarea data-act="ref-desc" placeholder="In words (optional): e.g. sitting cross-legged, looking over her shoulder">${esc(x.r.description || '')}</textarea>
        <textarea data-act="ref-neg" placeholder="Negative for this reference (e.g. crossed arms)">${esc(x.r.negative || '')}</textarea></details></div></div>`).join('')
      + (items.length < MAX_EXTRA ? '<button class="is-btn full" style="margin-top:6px" data-act="extra-add">＋ Add reference picture</button>' : '');
  }
  function renderRefs() {
    const el = $('#is_refs'); if (!el) return;
    const kind = state.refKind, isRef = kind === 'ref';
    $$('[data-act="ref-kind"]').forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
    const up = $('[data-act="ref-upload"]'), nw = $('[data-act="ref-text-new"]');
    if (up) up.textContent = isRef ? 'Upload reference pictures' : 'Upload images'; if (nw) nw.textContent = isRef ? '＋ New text-only reference' : '＋ New text-only character';
    const list = state.refs.filter(r => (r.kind || 'character') === kind);
    el.innerHTML = list.length ? list.map(r => `<div class="is-ref" data-id="${r.id}" data-rid="${r.id}">${thumbHtml(r)}
      <div class="is-ref-f"><input type="text" data-act="ref-name" value="${esc(r.name)}" placeholder="${isRef ? 'Tag name, e.g. pose1' : 'Name used in prompts, e.g. personA'}">
      ${isRef ? roleSelect(r) : ''}${modeSelect(r)}
      <textarea data-act="ref-desc" placeholder="${isRef ? 'In words (optional): what to take from it' : 'Text prompt for this character (looks, outfit, tags…)'}">${esc(r.description || '')}</textarea>
      <textarea data-act="ref-neg" placeholder="${isRef ? 'Negative for this reference' : 'Negative for this character'}">${esc(r.negative || '')}</textarea>
      <div class="is-row"><button class="is-btn full" data-act="ref-slot">${isRef ? 'Use as reference' : 'Use in prompt'}</button><button class="is-btn" data-act="ref-del" title="Delete">🗑</button></div></div></div>`).join('')
      : `<div class="is-empty">${isRef ? 'No reference pictures yet. Upload any picture (a pose, a style, a scene…), or add a text-only reference.' : 'No references yet. Upload a character image, or add a text-only character.'}</div>`;
  }
  function openPicker(kind = 'character') {
    const s = S(); state.pickKind = kind;
    const free = state.refs.filter(r => (r.kind || 'character') === kind && !(kind === 'ref' ? s.extraIds : s.refSlots).includes(r.id));
    $('#is_lb').innerHTML = `<div class="is-hint">${kind === 'ref' ? `Choose a reference picture (${s.extraIds.length}/${MAX_EXTRA} in use)` : `Choose a character reference (${s.refSlots.length}/${MAX_REFS} in use)`}</div>`
      + (free.length ? `<div class="is-pickgrid">${free.map(r => `<div class="is-pickitem" data-pick="${r.id}">${thumbHtml(r)}<div>${esc(r.name)}</div></div>`).join('')}</div>` : `<div class="is-empty">${kind === 'ref' ? 'No saved reference pictures yet. Upload one.' : 'No unused references. Upload a new one.'}</div>`)
      + '<div class="is-row"><button class="is-btn pri full" data-act="pick-upload">Upload new</button><button class="is-btn full" data-act="lb-close">Cancel</button></div>';
    $('#is_lb').classList.add('on');
  }
  async function handleFiles(inp) {
    const files = [...inp.files]; inp.value = ''; let n = 0; const kind = state.toSlot ? state.pickKind : state.refKind;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try { const rec = await addRef(await readFile(f), kind === 'ref' ? '' : f.name.replace(/\.[^.]+$/, '').slice(0, 40), kind); n++; if (state.toSlot) { if (kind === 'ref') extraAdd(rec.id); else slotAdd(rec.id); } } catch (e) { toast('error', `Could not read ${f.name}`); }
    }
    state.toSlot = false; $('#is_lb').classList.remove('on'); renderRefs(); renderSlots(); if (n) toast('success', `Added ${n} reference(s).`);
  }
  async function imageToExtra(url) { const rec = await addRef(url, '', 'ref', 'whole'); extraAdd(rec.id); renderRefs(); toast('success', 'Added as a reference picture. Choose what to take from it.'); }
  async function imageToRef(url) { const rec = await addRef(url, 'Generated'); const ok = S().refSlots.length < MAX_REFS && slotAdd(rec.id); renderRefs(); toast('success', ok ? 'Added as reference (IMAGE slot).' : 'Added to references.'); }

  /* ---------- Prompt variables ---------- */
  // {tag} that is not part of a {{macro}}. Written without regex lookbehind, which older iPhones can't parse (it would stop the whole extension loading).
  const replaceTags = (text, fn) => String(text || '').replace(/\{([\p{L}\p{N}_-]+)\}/gu, (m, n, off, str) => (str[off - 1] === '{' || str[off + m.length] === '}') ? m : fn(m, n));
  function syncVars() {
    const s = S(); const found = new Set();
    const rtags = new Set(extraItems().map(x => x.tag.toLowerCase()));
    for (const t of [s.prompt, s.negative]) replaceTags(t, (m, n) => { if (!rtags.has(n.toLowerCase())) found.add(n); return m; });
    if (state.refsLoaded) for (const n of found) if (!s.vars.some(v => v.name.toLowerCase() === n.toLowerCase())) s.vars.push({ name: n, value: '', options: [] }); // wait until reference tags are known
    return found;
  }
  function resolve(text) {
    const s = S();
    let out = replaceTags(text, (m, n) => { const v = s.vars.find(x => x.name.toLowerCase() === n.toLowerCase()); return v ? v.value.trim() : m; });
    out = out.replace(/(\s*,\s*){2,}/g, ', ').replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
    try { out = ctx().substituteParams(out); } catch { /* ignore */ }
    return out;
  }

  /* ---------- Providers ---------- */
  async function genGemini(prompt, neg, signal) {
    const g = S().gemini;
    if (!g.key) throw new Error('Add your Gemini / proxy API key in Setup.');
    const base = g.endpoint.trim().replace(/\/+$/, '').replace(/\/v1(beta)?(\/.*)?$/, '');
    let text = neg ? `${prompt}\n\nAvoid: ${neg}` : prompt;
    const refs = wantsImages() ? await buildRefs('base64', /2\.5/.test(g.model) ? 3 : MAX_REFS + 1) : [];
    const rb = refBlock(refs); if (rb) text += '\n\n' + rb;
    const parts = [];
    refs.forEach((r, i) => { if (r.description) parts.push({ text: `IMAGE_${i + 1}: ${r.description}` }); parts.push({ inlineData: { mimeType: 'image/png', data: r.image } }); });
    { const ri = refInstr(refs); if (ri) parts.push({ text: ri }); }
    parts.push({ text });
    const imageConfig = { aspectRatio: g.aspect };
    if (/pro|gemini-3/i.test(g.model) && g.size) imageConfig.imageSize = g.size;
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': g.key };
    if (!/googleapis\.com/.test(base)) headers.Authorization = `Bearer ${g.key}`;
    const r = await fetch(`${base}/v1beta/models/${encodeURIComponent(g.model)}:generateContent`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig } }),
    });
    const raw = await r.text();
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${raw.slice(0, 300)}`);
    let j; try { j = JSON.parse(raw); } catch { throw new Error('Bad response: ' + raw.slice(0, 200)); }
    for (const p of j?.candidates?.[0]?.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
    }
    throw new Error('No image returned (' + (j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason || 'unknown reason') + ').');
  }

  async function genNovelAI(prompt, neg, signal) {
    const n = S().novelai;
    const seed = Number(n.seed) >= 0 ? Number(n.seed) : Math.floor(Math.random() * 9999999999);
    const r = await fetch('/api/novelai/generate-image', {
      method: 'POST', headers: ctx().getRequestHeaders(), signal,
      body: JSON.stringify({
        prompt, negative_prompt: neg, model: n.model, sampler: n.sampler, scheduler: n.scheduler,
        steps: Number(n.steps), scale: Number(n.scale), width: Number(n.width), height: Number(n.height),
        seed, upscale_ratio: 1, decrisper: !!n.decrisper, variety_boost: !!n.variety,
      }),
    });
    const raw = (await r.text()).trim().replace(/^"|"$/g, '');
    if (!r.ok) throw new Error(`NovelAI ${r.status}: ${raw.slice(0, 300)} (is your NovelAI key set under API Connections?)`);
    return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
  }

  async function generate() {
    const s = S();
    if (state.busy) { state.abort?.abort(); return; }
    syncVars();
    if (!state.refsLoaded) await loadRefs();
    if (s.engine !== 'standalone') await loadExt(s.engine);
    const fin = buildFinal(), { base, prompt, neg, list } = fin;
    if (!base) return toast('warning', 'Main prompt is empty.');
    const imgs = list.filter(c => c.mode !== 'text');
    { const miss = imgs.map(c => c.name).filter(n => n && !mentioned(base, n)); if (miss.length) toast('info', `${miss.join(', ')} not in the prompt — the model may ignore ${miss.length > 1 ? 'those references' : 'that reference'}.`); }
    if (s.engine === 'standalone' && s.api === 'novelai' && (imgs.length || fin.extras.some(x => x.hasImg))) toast('info', 'NovelAI can’t take reference images; text references are still applied.');
    state.busy = true; state.abort = new AbortController(); renderResult();
    try {
      const sig = state.abort.signal;
      const url = s.engine !== 'standalone' ? await genExt(prompt, neg, sig) : s.api === 'novelai' ? await genNovelAI(prompt, neg, sig) : await genGemini(prompt, neg, sig);
      state.last = { url, prompt, neg, saved: false, sent: finalText(fin, true) };
      if (s.autosave) await saveLast(true);
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('error', e.message || String(e)); }
    } finally { state.busy = false; state.abort = null; renderResult(); }
  }

  async function saveLast(quiet) {
    const l = state.last; if (!l || l.saved) return;
    const s = S();
    const vars = {}; s.vars.forEach(v => vars[v.name] = v.value);
    await libPut({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), title: '',
      image: l.url, thumb: await makeThumb(l.url), template: s.prompt, negative: s.negative, vars,
      resolved: l.prompt, resolvedNeg: l.neg, refIds: s.useRefs ? [...s.refSlots] : [], extraIds: s.useExtras ? [...s.extraIds] : [], engine: s.engine, api: s.api, profile: s.profiles[s.engine] || '', modelRaw: rawModel(),
      model: modelLabel(),
    });
    l.saved = true; renderResult(); if (!quiet) toast('success', 'Saved to library.');
    if (S().tab === 'library') renderLibrary();
  }


  /* ---------- Generator extensions (engine) → connection profile → model ---------- */
  const EXTS = {
    sillyimages: { label: 'sillyimages', kind: 'module', match: m => /sillyimages/i.test(m.homePage || '') || m.display_name === 'Inline Image Generation' },
    slayimages: { label: 'SLAY Images', kind: 'slay', settingsKey: 'slay_image_gen', match: m => /slayimages/i.test(m.homePage || '') || /SLAY Images/i.test(m.display_name || '') },
  };
  const SLAY_NAISTERA_MODELS = [['grok', 'Grok'], ['nano banana', 'Nano Banana'], ['grok-pro', 'Grok Pro'], ['novelai', 'NovelAI']];
  const GEMINI_MODELS = [['gemini-2.5-flash-image', 'Nano Banana (2.5 Flash Image)'], ['gemini-3-pro-image-preview', 'Nano Banana Pro (3 Pro Image)'], ['gemini-3.1-flash-image-preview', 'Nano Banana 2 (3.1 Flash Image)']];
  const NAISTERA_MODELS = [['nano banana', 'Nano Banana'], ['nano banana pro', 'Nano Banana Pro'], ['nano banana 2', 'Nano Banana 2'], ['grok', 'Grok']];
  const NAI_MODELS = [['nai-diffusion-4-5-full', 'NovelAI V4.5 Full'], ['nai-diffusion-4-5-curated', 'NovelAI V4.5 Curated'], ['nai-diffusion-4-full', 'NovelAI V4 Full']];
  const extCache = {}; let discovered;
  const extLoading = {}; let discoverP;
  const NAME_HINT = { sillyimages: /silly.?images|inline.?image|iig/i, slayimages: /slay/i };
  async function fetchJson(url, ms = 4000) {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(tm); }
  }
  async function buildExt(id, name) {
    const base = `/scripts/extensions/${name}`;
    if (EXTS[id].kind === 'slay') return { id, kind: 'slay', name, getSettings: () => (ctx().extensionSettings[EXTS[id].settingsKey] = ctx().extensionSettings[EXTS[id].settingsKey] || {}) };
    const [prov, set] = await Promise.all([import(/* @vite-ignore */ `${base}/src/providers.js`), import(/* @vite-ignore */ `${base}/src/settings.js`)]);
    let nai = null; try { nai = await import(/* @vite-ignore */ `${base}/src/novelai.js`); } catch { /* optional */ }
    return prov.resolveActiveProvider && set.getSettings ? { id, prov, set, nai, name } : null;
  }
  // undefined = not looked up yet, null = looked up and not installed. Concurrent callers share one lookup.
  // quick = background lookup for an engine nobody selected: only the remembered folder / likely folder names, never a full scan
  function loadExt(id, force = false, quick = false) {
    if (force) { delete extCache[id]; delete extLoading[id]; discoverP = null; }
    if (extCache[id] !== undefined) return Promise.resolve(extCache[id]);
    if (extLoading[id]) return extLoading[id].quick && !quick ? extLoading[id].then(() => (extCache[id] !== undefined ? extCache[id] : loadExt(id))) : extLoading[id];
    const pr = (extLoading[id] = (async () => {
      let found = null, failed = false; const tried = new Set();
      const tryName = async (name) => {
        if (!name || tried.has(name)) return null; tried.add(name);
        try { const m = await fetchJson(`/scripts/extensions/${name}/manifest.json`); return EXTS[id].match(m) ? await buildExt(id, name) : null; } catch { return null; }
      };
      try {
        found = await tryName(S().extPaths[id]);                                   // 1. folder remembered from last time
        if (!found) {
          discoverP = discoverP || fetchJson('/api/extensions/discover', 8000);
          const list = (await discoverP).filter(e => e?.name && e.type !== 'system').map(e => e.name);
          for (const n of list.filter(n => NAME_HINT[id].test(n))) { found = await tryName(n); if (found) break; }   // 2. folders named like it
          for (let i = 0, rest = quick ? [] : list.filter(n => !tried.has(n)); !found && i < rest.length; i += 6) found = (await Promise.all(rest.slice(i, i + 6).map(tryName))).find(Boolean) || null; // 3. the rest, 6 at a time
        }
        if (found && S().extPaths[id] !== found.name) { S().extPaths[id] = found.name; save(); }
      } catch (e) { failed = true; discoverP = null; console.warn('[Image Studio] extension lookup failed', id, e); }
      if (!failed && (found || !quick)) extCache[id] = found;   // failed or partial lookups aren't remembered, so a real selection looks again
      delete extLoading[id];
      return found;
    })());
    pr.quick = quick; return pr;
  }
  const loadSI = (force) => loadExt('sillyimages', force);
  const mkey = () => { const s = S(); return `${s.engine}:${s.profiles[s.engine] || ''}`; };
  const getProfile = (ext, st) => (st.connectionProfiles || []).find(p => p.id === S().profiles[ext.id]);

  // Runs fn on a PRIVATE COPY of the generator extension's settings (chosen profile's connection + Studio's own model).
  // The extension's real settings object is never modified. While the copy is in place, anything SillyTavern saves still
  // serialises the original values (toJSON), so the main extension's model/connection can't be changed or persisted by the Studio.
  // Calls are queued one at a time so copies can never overlap.
  let isoQueue = Promise.resolve();
  function withIsolated(ext, modelOverride, fn) {
    const run = isoQueue.then(async () => {
      const es = ctx().extensionSettings, orig = ext.set.getSettings();
      const key = Object.keys(es).find(k => es[k] === orig);
      if (!key) throw new Error('Could not locate the extension settings.');
      const copy = clone(orig), profile = getProfile(ext, orig);
      if (profile) for (const k of ext.set.CONNECTION_FIELDS) if (k in profile) copy[k] = clone(profile[k]);
      const m = String(modelOverride ?? S().models[mkey()] ?? '').trim();
      if (m) { if (copy.apiType === 'naistera') copy.naisteraModel = m; else copy.model = m; }
      Object.defineProperty(copy, 'toJSON', { value: () => orig, enumerable: false });
      es[key] = copy;
      try { return await fn(copy); } finally { es[key] = orig; }
    });
    isoQueue = run.catch(() => {});
    return run;
  }

  async function genExt(prompt, neg, signal) {
    const s = S(), ext = await loadExt(s.engine);
    if (!ext) throw new Error(`${EXTS[s.engine]?.label || 'Generator extension'} not found. Install it or switch to Standalone.`);
    if (ext.kind === 'slay') return genSlay(prompt, neg, signal);
    const pick = String(s.models[mkey()] || '').trim();
    return withIsolated(ext, undefined, async (st) => {
      const provider = ext.prov.resolveActiveProvider(st);
      if (!provider) throw new Error(`Unknown API type in profile: ${st.apiType}`);
      const errs = provider.validate(st);
      if (errs.length) throw new Error(errs.join('; '));
      let text = neg && !provider.supportsNegativePrompt(st) ? `${prompt}\n\nAvoid: ${neg}` : prompt;
      let references = [];
      if (wantsImages()) {
        const max = Math.min(MAX_REFS + 1, ext.prov.getActiveProviderMaxReferences?.(st) || 0);
        if (max > 0 && provider.supportsReferences(st)) references = await buildRefs(provider.capabilities?.referencesFormat === 'dataUrl' ? 'dataUrl' : 'base64', max);
        else toast('info', 'This model does not accept reference images, so they were skipped.');
      }
      const rb = refBlock(references); if (rb) text += '\n\n' + rb;
      const options = { signal, negativePrompt: neg, matchedAdditionalRefs: [], characterDescriptionPromptBlock: '' };
      if (s.aspectOverride) options.aspectRatio = s.aspectOverride;
      if (pick) options.model = pick; // providers that take a per-call model use it directly
      const out = await provider.generate({ prompt: text, style: '', references, options });
      if (typeof out !== 'string') throw new Error('Provider returned a video/non-image result.');
      return out;
    });
  }


  /* ---------- SLAY Images: connection from its settings, generation done here (it exposes no API) ---------- */
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const slayAspects = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  function xfetch(url, o = {}) {
    if (!IS_IOS) return fetch(url, o);
    return new Promise((res, rej) => { // iOS Safari: XHR is more reliable for long image requests (same trick SLAY uses)
      const x = new XMLHttpRequest(); x.open(o.method || 'GET', url); x.timeout = 180000; x.responseType = 'text';
      for (const [k, v] of Object.entries(o.headers || {})) x.setRequestHeader(k, v);
      o.signal?.addEventListener('abort', () => x.abort());
      x.onload = () => res({ ok: x.status >= 200 && x.status < 300, status: x.status, text: async () => x.responseText, json: async () => JSON.parse(x.responseText) });
      x.ontimeout = () => rej(new Error('Request timed out')); x.onerror = () => rej(new Error('Network error')); x.onabort = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      x.send(o.body || null);
    });
  }
  const cleanKey = k => String(k || '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
  const trimEp = e => String(e || '').trim().replace(/\/+$/, '').replace(/\/v1(beta)?$/i, '').replace(/\/+$/, '');
  const slayNaisteraModel = m => { const r = String(m || '').trim().toLowerCase(); if (!r) return 'grok'; if (/^nano[ -]banana/.test(r)) return 'nano banana'; return ['grok', 'nano banana', 'grok-pro', 'novelai'].includes(r) ? r : 'grok'; };
  // Effective connection: chosen SLAY profile (or its live settings) + the model picked in Studio.
  function slayConn() {
    const s = S(), ext = extCache.slayimages, st = ext.getSettings(), pid = s.profiles.slayimages;
    const prof = pid && pid !== '__live__' ? (st.connectionProfiles || []).find(p => p.name === pid) : null, src = prof || st;
    const apiType = src.apiType || 'openai', pick = String(s.models[mkey()] || '').trim();
    return { st, apiType, endpoint: src.endpoint || '', apiKey: src.apiKey || '', customBodyFormat: src.customBodyFormat || st.customBodyFormat || 'chat',
      model: pick || (apiType === 'naistera' ? (st.naisteraModel || '') : (src.model || '')) };
  }
  const slayStyleNow = () => { const s = S(); return String(s.slayShare ? (extCache.slayimages?.getSettings().slayStyle || '') : s.slayStyle || '').trim(); };
  function injectStyle(prompt, style) { // same [STYLE: …] block SLAY itself uses
    const p = String(prompt || '').trim(), st = String(style || '').trim(); if (!st) return p;
    const block = `[STYLE: ${st}]`, re = /\[\s*style\s*:\s*[^\]]*\]/i;
    return re.test(p) ? p.replace(re, () => block) : `${block}\n\n${p}`.trim();
  }
  function slayExtractImage(r) {
    const m = r?.choices?.[0]?.message;
    if (m) {
      if (Array.isArray(m.images) && m.images[0]) { const i = m.images[0]; if (i?.image_url?.url) return i.image_url.url; if (typeof i === 'string') return i; if (i?.url) return i.url; if (i?.b64_json) return `data:image/png;base64,${i.b64_json}`; }
      if (Array.isArray(m.content)) for (const part of m.content) { if (part?.type === 'image_url' && part?.image_url?.url) return part.image_url.url; if (part?.type === 'image' && part?.source?.data) return `data:${part.source.media_type || 'image/png'};base64,${part.source.data}`; }
      if (typeof m.content === 'string' && m.content) {
        const d = m.content.match(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/); if (d) return d[0];
        const md = m.content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+|data:image\/[^)]+)\)/); if (md) return md[1];
        const u = m.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/i); if (u) return u[0];
      }
      if (m.image_url?.url) return m.image_url.url;
    }
    const d0 = r?.data?.[0]; if (d0) return d0.b64_json ? `data:image/png;base64,${d0.b64_json}` : d0.url || null;
    return null;
  }
  async function urlToDataUrl(u) {
    const b = await (await fetch(u)).blob();
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
  }
  async function genSlay(prompt, neg, signal) {
    const s = S(), c = slayConn(), st = c.st, key = cleanKey(c.apiKey);
    if (c.apiType !== 'naistera' && !c.endpoint) throw new Error('SLAY connection has no endpoint. Fill it in SLAY Images settings.');
    if (!key) throw new Error('SLAY connection has no API key.');
    if (!/^[\x20-\x7E]+$/.test(key)) throw new Error('API key contains invalid characters (hidden unicode from copy/paste). Re-enter it in SLAY Images.');
    if (!['naistera', 'custom'].includes(c.apiType) && !c.model) throw new Error('Pick a model in Image Studio (or set one in the SLAY profile).');
    const text0 = neg ? `${prompt}\n\nAvoid: ${neg}` : prompt, style = slayStyleNow();
    const cap = c.apiType === 'naistera' ? (['grok', 'nano banana'].includes(slayNaisteraModel(c.model)) ? 5 : 0) : (c.apiType === 'custom' && c.customBodyFormat === 'images' ? 0 : 5);
    const refs = cap && wantsImages() ? await buildRefs('base64', cap) : [];
    if (!cap && wantsImages()) toast('info', 'This SLAY connection/model does not accept reference images, so they were skipped.');
    const instr = refs.map((r, i) => r.extra ? `Image ${i + 1} is "${r.refName}" — ${ROLES[r.role].label}.` : r.description ? `Image ${i + 1} is ${r.description} — preserve this appearance exactly.` : `Image ${i + 1} is a character reference — preserve this appearance exactly.`);
    const refHead = refs.length ? `${instr.join('\n')}\n${refs.some(r => !r.extra) ? 'Generate the scene below. Keep all faces and outfits faithful to the character references; use every other reference only for its stated purpose.' : 'Generate the scene below, using each reference only for its stated purpose.'}\n\n` : '';
    let ratio = s.aspectOverride || (st.aspectRatio && st.aspectRatio !== 'auto' ? st.aspectRatio : '1:1'); if (!slayAspects.includes(ratio)) ratio = '1:1';
    let size = ['1K', '2K', '4K'].includes(st.imageSize) ? st.imageSize : '1K';
    let r, out;
    if (c.apiType === 'gemini') {
      const parts = refs.map(x => ({ inlineData: { mimeType: 'image/png', data: x.image } })); parts.push({ text: refHead + injectStyle(text0, style) });
      const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key }; if (!/googleapis\.com/.test(c.endpoint)) headers.Authorization = `Bearer ${key}`;
      r = await xfetch(`${trimEp(c.endpoint)}/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', headers, signal: signal, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio, imageSize: size } } }) });
      if (!r.ok) throw new Error(`API Error (${r.status}): ${(await r.text()).slice(0, 300)}`);
      for (const part of (await r.json()).candidates?.[0]?.content?.parts || []) { const d = part.inlineData || part.inline_data; if (d?.data) return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`; }
      throw new Error('No image found in Gemini response');
    }
    if (c.apiType === 'naistera') {
      const model = slayNaisteraModel(c.model), base = String(c.endpoint || 'https://naistera.org').trim().replace(/\/+$/, '').replace(/\/api\/generate$/i, '');
      const ratioN = s.aspectOverride || (st.naisteraAspectRatio && st.naisteraAspectRatio !== 'auto' ? st.naisteraAspectRatio : '1:1');
      const lead = refs.length ? `[Reference images attached, in order: ${refs.map((x, i) => `${i + 1}=${x.extra ? `${x.role} reference “${x.refName}” (use only for its ${x.role})` : (x.description || 'reference')}`).join(', ')}. Use each reference for ITS OWN named subject only — do not mix attributes between subjects.] ` : '';
      const body = { prompt: lead + injectStyle(text0, style), aspect_ratio: ratioN, model }; if (refs.length) body.reference_images = refs.map(x => `data:image/png;base64,${x.image}`);
      r = await xfetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`API Error (${r.status}): ${(await r.text()).slice(0, 300)}`);
      const j = await r.json(); if (!j?.data_url) throw new Error('No data_url in response');
      if (j.media_kind === 'video') throw new Error('Naistera returned a video; Image Studio shows images only.');
      return j.data_url;
    }
    // openai / custom
    const isCustom = c.apiType === 'custom', full = injectStyle(text0, style) + (isCustom && c.customBodyFormat === 'images' ? '' : `\n\n[aspect_ratio: ${ratio}] [image_size: ${size}]`);
    let url, body;
    if (isCustom && c.customBodyFormat === 'images') { url = c.endpoint.trim().replace(/\/+$/, ''); body = { ...(c.model ? { model: c.model } : {}), prompt: full, n: 1, size: st.size || '1024x1024', response_format: 'b64_json' }; }
    else {
      url = isCustom ? c.endpoint.trim().replace(/\/+$/, '') : `${trimEp(c.endpoint)}/v1/chat/completions`;
      body = { ...(c.model ? { model: c.model } : {}), messages: [{ role: 'user', content: [{ type: 'text', text: refHead + full }, ...refs.map(x => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${x.image}` } }))] }], modalities: ['image', 'text'], stream: false };
    }
    r = await xfetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`API Error (${r.status}): ${(await r.text()).slice(0, 300)}`);
    out = slayExtractImage(await r.json()); if (!out) throw new Error('No image data in response.');
    return /^https?:\/\//i.test(out) ? await urlToDataUrl(out) : out;
  }
  async function fetchSlayModels(silent) {
    const k = mkey(); state.modelTried[k] = true; const c = slayConn(), key = cleanKey(c.apiKey);
    try {
      if (['custom', 'naistera'].includes(c.apiType)) { if (!silent) toast('info', 'This connection type has no model list. Use the list or “Other…”.'); return; }
      if (!c.endpoint || !key) throw new Error('endpoint / key missing in the SLAY connection');
      const base = trimEp(c.endpoint), google = /googleapis\.com/.test(base);
      // same source SLAY's own dropdown uses: the connection's /v1/models (Google's own endpoint uses /v1beta/models + key header)
      const r = await fetch(google ? `${base}/v1beta/models?pageSize=200` : `${base}/v1/models`, { headers: google ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const ids = (google ? (j.models || []).map(m => String(m.name || '').replace(/^models\//, '')) : (j.data || []).map(m => m.id)).filter(Boolean);
      const img = /image|imagen|dall|flux|diffusion|banana|seedream|midjourney|sdxl|draw|paint|recraft|grok-imagine/i; // likely image models first, nothing hidden
      state.modelCache[k] = [...ids.filter(i => img.test(i)).sort(), ...ids.filter(i => !img.test(i)).sort()];
      if (!silent) toast('success', `${state.modelCache[k].length} model(s) found.`);
    } catch (e) { if (!silent) toast('error', 'Could not fetch models: ' + (e.message || e)); }
    renderConn();
  }
  /* style button: opens SLAY's own picker; the Studio keeps its own choice unless “share with chat” is on */
  function renderSlayStyle() {
    const el = $('#is_slay_name'); if (!el) return;
    const s = S(), st = extCache.slayimages?.getSettings() || {};
    const name = s.slayShare ? (st.slayStyleName && st.slayStyle ? st.slayStyleName : '') : s.slayStyleName;
    el.textContent = name || (slayStyleNow() ? 'Custom style' : 'No style'); el.title = slayStyleNow();
  }
  async function openSlayStyle() {
    const ext = await loadExt('slayimages'); if (!ext) return toast('error', 'SLAY Images not found.');
    const btn = document.getElementById('slay_style_pick_btn');
    if (!btn) return toast('error', 'SLAY style button not loaded. Open the SLAY Images settings drawer once, then try again.');
    const st = ext.getSettings(), s = S(), prev = { style: st.slayStyle, name: st.slayStyleName };
    if (!s.slayShare) { st.slayStyle = s.slayStyle; st.slayStyleName = s.slayStyleName; } // so the picker highlights the Studio's current style
    const restore = () => { if (s.slayShare) return; st.slayStyle = prev.style; st.slayStyleName = prev.name; const el = document.getElementById('slay_style_name'); if (el) el.textContent = prev.name || 'Не заменять'; ctx().saveSettingsDebounced(); };
    const pp = $('#is_panel'), wasTop = inTop(pp); topHide(pp); // the style picker is an ordinary page layer; it would be hidden behind our popup
    const back = () => { if (wasTop && pp && !pp.classList.contains('is-hidden') && !isDocked()) topShow(pp); };
    btn.click();
    let seen = false, n = 0;
    const iv = setInterval(() => {
      const open = !!document.querySelector('.slay-style-overlay'); if (open) seen = true;
      if ((seen && !open) || ++n > 1200) {
        clearInterval(iv);
        if (seen) { s.slayStyle = st.slayStyle || ''; s.slayStyleName = st.slayStyle ? (st.slayStyleName || '') : ''; save(); }
        restore(); renderSlayStyle(); back();
      }
    }, 250);
  }

  async function fetchProfileModels(silent = false) {
    if (EXTS[S().engine]?.kind === 'slay') return fetchSlayModels(silent);
    const s = S(), ext = await loadExt(s.engine); if (!ext) return;
    const k = mkey(); state.modelTried[k] = true;
    try {
      const list = await withIsolated(ext, '', async (st) => {
        const provider = ext.prov.resolveActiveProvider(st);
        if (!provider || (st.rawEndpoint && st.apiType !== 'naistera')) return [];
        return (await provider.fetchModels()).map(id => [id, provider.getModelLabel?.(id) || id]);
      });
      state.modelCache[k] = list;
      if (!silent) toast(list.length ? 'success' : 'info', list.length ? `${list.length} model(s) found.` : 'This connection returned no models.');
    } catch (e) { if (!silent) toast('error', 'Could not fetch models: ' + (e.message || e)); }
    renderConn();
  }
  const setModel = (v) => { const s = S(); if (s.engine === 'standalone') s[s.api].model = v; else s.models[mkey()] = v; save(); };
  // The list is tied to the chosen generator: sillyimages -> what sillyimages' own provider returns for the chosen profile;
  // SLAY -> its own Naistera list or the models its connection reports; Standalone -> built-in suggestions.
  function modelOptions(ext, type) {
    const s = S(); let base = [];
    if (s.engine === 'standalone') base = s.api === 'novelai' ? NAI_MODELS : GEMINI_MODELS;
    else if (ext?.kind === 'slay') base = type === 'naistera' ? SLAY_NAISTERA_MODELS : [];
    const seen = new Set(base.map(x => x[0]));
    for (const m of state.modelCache[mkey()] || []) { const [id, label] = Array.isArray(m) ? m : [m, m]; if (!seen.has(id)) { seen.add(id); base = [...base, [id, label]]; } }
    return base;
  }

  const rawModel = () => { const s = S(); return s.engine === 'standalone' ? s[s.api].model : (s.models[mkey()] || ''); };
  const modelLabel = () => { const s = S(), m = rawModel(); const c = $('#is_conn')?.selectedOptions?.[0]?.textContent || s.engine; return `${c} · ${m || 'profile model'}`; };

  function renderEngineOptions() {
    const eng = $('#is_engine'), s = S(); if (!eng) return;
    eng.innerHTML = Object.keys(EXTS).map(id => `<option value="${id}">${EXTS[id].label}${extCache[id] === null ? ' (not found)' : ''}</option>`).join('') + '<option value="standalone">Standalone (own connection)</option>';
    eng.value = s.engine;
  }
  async function renderConn() {
    if (!$('#is_engine')) return;
    const s = S();
    renderEngineOptions();
    for (const id of Object.keys(EXTS)) if (id !== s.engine && extCache[id] === undefined) loadExt(id, false, true).then(renderEngineOptions); // background
    if (s.engine !== 'standalone' && extCache[s.engine] === undefined) {
      $('#is_conn').innerHTML = `<option value="${esc(s.profiles[s.engine] || '')}">Loading…</option>`;
      $('#is_model').innerHTML = `<option value="">${esc(rawModel() || 'Loading…')}</option>`;
      $('#is_sihint').textContent = `Looking for ${EXTS[s.engine].label}…`;
      await loadExt(s.engine);
      if (S().engine !== s.engine) return; // switched while loading
      renderEngineOptions();
    }
    const conn = $('#is_conn'), model = $('#is_model'), custom = $('#is_model_custom'), hint = $('#is_sihint');
    let opts = [], defLabel = '';
    if (s.engine === 'standalone') {
      conn.innerHTML = '<option value="gemini">Gemini / nano banana proxy</option><option value="novelai">NovelAI (SillyTavern key)</option>';
      conn.value = s.api; opts = modelOptions(null, s.api);
      hint.textContent = 'Standalone uses the endpoint and key from the Setup tab.';
    } else {
      const ext = extCache[s.engine];
      if (!ext) { conn.innerHTML = '<option value="">Extension not found</option>'; model.innerHTML = ''; custom.style.display = 'none'; hint.textContent = `${EXTS[s.engine].label} is not installed or could not be loaded. Pick Standalone instead.`; return; }
      let st, ps, prof, type;
      if (ext.kind === 'slay') {
        st = ext.getSettings(); const sp = st.connectionProfiles || [];
        ps = [{ id: '__live__', name: 'Current SLAY settings', apiType: st.apiType || 'openai', model: st.model, naisteraModel: st.naisteraModel }, ...sp.map(p => ({ ...p, id: p.name }))];
        conn.innerHTML = ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.apiType || 'openai')})</option>`).join('');
        if (!ps.some(p => p.id === s.profiles[s.engine])) { s.profiles[s.engine] = '__live__'; save(); }
        conn.value = s.profiles[s.engine]; prof = ps.find(p => p.id === conn.value); type = prof?.apiType || 'openai';
        defLabel = `Profile's model: ${(type === 'naistera' ? prof?.naisteraModel || st.naisteraModel : prof?.model) || 'not set'}`;
      } else {
        st = ext.set.getSettings(); ps = st.connectionProfiles || [];
        conn.innerHTML = ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.apiType)})</option>`).join('') || '<option value="">No profiles</option>';
        if (!ps.some(p => p.id === s.profiles[s.engine])) { s.profiles[s.engine] = st.activeConnectionProfileId || ps[0]?.id || ''; save(); }
        conn.value = s.profiles[s.engine];
        prof = ps.find(p => p.id === conn.value); type = prof?.apiType;
        defLabel = `Profile's model: ${(type === 'naistera' ? prof?.naisteraModel : prof?.model) || 'not set'}`;
      }
      opts = modelOptions(ext, type);
      if (prof && !(ext.kind === 'slay' && ['naistera', 'custom'].includes(type)) && !state.modelTried[mkey()]) fetchProfileModels(true); // load the extension's own list once
      hint.textContent = `The list comes from ${EXTS[s.engine].label} for this profile. Your pick is used only by Image Studio and never changes ${EXTS[s.engine].label}'s own model.`;
    }
    const cur = rawModel(), known = opts.map(o => o[0]);
    const isCustom = state.modelOther || (cur && !known.includes(cur));
    model.innerHTML = (s.engine === 'standalone' ? '' : `<option value="">${esc(defLabel)}</option>`)
      + opts.map(([id, l]) => `<option value="${esc(id)}">${esc(l)}</option>`).join('') + '<option value="__other__">Other…</option>';
    model.value = isCustom ? '__other__' : cur;
    custom.style.display = isCustom ? '' : 'none'; custom.value = isCustom ? cur : '';
    renderSlayStyle(); renderPreview();
  }

  /* ---------- Rendering ---------- */
  function renderVars() {
    const s = S(), used = syncVars(), usedLower = new Set([...used].map(x => x.toLowerCase()));
    $('#is_vars').innerHTML = s.vars.map((v, i) => `
      <div class="is-var ${usedLower.has(v.name.toLowerCase()) ? '' : 'unused'}" data-i="${i}">
        <div class="is-var-h"><div class="is-row" style="flex:1;gap:2px"><span>{</span><input type="text" class="is-vname" data-act="var-name" value="${esc(v.name)}" maxlength="40" aria-label="Variable name" title="Tap to rename; {${esc(v.name)}} in your prompt is renamed too"><span>}</span></div><button class="is-ib" data-act="var-del" title="Remove variable">🗑</button></div>
        <input type="text" data-act="var-val" value="${esc(v.value)}" placeholder="value for {${esc(v.name)}}">
        <div class="is-row">
          <select data-act="var-pick"><option value="">Saved options…</option>${v.options.map((o, k) => `<option value="${k}">${esc(o.name)}</option>`).join('')}</select>
          <button class="is-ib" data-act="var-save" title="Save current value as a named option">★</button>
        </div>
        <details class="is-opts" data-vn="${esc(v.name)}" ${state.varOpen.has(v.name) ? 'open' : ''}><summary>Edit saved options (${v.options.length})</summary>
          ${v.options.map((o, k) => `<div class="is-opt" data-oi="${k}"><input type="text" data-act="opt-name" value="${esc(o.name)}" placeholder="Name"><textarea data-act="opt-val" placeholder="Content (what gets written into the prompt)">${esc(o.value)}</textarea><div class="is-row"><button class="is-btn full" data-act="opt-use">Use</button><button class="is-btn full" data-act="opt-del">Delete</button></div></div>`).join('') || '<div class="is-hint">Nothing saved yet. Type a value above and tap ★.</div>'}
        </details>
      </div>`).join('') || '<div class="is-hint">Type {style} (or any {name}) in the main prompt to create a variable.</div>';
    renderPreview();
  }
  function renameVar(inp) {
    const s = S(), v = s.vars[inp.closest('.is-var').dataset.i], old = v.name;
    const nn = inp.value.trim().replace(/[^\p{L}\p{N}_-]/gu, '');
    if (!nn || nn === old) { inp.value = old; return; }
    if (s.vars.some(x => x !== v && x.name.toLowerCase() === nn.toLowerCase())) { toast('warning', `A variable named {${nn}} already exists.`); inp.value = old; return; }
    const swap = txt => replaceTags(txt, (m, n) => (n.toLowerCase() === old.toLowerCase() ? `{${nn}}` : m));
    s.prompt = swap(s.prompt); s.negative = swap(s.negative);
    for (const k of ['prompt', 'negative']) { const el = $(`[data-k="${k}"]`); if (el) el.value = s[k]; }
    v.name = nn; if (state.varOpen.delete(old)) state.varOpen.add(nn);
    save(); renderVars();
  }
  function renderPreview() { const el = $('#is_prev'); if (!el) return; el.textContent = finalText(buildFinal(), true); }

  function renderResult() {
    const el = $('#is_result'), l = state.last;
    $('#is_gen').innerHTML = state.busy ? '<span class="is-spin"></span>Generating… tap to cancel' : 'Generate';
    if (state.busy) { el.innerHTML = ''; return; }
    el.innerHTML = l ? `<img src="${l.url}" alt="Generated image" data-act="view-last" title="Tap to view full size" style="cursor:zoom-in">
      <div class="is-row"><button class="is-btn full" data-act="save" ${l.saved ? 'disabled' : ''}>${l.saved ? 'Saved' : 'Save to library'}</button>
      <button class="is-btn full" data-act="dl-last">Download</button></div>
      <div class="is-row" style="margin-top:6px"><button class="is-btn full" data-act="view-last">⛶ View full size</button></div>
      <div class="is-row" style="margin-top:6px"><button class="is-btn full" data-act="res-ref">Use as character</button><button class="is-btn full" data-act="res-extra">Use as reference picture</button></div>
      <details class="is-sent"><summary>Prompt that was sent</summary><pre>${esc(l.sent || '')}</pre></details>` : '';
  }

  async function renderLibrary() {
    const items = (await libAll()).filter(i => !state.libFilter || ((i.title || '') + ' ' + i.resolved + ' ' + i.template).toLowerCase().includes(state.libFilter));
    $('#is_lib').innerHTML = items.length ? items.map(i => `<div class="is-card" data-id="${i.id}">${i.thumb ? `<img loading="lazy" src="${i.thumb}" alt="">` : '<div class="is-noimg is-bigph">T</div>'}<div>${esc(i.title || i.resolved)}</div></div>`).join('')
      : '<div class="is-empty" style="grid-column:1/-1">No saved prompts yet. Generate one and tap “Save to library”, or import a file.</div>';
  }

  async function openLightbox(id) {
    const it = (await libAll()).find(x => x.id === id); if (!it) return;
    state.lbId = id; state.lbItem = it; state.lbEdit = { title: it.title || '', template: it.template || '', negative: it.negative || '' };
    $('#is_lb').innerHTML = `${it.image ? `<img src="${it.image}" alt="" data-act="lb-view" title="Tap to view full size">` : '<div class="is-empty">Prompt only (no image)</div>'}
      <div class="is-hint">${esc(it.model || '')} · ${new Date(it.ts).toLocaleString()}</div>
      <label class="is-l">Name</label><input type="text" data-act="lb-title" value="${esc(state.lbEdit.title)}" placeholder="Untitled">
      <label class="is-l">Prompt (with {tags})</label><textarea data-act="lb-tpl">${esc(state.lbEdit.template)}</textarea>
      <label class="is-l">Negative</label><textarea data-act="lb-neg" style="min-height:56px">${esc(state.lbEdit.negative)}</textarea>
      <details class="is-sent"><summary>Prompt that was sent</summary><pre>${esc(it.resolved || '')}</pre></details>
      <div class="is-row"><button class="is-btn pri full" data-act="lb-save">Save changes</button><button class="is-btn full" data-act="lb-use">Use this prompt</button></div>
      <div class="is-row">${it.image ? '<button class="is-btn full" data-act="lb-view">⛶ Full size</button><button class="is-btn full" data-act="lb-dl">Download</button>' : ''}</div>
      <div class="is-row">${it.image ? '<button class="is-btn full" data-act="lb-ref">Use as character</button><button class="is-btn full" data-act="lb-extra">Use as reference picture</button>' : ''}</div>
      <div class="is-row"><button class="is-btn full" data-act="lb-export">Export</button></div>
      <div class="is-row"><button class="is-btn full" data-act="lb-del">Delete</button><button class="is-btn full" data-act="lb-close">Close</button></div>`;
    $('#is_lb').classList.add('on');
  }
  async function exportLibrary(withImages, ids) {
    if (!state.refsLoaded) await loadRefs();
    const items = (await libAll()).filter(i => !ids || ids.includes(i.id));
    if (!items.length) return toast('info', 'Nothing to export.');
    const want = new Set([].concat(...items.map(i => [...(i.refIds || []), ...(i.extraIds || []), ...(i.poseId ? [i.poseId] : [])])));
    const refs = state.refs.filter(r => want.has(r.id)).map(r => ({ id: r.id, kind: r.kind || 'character', role: r.role || '', name: r.name, description: r.description || '', negative: r.negative || '', mode: r.mode || 'both', ...(withImages && r.image ? { image: r.image, thumb: r.thumb } : {}) }));
    const data = { app: 'image-studio', format: 1, exported: new Date().toISOString(), includesImages: !!withImages, items: items.map(i => { const o = { ...i }; if (!withImages) { delete o.image; delete o.thumb; } return o; }), refs };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    download(url, `image-studio-${withImages ? 'with-images' : 'prompts'}-${new Date().toISOString().slice(0, 10)}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast('success', `Exported ${items.length} item(s)${withImages ? ' with images' : ' (prompts only)'}.`);
  }
  async function importLibrary(inp) {
    const file = inp.files[0]; inp.value = ''; if (!file) return;
    let data; try { data = JSON.parse(await file.text()); } catch { return toast('error', 'That file is not valid JSON.'); }
    const items = Array.isArray(data) ? data : data?.items;
    if (!Array.isArray(items)) return toast('error', 'No library items found in that file.');
    if (!state.refsLoaded) await loadRefs();
    const have = new Set((await libAll()).map(i => i.id)); let added = 0, skipped = 0;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || (!raw.template && !raw.resolved)) { skipped++; continue; }
      if (raw.id && have.has(raw.id)) { skipped++; continue; }
      const it = { vars: {}, negative: '', resolved: raw.template || '', refIds: [], model: '', ...raw, id: raw.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), ts: Number(raw.ts) || Date.now(), image: raw.image || '', thumb: raw.thumb || (raw.image ? await makeThumb(raw.image) : '') };
      await libPut(it); have.add(it.id); added++;
    }
    let addedRefs = 0;
    for (const r of data?.refs || []) {
      if (!r?.id || state.refs.some(x => x.id === r.id)) continue;
      const rk = (r.kind === 'ref' || r.kind === 'pose') ? 'ref' : 'character', rec = { id: r.id, ts: Date.now(), kind: rk, ...(rk === 'ref' ? { role: r.kind === 'pose' ? 'pose' : (ROLES[r.role] ? r.role : 'whole') } : {}), name: r.name || 'Reference', description: r.description || '', negative: r.negative || '', mode: r.mode || 'both', image: r.image || '', thumb: r.thumb || (r.image ? await makeThumb(r.image, 200) : '') };
      await putRef(rec); state.refs.unshift(rec); addedRefs++;
    }
    renderLibrary(); renderRefs(); renderSlots();
    toast(added ? 'success' : 'info', `Imported ${added} item(s)${skipped ? `, skipped ${skipped} already here or invalid` : ''}${addedRefs ? `, plus ${addedRefs} character(s)` : ''}.`);
  }

  function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

  function applyUI() {
    const s = S(), p = $('#is_panel');
    p.style.setProperty('--is-op', s.opacity);
    $('#is_op').value = Math.round(s.opacity * 100);
    p.classList.toggle('is-min', s.minimized);
    $('#is_min').textContent = s.minimized ? '▴' : '▾';
    $('#is_fab').classList.toggle('is-off', !s.showButton);
    const sbx = $('#is_show_btn'); if (sbx) sbx.checked = !!s.showButton;
    $$('.is-tab', p).forEach(t => t.classList.toggle('on', t.dataset.tab === s.tab));
    $$('.is-sec', p).forEach(t => t.classList.toggle('on', t.dataset.tab === s.tab));
    $$('[data-show]', p).forEach(e => { const k = e.dataset.show; const on = k === 'ext' ? s.engine !== 'standalone' : k === 'slay' ? s.engine === 'slayimages' : k === 'si' ? s.engine === 'sillyimages' : (s.engine === 'standalone' && (k === 'standalone' || s.api === k)); e.style.display = on ? '' : 'none'; });
    $$('[data-k]', p).forEach(e => { const v = getPath(s, e.dataset.k); if (e.type === 'checkbox') e.checked = !!v; else if (document.activeElement !== e) e.value = v ?? ''; });
  }

  /* ---------- Import creds from sillyimages / SLAYimages ---------- */
  function findOtherConfigs() {
    const out = [];
    for (const [name, v] of Object.entries(ctx().extensionSettings || {})) {
      if (name === MODULE || !v || typeof v !== 'object') continue;
      const keys = Object.keys(v);
      const kKey = keys.find(k => /(api)?[_-]?key|token/i.test(k) && typeof v[k] === 'string' && v[k]);
      const uKey = keys.find(k => /(url|endpoint|base)/i.test(k) && typeof v[k] === 'string' && v[k]);
      if (kKey && uKey) out.push({ name, endpoint: v[uKey], key: v[kKey], model: v[keys.find(k => /^model$/i.test(k))] || '' });
    }
    return out;
  }
  function renderImport() {
    const list = findOtherConfigs();
    $('#is_import').innerHTML = list.length
      ? `<select id="is_imp_sel">${list.map((c, i) => `<option value="${i}">${esc(c.name)} — ${esc(c.endpoint.slice(0, 40))}</option>`).join('')}</select><button class="is-btn full" style="margin-top:6px" data-act="import">Copy endpoint, key & model</button>`
      : '<div class="is-hint">No other image extension settings found. Enter them manually below.</div>';
    $('#is_import').dataset.list = JSON.stringify(list);
  }

  /* ---------- Build UI ---------- */
  const opt = (arr, cur) => arr.map(a => `<option ${a === cur ? 'selected' : ''}>${a}</option>`).join('');
  function build() {
    if ($('#is_panel')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="is_fab" title="Image Studio">🎨</div>
    <div id="is_viewer" class="is-viewer" popover="manual" style="display:none"><div class="is-viewer-bar"><button class="is-ib" data-vact="dl" title="Download">⬇</button><button class="is-ib" data-vact="close" title="Close">✕</button></div><div class="is-viewer-scroll"><img id="is_viewer_img" alt="Generated image"></div></div>
    <div id="is_panel" class="is-hidden" popover="manual">
      <div class="is-head">
        <span class="is-title">Image Studio</span>
        <div class="is-op-wrap" title="Panel opacity"><span>◐</span><input type="range" id="is_op" min="25" max="100"></div>
        <button class="is-ib" id="is_min" title="Collapse">▾</button><button class="is-ib" id="is_close" title="Close">✕</button>
      </div>
      <div id="is_err" class="is-hint" style="display:none;color:#f88;padding:6px 10px"></div>
      <div class="is-tabs"><button class="is-tab" data-tab="create">Create</button><button class="is-tab" data-tab="library">Library</button><button class="is-tab" data-tab="refs">Refs</button><button class="is-tab" data-tab="setup">Setup</button></div>
      <div class="is-body">
        <section class="is-sec" data-tab="create">
          <label class="is-l">Generator extension</label><select id="is_engine" data-act="engine"></select>
          <label class="is-l">Connection profile</label><select id="is_conn" data-act="conn"></select>
          <label class="is-l">Model (chosen here, independent of the extension's own)</label>
          <div class="is-row"><select id="is_model" data-act="model"></select><button class="is-ib" data-show="ext" data-act="model-fetch" title="Refresh model list from this connection">↻</button></div>
          <input type="text" id="is_model_custom" data-act="model-custom" placeholder="Custom model id" autocomplete="off" style="display:none;margin-top:6px">
          <div data-show="ext"><label class="is-l">Aspect ratio override (Gemini / nano banana only)</label>
            <select data-k="aspectOverride"><option value="">Use profile setting</option>${opt(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], '')}</select></div>
          <div data-show="slay" style="display:none"><label class="is-l">SLAY style</label>
            <div class="is-row"><span id="is_slay_name" class="is-slay-name">No style</span><button class="is-btn" data-act="slay-style" style="white-space:nowrap">🎨 Choose style</button><button class="is-ib" data-act="slay-style-clear" title="No style">✕</button></div>
            <label class="is-l"><input type="checkbox" data-k="slayShare"> Share with chat (use SLAY's own current style)</label></div>
          <div class="is-hint" id="is_sihint"></div>
          <label class="is-l">Main prompt — use {tags} for swappable parts</label>
          <textarea data-k="prompt" placeholder="1girl, {style}, standing in a forest"></textarea>
          <label class="is-l">Negative prompt</label>
          <textarea data-k="negative" style="min-height:56px"></textarea>
          <label class="is-l">Variables</label>
          <div id="is_vars"></div>
          <div class="is-row"><input type="text" id="is_newvar" placeholder="new variable name"><button class="is-btn" data-act="var-add">Add</button></div>
          <div class="is-row" style="justify-content:space-between;margin-top:12px"><span class="is-l" style="margin:0">Character references <b id="is_refcount"></b></span><label class="is-l" style="margin:0"><input type="checkbox" data-k="useRefs"> Send</label></div>
          <div id="is_slots"></div>
          <div id="is_chips" class="is-chips"></div>
          <div class="is-hint">Name each character and use the names in your prompt: “personA kissing personB”. Each can be sent as image + text, image only or text only. Text prompts go in the way the model likes: NovelAI V4 gets real per-character prompts, other models get the description next to the name plus a “Characters” list. Check “Final prompt preview” to see it.</div>
          <div class="is-row" style="justify-content:space-between;margin-top:14px"><span class="is-l" style="margin:0">Reference pictures <b id="is_extracount"></b></span><label class="is-l" style="margin:0"><input type="checkbox" data-k="useExtras"> Send</label></div>
          <div id="is_extras"></div>
          <div class="is-hint">Any picture to take something from: a pose, a style, a scene, an outfit, a background, or a whole picture to recreate with your own characters. Pick what to take, then write its {tag} in your prompt (tap the tag chip above), for example “personA in {pose}”. If you don't write the tag, it is added for you. NovelAI uses the text only.</div>
          <details style="margin-top:10px"><summary class="is-hint" style="cursor:pointer">Final prompt preview</summary><pre id="is_prev" style="white-space:pre-wrap;font-size:12px"></pre></details>
          <button id="is_gen" class="is-btn pri full" style="margin-top:12px" data-act="gen">Generate</button>
          <div id="is_result" class="is-result"></div>
        </section>
        <section class="is-sec" data-tab="library">
          <div class="is-row"><button class="is-btn full" data-act="lib-export">Export prompts</button><button class="is-btn full" data-act="lib-export-img">Export + images</button></div>
          <button class="is-btn full" style="margin:6px 0" data-act="lib-import">Import from file</button>
          <input type="file" id="is_impfile" accept="application/json,.json" hidden>
          <input type="text" id="is_search" placeholder="Search saved prompts">
          <div id="is_lib" class="is-lib"></div>
        </section>
        <section class="is-sec" data-tab="refs">
          <div class="is-row" style="margin-bottom:8px"><button class="is-btn full" data-act="ref-kind" data-kind="character">Characters</button><button class="is-btn full" data-act="ref-kind" data-kind="ref">References</button></div>
          <div class="is-hint">Characters: up to 4 per image, chosen on the Create tab. References: up to 3 pictures per image, each with a purpose (pose, style, composition, outfit, background, whole picture).</div>
          <button class="is-btn pri full" data-act="ref-upload">Upload images</button>
          <button class="is-btn full" style="margin-top:6px" data-act="ref-text-new">＋ New text-only character</button>
          <div id="is_refs" style="margin-top:8px"></div>
          <input type="file" id="is_file" accept="image/*" multiple hidden>
        </section>
        <section class="is-sec" data-tab="setup">
          <div data-show="ext">
            <div class="is-hint">Endpoint, key and API type come from the extension profile you pick on the Create tab. Nothing to enter here.</div>
            <button class="is-btn full" data-show="si" data-act="si-styles">Import the extension's styles as {style} options</button>
            <button class="is-btn full" style="margin-top:6px" data-act="si-refresh">Re-scan extensions and profiles</button>
          </div>
          <label class="is-l">Copy settings from another image extension (standalone mode)</label><div id="is_import"></div>
          <div data-show="gemini">
            <label class="is-l">Endpoint (Google or proxy)</label><input type="text" data-k="gemini.endpoint">
            <label class="is-l">API key</label><input type="password" data-k="gemini.key" autocomplete="off">
            <div class="is-grid2"><div><label class="is-l">Aspect ratio</label><select data-k="gemini.aspect">${opt(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], '')}</select></div>
            <div><label class="is-l">Size (Pro models)</label><select data-k="gemini.size">${opt(['1K', '2K', '4K'], '')}</select></div></div>
          </div>
          <div data-show="novelai">
            <div class="is-hint">Uses the NovelAI key saved in SillyTavern (API Connections → NovelAI).</div>
            <div class="is-grid2"><div><label class="is-l">Sampler</label><select data-k="novelai.sampler">${opt(['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m', 'k_dpmpp_2s_ancestral', 'k_dpmpp_sde'], '')}</select></div>
            <div><label class="is-l">Scheduler</label><select data-k="novelai.scheduler">${opt(['karras', 'native', 'exponential', 'polyexponential'], '')}</select></div>
            <div><label class="is-l">Steps</label><input type="number" data-k="novelai.steps" data-num></div>
            <div><label class="is-l">Guidance</label><input type="number" step="0.1" data-k="novelai.scale" data-num></div>
            <div><label class="is-l">Width</label><input type="number" step="64" data-k="novelai.width" data-num></div>
            <div><label class="is-l">Height</label><input type="number" step="64" data-k="novelai.height" data-num></div></div>
            <label class="is-l">Seed (-1 = random)</label><input type="number" data-k="novelai.seed" data-num>
            <label class="is-l"><input type="checkbox" data-k="novelai.decrisper"> Decrisper</label>
            <label class="is-l"><input type="checkbox" data-k="novelai.variety"> Variety boost</label>
          </div>
          <label class="is-l">Language</label><select data-k="lang"><option value="auto">Auto (follow SillyTavern)</option><option value="en">English</option><option value="ru">Русский</option></select>
          <label class="is-l"><input type="checkbox" data-k="autosave"> Auto-save every result to library</label>
          <label class="is-l"><input type="checkbox" data-k="showButton"> Show floating 🎨 button <span class="is-hint">(if hidden, open from the wand menu or Extensions settings)</span></label>
          <button class="is-btn full" style="margin-top:8px" data-act="diag">Run self-check</button>
          <pre id="is_diag" class="is-sent" style="display:none;white-space:pre-wrap;font-size:11px"></pre>
          <div class="is-hint">Image Studio v${VERSION}</div>
          <button class="is-btn full" style="margin-top:8px" data-act="reset-pos">Reset button &amp; window position</button>
        </section>
      </div>
      <div id="is_lb" class="is-lb"></div>
      <div id="is_inline_toast" class="is-itoast" style="display:none"></div>
    </div>`);
    const p = $('#is_panel');
    $('#is_viewer').addEventListener('click', (e) => {
      const v = e.currentTarget, b = e.target.closest('[data-vact]');
      if (b) { if (b.dataset.vact === 'close') closeViewer(); else download(v._url, `image-studio-${Date.now()}.png`); return; }
      if (e.target.id === 'is_viewer_img') v.classList.toggle('zoom'); else closeViewer();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#is_viewer')?.style.display !== 'none') closeViewer(); });

    $('#is_fab').addEventListener('click', e => { const f = e.currentTarget; if (f._dragged || Date.now() - (f._tapAt || 0) < 700) return; toggle(); });
    $('#is_close').addEventListener('click', () => { p.classList.add('is-hidden'); topHide(p); undockPanel(); });
    $('#is_min').addEventListener('click', () => { const s = S(); s.minimized = !s.minimized; save(); applyUI(); });
    $('#is_op').addEventListener('input', e => { const s = S(); s.opacity = e.target.value / 100; p.style.setProperty('--is-op', s.opacity); save(); });
    $('#is_search').addEventListener('input', e => { state.libFilter = e.target.value.toLowerCase(); renderLibrary(); });

    p.addEventListener('click', async (e) => {
      const tab = e.target.closest('.is-tab'); if (tab) { const s = S(); s.tab = tab.dataset.tab; save(); applyUI(); if (s.tab === 'library') renderLibrary(); if (s.tab === 'refs') renderRefs(); if (s.tab === 'setup') renderImport(); return; }
      const pk = e.target.closest('[data-pick]'); if (pk) { if (state.pickKind === 'ref') extraAdd(pk.dataset.pick); else slotAdd(pk.dataset.pick); $('#is_lb').classList.remove('on'); return; }
      const card = e.target.closest('.is-card'); if (card) return openLightbox(card.dataset.id);
      const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
      const s = S(), vi = b.closest('.is-var')?.dataset.i, v = vi !== undefined ? s.vars[vi] : null;
      switch (b.dataset.act) {
        case 'gen': return generate();
        case 'save': return saveLast();
        case 'view-last': if (state.last) openViewer(state.last.url); return;
        case 'dl-last': return download(state.last.url, `image-studio-${Date.now()}.png`);
        case 'var-add': { const n = $('#is_newvar').value.trim().replace(/[^\p{L}\p{N}_-]/gu, ''); if (n && !s.vars.some(x => x.name.toLowerCase() === n.toLowerCase())) { s.vars.push({ name: n, value: '', options: [] }); $('#is_newvar').value = ''; save(); renderVars(); } return; }
        case 'var-del': s.vars.splice(vi, 1); save(); return renderVars();
        case 'var-save': { const val = v.value.trim(); if (!val) return toast('info', 'Type a value first.'); if (v.options.some(o => o.value === val)) return toast('info', 'Already saved.'); v.options.push({ name: val.length > 40 ? val.slice(0, 38) + '…' : val, value: val }); state.varOpen.add(v.name); save(); renderVars(); return toast('success', 'Saved. Rename or edit it under “Edit saved options”.'); }
        case 'opt-use': { const o = v.options[+b.closest('.is-opt').dataset.oi]; if (o) { v.value = o.value; save(); renderVars(); } return; }
        case 'opt-del': { v.options.splice(+b.closest('.is-opt').dataset.oi, 1); save(); renderVars(); return; }
        case 'import': { const c = JSON.parse($('#is_import').dataset.list)[$('#is_imp_sel').value]; if (c) { s.gemini.endpoint = c.endpoint; s.gemini.key = c.key; if (c.model) s.gemini.model = c.model; s.engine = 'standalone'; s.api = 'gemini'; save(); applyUI(); renderConn(); toast('success', `Imported from ${c.name}.`); } return; }
        case 'si-refresh': for (const id of Object.keys(EXTS)) await loadExt(id, true); await renderConn(); return toast('info', 'Rescanned.');
        case 'model-fetch': return fetchProfileModels(false);
        case 'si-styles': {
          const si = await loadExt('sillyimages'); if (!si?.set) return toast('error', 'sillyimages not found.');
          const list = (si.set.getSettings().styles || []).filter(x => x.value);
          if (!list.length) return toast('info', 'No styles saved in sillyimages.');
          let sv = s.vars.find(x => x.name.toLowerCase() === 'style'); if (!sv) { sv = { name: 'style', value: '', options: [] }; s.vars.push(sv); }
          list.forEach(x => { if (!sv.options.some(o => o.value === x.value)) sv.options.push({ name: String(x.name || x.title || x.value).slice(0, 40), value: x.value }); });
          save(); renderVars(); return toast('success', `Imported ${list.length} style(s) into {style}.`);
        }
        case 'slot-add': return openPicker('character');
        case 'extra-add': return openPicker('ref');
        case 'extra-rm': { s.extraIds.splice(+b.closest('.is-slotrow').dataset.i, 1); save(); renderExtras(); renderChips(); return renderPreview(); }
        case 'ref-kind': state.refKind = b.dataset.kind; return renderRefs();
        case 'res-extra': return imageToExtra(state.last.url);
        case 'lb-extra': { const it = (await libAll()).find(x => x.id === state.lbId); if (it) { await imageToExtra(it.image); $('#is_lb').classList.remove('on'); } return; }
        case 'slay-style': return openSlayStyle();
        case 'slay-style-clear': s.slayStyle = ''; s.slayStyleName = ''; save(); return renderSlayStyle();
        case 'ref-text-new': { await addTextRef(state.refKind); renderRefs(); return toast('success', state.refKind === 'ref' ? 'Text-only reference added. Choose its purpose and describe it.' : 'Text-only character added. Give it a name and prompt.'); }
        case 'diag': { const d = $('#is_diag'), txt = diagText(); d.textContent = txt; d.style.display = ''; try { navigator.clipboard.writeText(txt); toast('info', 'Copied to clipboard.'); } catch (x) { /* ignore */ } return; }
        case 'reset-pos': s.fabPos = null; s.panelPos = null; save(); placeFab(); placePanel(); return toast('success', 'Positions reset.');
        case 'chip': {
          const ta = $('[data-k="prompt"]'), a = ta.selectionStart ?? ta.value.length, e2 = ta.selectionEnd ?? a;
          const pre = ta.value.slice(0, a), post = ta.value.slice(e2), sep = pre && !/[\s,(]$/.test(pre) ? ' ' : '', ins = sep + b.dataset.name;
          ta.value = pre + ins + post; ta.setSelectionRange(pre.length + ins.length, pre.length + ins.length);
          ta.dispatchEvent(new Event('input', { bubbles: true })); return;
        }
        case 'slot-rm': { s.refSlots.splice(+b.closest('.is-slotrow').dataset.i, 1); save(); return renderSlots(); }
        case 'pick-upload': state.toSlot = true; return $('#is_file').click();
        case 'ref-upload': state.toSlot = false; return $('#is_file').click();
        case 'ref-slot': { const id = b.closest('.is-ref').dataset.id, rr = state.refs.find(x => x.id === id); if (rr?.kind === 'ref') { if (extraAdd(id)) toast('success', 'Added as a reference picture.'); } else if (slotAdd(id)) toast('success', 'Added to this generation.'); return; }
        case 'ref-del': { const id = b.closest('.is-ref').dataset.id; if (confirm(tr('Delete this reference?'))) { await dbDo('readwrite', st => st.delete(id), REFS); state.refs = state.refs.filter(r => r.id !== id); s.refSlots = s.refSlots.filter(x => x !== id); save(); renderRefs(); renderSlots(); } return; }
        case 'res-ref': return imageToRef(state.last.url);
        case 'lb-ref': { const it = (await libAll()).find(x => x.id === state.lbId); if (it) { await imageToRef(it.image); $('#is_lb').classList.remove('on'); } return; }
        case 'lb-close': return $('#is_lb').classList.remove('on');
        case 'lb-dl': { const it = (await libAll()).find(x => x.id === state.lbId); if (it) download(it.image, `image-studio-${it.id}.png`); return; }
        case 'lb-del': if (confirm(tr('Delete this image from the library?'))) { await libDel(state.lbId); $('#is_lb').classList.remove('on'); renderLibrary(); } return;
        case 'lb-save': { const it = state.lbItem; if (!it) return; Object.assign(it, state.lbEdit); await libPut(it); renderLibrary(); return toast('success', 'Saved.'); }
        case 'lb-export': return exportLibrary(true, [state.lbId]);
        case 'lb-view': { if (state.lbItem?.image) openViewer(state.lbItem.image); return; }
        case 'lib-export': return exportLibrary(false);
        case 'lib-export-img': return exportLibrary(true);
        case 'lib-import': return $('#is_impfile').click();
        case 'lb-use': {
          const it = (await libAll()).find(x => x.id === state.lbId); if (!it) return;
          s.prompt = state.lbEdit?.template ?? it.template; s.negative = state.lbEdit?.negative ?? it.negative;
          if (it.engine) { s.engine = it.engine; s.api = it.api || s.api; if (it.profile) s.profiles[it.engine] = it.profile; if (it.engine === 'standalone') s[s.api].model = it.modelRaw || s[s.api].model; else if (it.profile) s.models[`${it.engine}:${it.profile}`] = it.modelRaw || ''; }
          else if (it.provider) { s.engine = it.provider === 'sillyimages' ? 'sillyimages' : 'standalone'; if (it.provider !== 'sillyimages') s.api = it.provider; }
          for (const [name, value] of Object.entries(it.vars || {})) { const ex = s.vars.find(x => x.name === name); if (ex) ex.value = value; else s.vars.push({ name, value, options: [] }); }
          if (!state.refsLoaded) await loadRefs();
          s.refSlots = (it.refIds || []).filter(id => state.refs.some(r => r.id === id)).slice(0, MAX_REFS);
          if ((it.refIds || []).length > s.refSlots.length) toast('info', 'Some saved references no longer exist.');
          { const ids = it.extraIds || (it.poseId ? [it.poseId] : []); s.extraIds = ids.filter(id => state.refs.some(r => r.id === id)).slice(0, MAX_EXTRA); if (ids.length > s.extraIds.length) toast('info', 'Some saved reference pictures no longer exist.'); }
          save(); $('#is_lb').classList.remove('on'); s.tab = 'create'; applyUI(); renderVars(); renderSlots(); renderConn(); return;
        }
      }
    });

    p.addEventListener('toggle', (e) => { const d = e.target; if (d.classList?.contains('is-opts')) { if (d.open) state.varOpen.add(d.dataset.vn); else state.varOpen.delete(d.dataset.vn); } }, true);
    p.addEventListener('input', (e) => {
      const t = e.target, s = S();
      if (t.dataset.act === 'opt-name' || t.dataset.act === 'opt-val') {
        const box = t.closest('.is-var'), k = +t.closest('.is-opt').dataset.oi, o = s.vars[box.dataset.i].options[k]; if (!o) return;
        if (t.dataset.act === 'opt-name') { o.name = t.value; const op = box.querySelector('[data-act="var-pick"]')?.options[k + 1]; if (op) op.textContent = t.value; } else o.value = t.value;
        save(); return;
      }
      if (t.dataset.act === 'var-val') { s.vars[t.closest('.is-var').dataset.i].value = t.value; save(); return renderPreview(); }
      if (t.dataset.act === 'model-custom') { setModel(t.value.trim()); return; }
      if (t.dataset.act === 'slot-name') {
        const r = state.refs.find(x => x.id === s.refSlots[+t.closest('.is-slotrow').dataset.i]); if (!r) return;
        r.name = t.value.trim() || `Reference ${+t.closest('.is-slotrow').dataset.i + 1}`;
        clearTimeout(state.refT[r.id]); state.refT[r.id] = setTimeout(() => putRef(r), 400); renderChips(); return renderPreview();
      }
      if (['lb-title', 'lb-tpl', 'lb-neg'].includes(t.dataset.act)) { if (state.lbEdit) state.lbEdit[{ 'lb-title': 'title', 'lb-tpl': 'template', 'lb-neg': 'negative' }[t.dataset.act]] = t.value; return; }
      if (['ref-name', 'ref-desc', 'ref-neg'].includes(t.dataset.act)) {
        const box = t.closest('[data-rid]'), id = box?.dataset.rid, r = state.refs.find(x => x.id === id); if (!r) return;
        r[{ 'ref-name': 'name', 'ref-desc': 'description', 'ref-neg': 'negative' }[t.dataset.act]] = t.value;
        const inRefs = box.classList.contains('is-ref');
        clearTimeout(state.refT[id]); state.refT[id] = setTimeout(() => { putRef(r); if (inRefs) renderSlots(); else { const x = extraItems().find(y => y.r.id === id), tg = box.querySelector('.is-tag'); if (x && tg && t.dataset.act === 'ref-name') tg.textContent = `{${x.tag}}`; renderChips(); renderPreview(); } }, 400); return;
      }
      if (t.dataset.k) {
        let val = t.type === 'checkbox' ? t.checked : (t.hasAttribute('data-num') ? Number(t.value) : t.value);
        setPath(s, t.dataset.k, val); save();
        if (t.dataset.k === 'slayShare') renderSlayStyle();
        if (t.dataset.k === 'lang') { applyLang(); renderAllPanels(); }
        if (t.dataset.k === 'showButton') { applyUI(); if (!val) toast('info', 'Button hidden. Open Image Studio from the wand menu or Extensions settings.'); }
        if (t.dataset.k === 'prompt' || t.dataset.k === 'negative') { clearTimeout(build._t); build._t = setTimeout(renderVars, 400); renderChips(); }
      }
    });
    p.addEventListener('change', (e) => {
      const t = e.target, s = S();
      if (t.id === 'is_file') return handleFiles(t);
      if (t.id === 'is_impfile') return importLibrary(t);
      if (t.dataset.act === 'engine') { s.engine = t.value; state.modelOther = false; save(); applyUI(); return renderConn(); }
      if (t.dataset.act === 'conn') { if (s.engine === 'standalone') s.api = t.value; else s.profiles[s.engine] = t.value; state.modelOther = false; save(); applyUI(); return renderConn(); }
      if (t.dataset.act === 'ref-role') {
        const r = state.refs.find(x => x.id === t.closest('[data-rid]')?.dataset.rid); if (!r) return;
        const was = r.role || 'whole'; r.role = t.value;
        if (looksAutoName(r.name) && was !== r.role) r.name = defaultName(r.role); // keep the tag meaningful: pose, artstyle, layout, outfit, bg, like
        putRef(r); renderExtras(); renderRefs(); renderChips(); renderPreview(); return;
      }
      if (t.dataset.act === 'ref-mode') { const r = state.refs.find(x => x.id === t.closest('[data-rid]')?.dataset.rid); if (r) { r.mode = t.value; putRef(r); renderSlots(); renderRefs(); } return; }
      if (t.dataset.act === 'model') { if (t.value === '__other__') { state.modelOther = true; $('#is_model_custom').style.display = ''; return; } state.modelOther = false; setModel(t.value); return renderConn(); }
      if (t.dataset.act === 'var-name') return renameVar(t);
      if (t.dataset.act === 'var-pick' && t.value !== '') { const v = S().vars[t.closest('.is-var').dataset.i]; v.value = v.options[+t.value].value; save(); renderVars(); }
    });
  }


  /* ---------- full-size image viewer ---------- */
  function openViewer(url) {
    const v = $('#is_viewer'); if (!v || !url) return;
    v.classList.remove('zoom'); $('#is_viewer_img').src = url; v._url = url; v.style.display = 'flex'; topShow(v);
  }
  function closeViewer() { const v = $('#is_viewer'); if (v) { topHide(v); v.style.display = 'none'; $('#is_viewer_img').removeAttribute('src'); } }

  /* ---------- dragging (floating button + desktop window) ---------- */
  function dragify(el, handle, { skip, enabled, move, end, tap }) {
    let id = null, sx = 0, sy = 0, ox = 0, oy = 0, moving = false;
    handle.addEventListener('pointerdown', e => {
      if (e.button > 0 || (enabled && !enabled()) || (skip && e.target.closest(skip))) return;
      const r = el.getBoundingClientRect(); id = e.pointerId; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; moving = false;
      try { handle.setPointerCapture(id); } catch { /* ignore */ }
    });
    handle.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moving && Math.hypot(dx, dy) < 6) return;
      moving = true; e.preventDefault(); move(ox + dx, oy + dy);
    });
    const up = e => {
      if (e.pointerId !== id) return; id = null; const tapped = !moving && e.type === 'pointerup';
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (moving) { handle._dragged = true; setTimeout(() => { handle._dragged = false; }, 80); end(); }
      moving = false;
      if (tapped && tap) tap(e);
    };
    handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  }
  const desk = () => window.matchMedia('(min-width:701px)').matches;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  function placeFab() {
    const f = $('#is_fab'), s = S(); if (!f) return;
    if (!s.fabPos) { Object.assign(f.style, { left: '', top: '', right: '', bottom: '' }); return; }
    const w = f.offsetWidth || 46, h = f.offsetHeight || 46;
    Object.assign(f.style, { left: Math.round(s.fabPos.fx * Math.max(0, innerWidth - w)) + 'px', top: Math.round(s.fabPos.fy * Math.max(0, innerHeight - h)) + 'px', right: 'auto', bottom: 'auto' });
  }
  function placePanel() {
    const p = $('#is_panel'), s = S(); if (!p) return;
    if (!s.panelPos || !desk() || isDocked()) { Object.assign(p.style, { left: '', top: '', right: '', bottom: '', maxHeight: '' }); return; }
    const w = p.offsetWidth || Math.min(440, innerWidth - 28), x = clamp(s.panelPos.x, 4 - w + 120, innerWidth - 120), y = clamp(s.panelPos.y, 4, innerHeight - 56);
    Object.assign(p.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', maxHeight: (innerHeight - y - 8) + 'px' });
  }
  function setupDrag() {
    const f = $('#is_fab'), p = $('#is_panel');
    dragify(f, f, {
      tap: () => { f._tapAt = Date.now(); toggle(); },
      move: (x, y) => { x = clamp(x, 4, innerWidth - f.offsetWidth - 4); y = clamp(y, 4, innerHeight - f.offsetHeight - 4); Object.assign(f.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' }); f._x = x; f._y = y; },
      end: () => { S().fabPos = { fx: f._x / Math.max(1, innerWidth - f.offsetWidth), fy: f._y / Math.max(1, innerHeight - f.offsetHeight) }; save(); },
    });
    dragify(p, $('.is-head', p), {
      skip: 'button,input,select', enabled: () => desk() && !isDocked(),
      move: (x, y) => { const w = p.offsetWidth; x = clamp(x, 4 - w + 120, innerWidth - 120); y = clamp(y, 4, innerHeight - 56); Object.assign(p.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', maxHeight: (innerHeight - y - 8) + 'px' }); p._x = x; p._y = y; },
      end: () => { S().panelPos = { x: p._x, y: p._y }; save(); },
    });
    f.addEventListener('click', e => { if (f._dragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    window.addEventListener('resize', () => { placeFab(); placePanel(); });
  }

  function showErr(where, e) { console.error('[Image Studio]', where, e); report(where, e, false); const el = $('#is_err'); if (el) { el.textContent = `⚠ ${where}: ${e?.message || e}`; el.style.display = ''; } }
  function guard(where, fn) { try { const r = fn(); if (r && r.catch) r.catch(e => showErr(where, e)); } catch (e) { showErr(where, e); } }
  function renderAllPanels() { for (const [n, f] of [['variables', renderVars], ['references', renderSlots], ['refs', renderRefs], ['result', renderResult], ['connection', renderConn]]) guard(n, f); applyLang(); }
  function toggle() {
    const p = $('#is_panel');
    if (p.classList.contains('is-docked')) { undockPanel(); p.classList.add('is-hidden'); } // so the toggle below opens it as the floating window
    p.classList.toggle('is-hidden');
    if (p.classList.contains('is-hidden')) { topHide(p); return; }
    topShow(p);
    const er = $('#is_err'); if (er) er.style.display = 'none';
    // each step is isolated so one failure can't leave the other fields empty
    for (const [n, f] of [['layout', placePanel], ['settings', applyUI], ['variables', renderVars], ['result', renderResult], ['references', renderSlots], ['connection', renderConn]]) guard(n, f);
    setTimeout(verifyOpen, 400);
  }
  // If the panel opened but can't be seen (covered by another layer, or zero size), fix the stacking, and if that fails say exactly why.
  const describeEl = el => (el ? `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}>` : 'nothing');
  function bringToFront() {
    for (const id of ['is_fab', 'is_panel', 'is_viewer']) { const el = document.getElementById(id); if (el) document.body.appendChild(el); }
    const p = $('#is_panel'); if (p) { p.style.zIndex = '2147483000'; if (!p.classList.contains('is-hidden') && !isDocked()) topShow(p); }
    const v = $('#is_viewer'); if (v && v.style.display !== 'none') topShow(v); // re-adding to the page closed them: show again, viewer last so it stays on top
  }
  function verifyOpen() {
    const p = $('#is_panel'); if (!p || p.classList.contains('is-hidden') || !document.elementFromPoint || isDocked()) return;
    const check = () => {
      const r = p.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return `the panel has no size (${Math.round(r.width)}x${Math.round(r.height)})`;
      const x = Math.min(innerWidth - 4, Math.max(4, r.left + r.width / 2)), y = Math.min(innerHeight - 4, Math.max(4, r.top + Math.min(40, r.height / 2)));
      const el = document.elementFromPoint(x, y); return el && p.contains(el) ? '' : `it is covered by ${describeEl(el)}`;
    };
    let why = check(); if (why) { bringToFront(); why = check(); }
    if (!why) { setDrawerStatus('Opened ✓'); return; }
    if (dockPanel()) { setDrawerStatus('The popup could not be shown on this device, so Image Studio opened here as a last resort.'); report('open', new Error(`Floating panel not visible (${why}); opened inside the Extensions menu.`), false); return; }
    setDrawerStatus('Could not open: ' + why);
    report('open', new Error('The panel opened but is not visible: ' + why), true);
  }
  function diagText() {
    const L = [`Image Studio v${VERSION}`, `UA: ${navigator.userAgent}`, `Screen: ${innerWidth}x${innerHeight} @${window.devicePixelRatio || 1}`];
    const feat = (n, f) => { let ok = false; try { ok = !!f(); } catch (x) { /* no */ } return `${n}: ${ok ? 'yes' : 'NO'}`; };
    L.push(feat('regex lookbehind', () => new RegExp('(?<!a)b').test('cb')), feat('structuredClone', () => typeof structuredClone === 'function'), feat('PointerEvent', () => window.PointerEvent), feat('IndexedDB', () => window.indexedDB), feat('MutationObserver', () => window.MutationObserver), feat('popover / top layer', () => hasPopover()), feat('dvh units', () => CSS.supports('height', '1dvh')), feat('color-mix', () => CSS.supports('color', 'color-mix(in srgb, red, blue)')));
    for (const id of ['is_fab', 'is_panel', 'is_menu_item', 'is_open_btn', 'extensionsMenu', 'extensions_settings2']) L.push(`#${id}: ${document.getElementById(id) ? 'present' : 'missing'}`);
    const p = $('#is_panel'); if (p) { const cs = getComputedStyle(p), r = p.getBoundingClientRect(); L.push(`panel: display=${cs.display} z=${cs.zIndex} rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} hidden=${p.classList.contains('is-hidden')} topLayer=${inTop(p)}`); }
    try { const sx = ctx().extensionSettings; L.push(`extensionSettings: ${sx ? 'ok' : 'MISSING'}`, `settings: engine=${sx && sx[MODULE] && sx[MODULE].engine} showButton=${sx && sx[MODULE] && sx[MODULE].showButton}`); } catch (x) { L.push('SillyTavern context: ' + x.message); }
    const errs = window.__imageStudioErrors || []; if (errs.length) L.push('Errors:', ...errs.slice(-6));
    return L.join('\n');
  }
  window.__imageStudioDiag = diagText;


  /* ---------- Language (English / Русский) ----------
   * The interface is written in English. For Russian, text is swapped in place (text nodes, placeholders, tooltips) and messages are
   * translated when shown; user content (prompts, names, saved items) is never touched. Anything without a translation stays English. */
  const RU = {};
  const RU_RX = [];
  const stLang = () => { try { return String(localStorage.getItem('language') || navigator.language || 'en').toLowerCase(); } catch (x) { return 'en'; } };
  const curLang = () => { let l = 'auto'; try { l = S().lang; } catch (x) { /* settings unavailable */ } return l === 'auto' ? (stLang().indexOf('ru') === 0 ? 'ru' : 'en') : l; };
  function trStr(core) {
    if (RU[core] !== undefined) return RU[core];
    for (const [re, fn] of RU_RX) { const m = core.match(re); if (m) return fn(...m.slice(1)); }
    return null;
  }
  const tr = s => { if (typeof s !== 'string' || curLang() !== 'ru') return s; const o = trStr(s.trim()); return o == null ? s : o; };
  const I18N_SKIP = 'textarea,pre,script,style,input,.is-card,.is-pickitem,.is-chip,.is-tag,.is-vname,.is-sent pre';
  function trTextNode(node, lang) {
    const p = node.parentElement; if (!p || p.closest(I18N_SKIP)) return;
    const cur = node.nodeValue;
    if (node.__tr !== undefined && cur === node.__tr) { if (lang !== 'ru') { node.nodeValue = node.__orig; node.__tr = undefined; } return; } // already ours
    node.__tr = undefined;
    if (lang !== 'ru') return;
    const core = cur.trim(); if (!core) return;
    const out = trStr(core); if (out == null || out === core) return;
    node.__orig = cur; node.__tr = cur.replace(core, () => out); node.nodeValue = node.__tr;
  }
  const I18N_ATTRS = ['placeholder', 'title', 'aria-label'];
  function trAttrs(el, lang) {
    for (const a of I18N_ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a); el.__ia = el.__ia || {};
      const rec = el.__ia[a];
      if (rec && cur === rec.tr) { if (lang !== 'ru') { el.setAttribute(a, rec.orig); delete el.__ia[a]; } continue; }
      if (rec) delete el.__ia[a];
      if (lang !== 'ru') continue;
      const out = trStr(cur.trim()); if (out == null || out === cur.trim()) continue;
      el.__ia[a] = { orig: cur, tr: out }; el.setAttribute(a, out);
    }
  }
  function translateTree(root, lang) {
    if (!root || !root.nodeType) return;
    if (root.nodeType === 3) return trTextNode(root, lang);
    if (root.nodeType !== 1) return;
    trAttrs(root, lang);
    for (const el of root.querySelectorAll('[placeholder],[title],[aria-label]')) trAttrs(el, lang);
    const w = document.createTreeWalker(root, 4 /* SHOW_TEXT */); const nodes = []; let n;
    while ((n = w.nextNode())) nodes.push(n);
    for (const x of nodes) trTextNode(x, lang);
  }
  let i18nObs = null; const i18nRoots = new Set();
  function applyLang() {
    const lang = curLang();
    if (!i18nObs && window.MutationObserver) {
      i18nObs = new MutationObserver(muts => {
        const lg = curLang();
        for (const m of muts) {
          if (m.type === 'characterData') trTextNode(m.target, lg);
          else for (const a of m.addedNodes) translateTree(a, lg);
        }
      });
    }
    for (const sel of ['#is_panel', '#is_viewer', '#is_settings', '#is_menu_item']) {
      const el = document.querySelector(sel); if (!el) continue;
      if (i18nObs && !i18nRoots.has(el)) { i18nRoots.add(el); i18nObs.observe(el, { childList: true, subtree: true, characterData: true }); }
      translateTree(el, lang);
    }
  }


  Object.assign(RU, {"Create": "Создание", "Library": "Библиотека", "Refs": "Референсы", "Setup": "Настройки", "Generator extension": "Расширение-генератор", "Connection profile": "Профиль подключения", "Model (chosen here, independent of the extension's own)": "Модель (выбирается здесь, независимо от модели самого расширения)", "Aspect ratio override (Gemini / nano banana only)": "Своё соотношение сторон (только Gemini / nano banana)", "Use profile setting": "Как в профиле", "SLAY style": "Стиль SLAY", "No style": "Без стиля", "🎨 Choose style": "🎨 Выбрать стиль", "Share with chat (use SLAY's own current style)": "Общий стиль с чатом (использовать текущий стиль самого SLAY)", "Main prompt — use {tags} for swappable parts": "Основной промпт — используйте {теги} для заменяемых частей", "Negative prompt": "Негативный промпт", "Variables": "Переменные", "Saved options…": "Сохранённые варианты…", "Use": "Применить", "Delete": "Удалить", "Nothing saved yet. Type a value above and tap ★.": "Пока ничего не сохранено. Введите значение выше и нажмите ★.", "Add": "Добавить", "Character references": "Референсы персонажей", "Send": "Отправлять", "＋ Add character reference": "＋ Добавить референс персонажа", "Name each character and use the names in your prompt: “personA kissing personB”. Each can be sent as image + text, image only or text only. Text prompts go in the way the model likes: NovelAI V4 gets real per-character prompts, other models get the description next to the name plus a “Characters” list. Check “Final prompt preview” to see it.": "Дайте каждому персонажу имя и используйте имена в промпте: «personA целует personB». Каждого можно отправлять как картинку + текст, только картинку или только текст. Текстовые промпты передаются так, как удобно модели: NovelAI V4 получает отдельные промпты персонажей, остальные модели — описание рядом с именем и список «Characters». Итоговый вид смотрите в «Итоговый промпт (предпросмотр)».", "Reference pictures": "Референс-картинки", "＋ Add reference picture": "＋ Добавить референс-картинку", "Any picture to take something from: a pose, a style, a scene, an outfit, a background, or a whole picture to recreate with your own characters. Pick what to take, then write its {tag} in your prompt (tap the tag chip above), for example “personA in {pose}”. If you don't write the tag, it is added for you. NovelAI uses the text only.": "Любая картинка, из которой нужно что-то взять: поза, стиль, сцена, одежда, фон или картинка целиком, которую нужно воссоздать с вашими персонажами. Выберите, что взять, и впишите её {тег} в промпт (нажмите на плашку тега выше), например «personA in {pose}». Если тег не вписать, он добавится сам. NovelAI использует только текст.", "Final prompt preview": "Итоговый промпт (предпросмотр)", "Generate": "Сгенерировать", "Export prompts": "Экспорт промптов", "Export + images": "Экспорт с картинками", "Import from file": "Импорт из файла", "Characters": "Персонажи", "References": "Референсы", "Characters: up to 4 per image, chosen on the Create tab. References: up to 3 pictures per image, each with a purpose (pose, style, composition, outfit, background, whole picture).": "Персонажи: до 4 на изображение, выбираются на вкладке «Создание». Референсы: до 3 картинок на изображение, у каждой своё назначение (поза, стиль, композиция, одежда, фон, картинка целиком).", "Upload images": "Загрузить картинки", "＋ New text-only character": "＋ Новый персонаж только с текстом", "No references yet. Upload a character image, or add a text-only character.": "Референсов пока нет. Загрузите картинку персонажа или добавьте персонажа только с текстом.", "Upload reference pictures": "Загрузить референс-картинки", "＋ New text-only reference": "＋ Новый референс только с текстом", "No reference pictures yet. Upload any picture (a pose, a style, a scene…), or add a text-only reference.": "Референс-картинок пока нет. Загрузите любую картинку (позу, стиль, сцену…) или добавьте референс только с текстом.", "Use as reference": "Использовать как референс", "Endpoint, key and API type come from the extension profile you pick on the Create tab. Nothing to enter here.": "Адрес, ключ и тип API берутся из профиля расширения, выбранного на вкладке «Создание». Здесь вводить ничего не нужно.", "Import the extension's styles as {style} options": "Импортировать стили расширения как варианты для {style}", "Re-scan extensions and profiles": "Пересканировать расширения и профили", "Copy settings from another image extension (standalone mode)": "Скопировать настройки из другого расширения изображений (автономный режим)", "Copy endpoint, key & model": "Скопировать адрес, ключ и модель", "No other image extension settings found. Enter them manually below.": "Настроек других расширений изображений не найдено. Введите вручную ниже.", "Endpoint (Google or proxy)": "Адрес (Google или прокси)", "API key": "API-ключ", "Aspect ratio": "Соотношение сторон", "Size (Pro models)": "Размер (модели Pro)", "Uses the NovelAI key saved in SillyTavern (API Connections → NovelAI).": "Используется ключ NovelAI, сохранённый в SillyTavern (Подключения API → NovelAI).", "Sampler": "Сэмплер", "Scheduler": "Планировщик", "Steps": "Шаги", "Guidance": "Guidance (CFG)", "Width": "Ширина", "Height": "Высота", "Seed (-1 = random)": "Сид (-1 = случайный)", "Language": "Язык", "Auto (follow SillyTavern)": "Авто (как в SillyTavern)", "Auto-save every result to library": "Автоматически сохранять каждый результат в библиотеку", "Show floating 🎨 button": "Показывать плавающую кнопку 🎨", "(if hidden, open from the wand menu or Extensions settings)": "(если скрыта — откройте из меню волшебной палочки или из настроек расширений)", "Run self-check": "Запустить самопроверку", "Reset button & window position": "Сбросить положение кнопки и окна", "Show floating button": "Показывать плавающую кнопку", "Open Image Studio": "Открыть Image Studio", "Panel opacity": "Прозрачность панели", "Collapse": "Свернуть", "Close": "Закрыть", "Download": "Скачать", "Remove": "Убрать", "Refresh model list from this connection": "Обновить список моделей из этого подключения", "Custom model id": "Свой id модели", "Variable name": "Имя переменной", "Remove variable": "Удалить переменную", "Save current value as a named option": "Сохранить текущее значение как именованный вариант", "Name": "Название", "Content (what gets written into the prompt)": "Содержимое (что подставляется в промпт)", "new variable name": "имя новой переменной", "Search saved prompts": "Поиск по сохранённым промптам", "Untitled": "Без названия", "Tap to view full size": "Нажмите, чтобы открыть во весь экран", "Standalone (own connection)": "Автономно (своё подключение)", "Gemini / nano banana proxy": "Gemini / прокси nano banana", "NovelAI (SillyTavern key)": "NovelAI (ключ SillyTavern)", "Other…": "Другая…", "Loading…": "Загрузка…", "No profiles": "Нет профилей", "Extension not found": "Расширение не найдено", "Standalone uses the endpoint and key from the Setup tab.": "Автономный режим использует адрес и ключ из вкладки «Настройки».", "Image + text": "Картинка + текст", "Image only": "Только картинка", "Text only": "Только текст", "Text prompt & negative": "Текстовый промпт и негатив", "Text & negative": "Текст и негатив", "Tap to insert:": "Нажмите, чтобы вставить:", "Use in prompt": "Использовать в промпте", "Upload new": "Загрузить новый", "Cancel": "Отмена", "No unused references. Upload a new one.": "Свободных референсов нет. Загрузите новый.", "No saved reference pictures yet. Upload one.": "Сохранённых референс-картинок пока нет. Загрузите.", "Name, e.g. personA": "Имя, например personA", "Name used in prompts, e.g. personA": "Имя для промптов, например personA", "Prompt for this character (looks, outfit…)": "Промпт для этого персонажа (внешность, одежда…)", "Negative for this character": "Негатив для этого персонажа", "Text prompt for this character (looks, outfit, tags…)": "Текстовый промпт персонажа (внешность, одежда, теги…)", "Tag name, e.g. pose1": "Имя тега, например pose1", "In words (optional): e.g. sitting cross-legged, looking over her shoulder": "Словами (необязательно): например, сидит по-турецки, смотрит через плечо", "Negative for this reference (e.g. crossed arms)": "Негатив для этого референса (например, скрещённые руки)", "In words (optional): what to take from it": "Словами (необязательно): что из неё взять", "Negative for this reference": "Негатив для этого референса", "Pose": "Поза", "Art style": "Стиль рисунка", "Composition": "Композиция", "Outfit": "Одежда", "Background": "Фон", "Whole picture (recreate it)": "Картинка целиком (воссоздать)", "Save to library": "Сохранить в библиотеку", "⛶ View full size": "⛶ Во весь экран", "⛶ Full size": "⛶ Во весь экран", "Saved": "Сохранено", "Use as character": "Использовать как персонажа", "Use as reference picture": "Использовать как референс-картинку", "Prompt that was sent": "Отправленный промпт", "No saved prompts yet. Generate one and tap “Save to library”, or import a file.": "Сохранённых промптов пока нет. Сгенерируйте картинку и нажмите «Сохранить в библиотеку» или импортируйте файл.", "Prompt (with {tags})": "Промпт (с {тегами})", "Negative": "Негатив", "Save changes": "Сохранить изменения", "Use this prompt": "Использовать этот промпт", "Export": "Экспорт", "Prompt only (no image)": "Только промпт (без картинки)", "Delete this image from the library?": "Удалить эту запись из библиотеки?", "Delete this reference?": "Удалить этот референс?", "Opening…": "Открываю…", "Opened ✓": "Открыто ✓", "The popup could not be shown on this device, so Image Studio opened here as a last resort.": "Всплывающее окно не удалось показать на этом устройстве, поэтому Image Studio открыт здесь как запасной вариант.", "Added as a reference picture. Choose what to take from it.": "Добавлено как референс-картинка. Выберите, что из неё взять.", "Added as a reference picture.": "Добавлено как референс-картинка.", "Main prompt is empty.": "Основной промпт пуст.", "NovelAI can’t take reference images; text references are still applied.": "NovelAI не принимает референс-картинки; текстовые референсы всё равно применяются.", "Saved to library.": "Сохранено в библиотеку.", "This model does not accept reference images, so they were skipped.": "Эта модель не принимает референс-картинки, поэтому они пропущены.", "This SLAY connection/model does not accept reference images, so they were skipped.": "Это подключение/модель SLAY не принимает референс-картинки, поэтому они пропущены.", "This connection type has no model list. Use the list or “Other…”.": "У этого типа подключения нет списка моделей. Используйте список или «Другая…».", "SLAY Images not found.": "SLAY Images не найден.", "SLAY style button not loaded. Open the SLAY Images settings drawer once, then try again.": "Кнопка стиля SLAY не загружена. Один раз откройте панель настроек SLAY Images и попробуйте снова.", "Nothing to export.": "Нечего экспортировать.", "That file is not valid JSON.": "Этот файл — не корректный JSON.", "No library items found in that file.": "В этом файле нет элементов библиотеки.", "Type a value first.": "Сначала введите значение.", "Already saved.": "Уже сохранено.", "Saved. Rename or edit it under “Edit saved options”.": "Сохранено. Переименовать или изменить можно в разделе «Изменить сохранённые варианты».", "Rescanned.": "Пересканировано.", "sillyimages not found.": "sillyimages не найден.", "No styles saved in sillyimages.": "В sillyimages нет сохранённых стилей.", "Copied to clipboard.": "Скопировано в буфер обмена.", "Positions reset.": "Положение сброшено.", "Added to this generation.": "Добавлено в эту генерацию.", "Saved.": "Сохранено.", "Some saved references no longer exist.": "Некоторых сохранённых референсов больше нет.", "Some saved reference pictures no longer exist.": "Некоторых сохранённых референс-картинок больше нет.", "Button hidden. Open Image Studio from the wand menu or Extensions settings.": "Кнопка скрыта. Открывайте Image Studio из меню волшебной палочки или из настроек расширений.", "Text-only reference added. Choose its purpose and describe it.": "Референс только с текстом добавлен. Выберите его назначение и опишите.", "Text-only character added. Give it a name and prompt.": "Персонаж только с текстом добавлен. Дайте ему имя и промпт.", "This connection returned no models.": "Это подключение не вернуло моделей."});
  RU_RX.push(
    [/^Edit saved options \((\d+)\)$/, n => `Изменить сохранённые варианты (${n})`],
    [/^Tap to rename; (\{.+\}) in your prompt is renamed too$/, v => `Нажмите, чтобы переименовать; ${v} в промпте тоже будет переименован`],
    [/^value for (\{.+\})$/, v => `значение для ${v}`],
    [/^Current SLAY settings \((.+)\)$/, a => `Текущие настройки SLAY (${a})`],
    [/^(.+) \(not found\)$/, a => `${a} (не найдено)`],
    [/^Profile's model: (.+)$/, v => 'Модель профиля: ' + (v === 'not set' ? 'не задана' : v)],
    [/^The list comes from (.+) for this profile\. Your pick is used only by Image Studio and never changes (.+)'s own model\.$/, (a, b) => `Список берётся из ${a} для этого профиля. Ваш выбор используется только в Image Studio и никогда не меняет собственную модель ${b}.`],
    [/^(.+) is not installed or could not be loaded\. Pick Standalone instead\.$/, a => `${a} не установлено или не удалось загрузить. Выберите «Автономно».`],
    [/^Looking for (.+)…$/, a => `Ищу ${a}…`],
    [/^Choose a character reference \((.+) in use\)$/, n => `Выберите референс персонажа (используется ${n})`],
    [/^Choose a reference picture \((.+) in use\)$/, n => `Выберите референс-картинку (используется ${n})`],
    [/^Up to (\d+) references per image\.$/, n => `Не более ${n} референсов на одно изображение.`],
    [/^Up to (\d+) reference pictures per image\.$/, n => `Не более ${n} референс-картинок на одно изображение.`],
    [/^This model takes (\d+) reference image\(s\); using the first (\d+)\.$/, n => `Эта модель принимает референс-картинок: ${n}. Использую первые ${n}.`],
    [/^This model takes (\d+) reference image\(s\); “(.+)” was skipped( \(its text is still used\))?\.$/, (n, nm, tx) => `Эта модель принимает референс-картинок: ${n}. «${nm}» пропущена${tx ? ' (её текст всё равно используется)' : ''}.`],
    [/^Could not read (.+)$/, f => `Не удалось прочитать ${f}`],
    [/^Added (\d+) reference\(s\)\.$/, n => `Добавлено референсов: ${n}.`],
    [/^(.+) not in the prompt — the model may ignore (that reference|those references)\.$/, (names, which) => `${names} нет в промпте — модель может проигнорировать ${which === 'that reference' ? 'этот референс' : 'эти референсы'}.`],
    [/^(\d+) model\(s\) found\.$/, n => `Найдено моделей: ${n}.`],
    [/^A variable named (\{.+\}) already exists\.$/, v => `Переменная ${v} уже существует.`],
    [/^Exported (\d+) item\(s\)( with images| \(prompts only\))\.$/, (n, w) => `Экспортировано записей: ${n}${w.indexOf('images') > 0 ? ' (с картинками)' : ' (только промпты)'}.`],
    [/^Imported (\d+) item\(s\)(?:, skipped (\d+) already here or invalid)?(?:, plus (\d+) character\(s\))?\.$/, (n, sk, ch) => `Импортировано записей: ${n}${sk ? `, пропущено (уже есть или некорректны): ${sk}` : ''}${ch ? `, плюс персонажей: ${ch}` : ''}.`],
    [/^Imported from (.+)\.$/, a => `Импортировано из ${a}.`],
    [/^Imported (\d+) style\(s\) into (\{style\})\.$/, (n, v) => `Импортировано стилей в ${v}: ${n}.`],
    [/^Image Studio (.+): opening…$/, v => `Image Studio ${v}: открываю…`],
    [/^Could not fetch models: (.+)$/, m => `Не удалось получить модели: ${m}`],
    [/^Could not open: (.+)$/, m => `Не удалось открыть: ${m}`],
  );

  let lastOpen = 0;
  const setDrawerStatus = txt => { txt = tr(txt); const el = $('#is_drawer_status'); if (el) el.textContent = txt; };
  const isDocked = () => !!$('#is_panel')?.classList.contains('is-docked');
  // "Docked" = the panel is shown inside the Extensions drawer instead of floating. The drawer is always visible, so this can't be covered.
  function undockPanel() { const p = $('#is_panel'); if (!p || !p.classList.contains('is-docked')) return; topHide(p); p.classList.remove('is-docked'); document.body.appendChild(p); placePanel(); }
  function dockPanel() {
    const p = $('#is_panel'), host = $('#is_settings .inline-drawer-content'); if (!p || !host) return false;
    topHide(p); p.classList.add('is-docked'); p.classList.remove('is-hidden', 'is-min'); host.appendChild(p);
    Object.assign(p.style, { left: '', top: '', right: '', bottom: '', maxHeight: '', zIndex: '' });
    for (const [n, f] of [['settings', applyUI], ['variables', renderVars], ['result', renderResult], ['references', renderSlots], ['connection', renderConn]]) guard(n, f);
    try { p.scrollIntoView({ block: 'nearest' }); } catch (x) { /* ignore */ }
    return true;
  }
  function showPanel() {
    const now = Date.now(); if (now - lastOpen < 500) return; lastOpen = now;
    const p = $('#is_panel'); if (!p) return;
    toast('info', `Image Studio ${VERSION}: opening…`); // proves the tap reached us
    if (isDocked()) undockPanel();
    if (p.classList.contains('is-hidden')) toggle();
    else { const s = S(); if (s.minimized) { s.minimized = false; save(); applyUI(); } bringToFront(); setTimeout(verifyOpen, 200); }
    setDrawerStatus('Opening…');
  }
  // Adds our entries to SillyTavern's wand menu and Extensions drawer. Safe to call repeatedly; it only adds what is missing.
  function mountMenus() {
    const menu = $('#extensionsMenu');
    if (menu && !$('#is_menu_item')) menu.insertAdjacentHTML('beforeend', '<div id="is_menu_item" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="button" style="cursor:pointer"><div class="fa-solid fa-palette extensionsMenuExtensionButton"></div><span>Image Studio</span></div>');
    const host = $('#extensions_settings2') || $('#extensions_settings');
    if (host && !$('#is_settings')) host.insertAdjacentHTML('beforeend', `<div id="is_settings" class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Image Studio <small style="opacity:.6">v${VERSION}</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input type="checkbox" id="is_show_btn"><span>Show floating button</span></label><div class="menu_button" id="is_open_btn" style="cursor:pointer">Open Image Studio</div><div id="is_drawer_status" class="is-hint" style="margin:6px 4px"></div></div></div>`);
    for (const id of ['is_menu_item', 'is_open_btn']) { const el = document.getElementById(id); if (el && !el.dataset.direct) { el.dataset.direct = 1; el.addEventListener('click', () => showPanel()); } } // direct handler too; showPanel ignores the duplicate
    applyLang();
    const sb = $('#is_show_btn'); if (sb && !sb.dataset.bound) { sb.dataset.bound = 1; sb.checked = S().showButton; sb.addEventListener('change', () => { S().showButton = sb.checked; save(); applyUI(); }); }
  }
  function setupEntryPoints() {
    // Delegated on document, so it keeps working if SillyTavern rebuilds those menus. Touch: if no click arrives, fall back to pointerup.
    let clickAt = 0; const sel = '#is_menu_item, #is_open_btn';
    document.addEventListener('click', e => { const el = e.target.closest?.(sel); if (el) { clickAt = Date.now(); showPanel(); } }, true);
    document.addEventListener('pointerup', e => { const el = e.target.closest?.(sel); if (e.pointerType === 'mouse' || !el) return; const t0 = Date.now(); setTimeout(() => { if (clickAt < t0) showPanel(); }, 450); }, true);
    // The menus may not exist yet (or be rebuilt) on slow phones: keep checking, cheaply.
    let timer = 0; const check = () => { timer = 0; guard('menu', mountMenus); };
    new MutationObserver(() => { if (!timer) timer = setTimeout(check, 300); }).observe(document.body, { childList: true, subtree: true });
    try { const c = ctx(); c.eventSource?.on(c.eventTypes.APP_READY, () => guard('menu', mountMenus)); } catch { /* ignore */ }
    try { ctx().registerSlashCommand?.('imagestudio', () => { showPanel(); return ''; }, ['studio'], 'Open Image Studio', true, true); } catch { /* ignore */ } // /imagestudio
  }

  jQuery(() => {
    try { build(); } catch (e) { report('build', e, true); return; }
    try { S(); } catch (e) { report('settings', e, true); } // SillyTavern's settings aren't reachable: nothing can work, say so
    for (const [n, f] of [['drag', setupDrag], ['language', applyLang], ['settings', applyUI], ['button', placeFab], ['layout', placePanel], ['variables', renderVars], ['result', renderResult], ['menu', mountMenus], ['entry', setupEntryPoints]]) guard(n, f);
    guard('failsafe', () => { if (/[?&]imagestudio\b/.test(location.search)) { S().showButton = true; save(); applyUI(); showPanel(); } }); // open SillyTavern with ?imagestudio to force the button back
    loadRefs().then(() => { renderVars(); renderSlots(); renderRefs(); }).catch(e => showErr('references', e));
  });
})();
} catch (e) { window.__imageStudioReport('load', e, true); }
