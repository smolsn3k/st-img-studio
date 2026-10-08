/* Image Studio – SillyTavern extension
 * Generates images from its own panel. Never posts anything to chat.
 * Providers: Nano Banana (Gemini API / proxy) and NovelAI 4.5 (via SillyTavern server proxy).
 */
(() => {
  const MODULE = 'image_studio';
  const ctx = () => SillyTavern.getContext();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (type, msg) => { try { window.toastr?.[type](msg, 'Image Studio'); } catch { console.log(msg); } };

  const DEFAULTS = {
    engine: 'sillyimages', api: 'gemini', fabPos: null, panelPos: null, profiles: {}, models: {}, aspectOverride: '', refSlots: [], useRefs: true,
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

  const fill = (t, d) => { for (const k in d) { if (t[k] === undefined) t[k] = structuredClone(d[k]); else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) fill(t[k], d[k]); } return t; };
  const S = () => {
    const es = ctx().extensionSettings, o = es[MODULE] = es[MODULE] || {};
    if (o.provider !== undefined) { // migrate 1.x settings
      o.engine = o.provider === 'sillyimages' ? 'sillyimages' : 'standalone'; o.api = o.provider === 'novelai' ? 'novelai' : 'gemini';
      if (o.siProfile) o.profiles = { sillyimages: o.siProfile };
      if (o.siAspect !== undefined) o.aspectOverride = o.siAspect;
      delete o.provider; delete o.siProfile; delete o.siAspect;
    }
    return fill(o, DEFAULTS);
  };
  const save = () => ctx().saveSettingsDebounced();
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };

  const state = { last: null, busy: false, abort: null, libFilter: '', lbId: null, refs: [], refsLoaded: false, toSlot: false, refT: {}, modelCache: {}, modelTried: {}, modelOther: false };

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
  async function loadRefs() { state.refs = ((await dbDo('readonly', s => s.getAll(), REFS)) || []).sort((a, b) => b.ts - a.ts); state.refsLoaded = true; }
  const putRef = r => dbDo('readwrite', s => s.put(r), REFS);
  const refLabel = r => { const auto = /^Reference \d+$/.test(r.name); return r.description ? (auto ? r.description : `${r.name}: ${r.description}`) : (auto ? '' : r.name); };
  async function addRef(dataUrl, name) {
    const image = await normalizeImg(dataUrl);
    const rec = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), name: name || `Reference ${state.refs.length + 1}`, description: '', negative: '', mode: 'both', image, thumb: await makeThumb(image, 200) };
    await putRef(rec); state.refs.unshift(rec); return rec;
  }
  async function addTextRef() {
    const rec = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), name: `Reference ${state.refs.length + 1}`, description: '', negative: '', mode: 'text', image: '', thumb: '' };
    await putRef(rec); state.refs.unshift(rec); return rec;
  }
  const thumbHtml = (r, cls = '') => r.thumb ? `<img class="${cls}" src="${r.thumb}" alt="">` : `<div class="is-noimg ${cls}">T</div>`;
  const modeSelect = (r) => { const m = modeOf(r), d = r.image ? '' : ' disabled'; return `<select data-act="ref-mode"${d}><option value="both"${m === 'both' ? ' selected' : ''}>Image + text</option><option value="image"${m === 'image' ? ' selected' : ''}>Image only</option><option value="text"${m === 'text' ? ' selected' : ''}>Text only</option></select>`; };
  function slotAdd(id) {
    const s = S(); if (s.refSlots.includes(id)) return true;
    if (s.refSlots.length >= MAX_REFS) { toast('warning', `Up to ${MAX_REFS} references per image.`); return false; }
    s.refSlots.push(id); save(); renderSlots(); return true;
  }
  async function buildRefs(fmt, max) {
    if (!state.refsLoaded) await loadRefs();
    const list = chars().filter(c => c.mode !== 'text'), used = list.slice(0, Math.min(max, MAX_REFS));
    if (list.length > used.length) toast('warning', `This model takes ${used.length} reference image(s); using the first ${used.length}.`);
    const out = used.map(c => ({ image: fmt === 'dataUrl' ? c.r.image : c.r.image.split(',')[1], description: c.name, source: 'image-studio' }));
    out.names = used.map(c => c.name);
    return out;
  }
  const isAuto = n => !String(n || '').trim() || /^Reference \d+$/.test(String(n).trim());
  const nameRe = n => new RegExp('(^|[^\\p{L}\\p{N}_])' + n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'iu');
  const mentioned = (text, name) => nameRe(name).test(text || '');
  const modeOf = r => (r.image ? (r.mode || 'both') : 'text'); // 'both' | 'image' | 'text'
  const chars = () => S().refSlots.map(id => state.refs.find(r => r.id === id)).filter(Boolean).map(r => ({ r, mode: modeOf(r), name: isAuto(r.name) ? '' : r.name.trim() }));
  // Text references: the character's prompt is written in after the first mention of the name (or listed at the end).
  function expandChars(prompt, list) {
    let out = prompt; const extra = [];
    for (const c of list) {
      if (c.mode === 'image') continue;
      const txt = String(c.r.description || '').replace(/\s+/g, ' ').trim(); if (!txt) continue;
      if (c.name && mentioned(out, c.name)) out = out.replace(nameRe(c.name), (m, pre) => `${pre}${c.name} (${txt})`);
      else extra.push(c.name ? `${c.name}: ${txt}` : txt);
    }
    return extra.length ? `${out}${out ? '\n\n' : ''}Character details: ${extra.join('; ')}.` : out;
  }
  function buildFinal() {
    const s = S(), base = resolve(s.prompt), list = s.useRefs ? chars() : [];
    const negs = list.filter(c => c.mode !== 'image').map(c => String(c.r.negative || '').trim()).filter(Boolean);
    return { base, list, prompt: expandChars(base, list), neg: [resolve(s.negative), ...negs].filter(Boolean).join(', ') };
  }
  const slotRefs = () => S().refSlots.map(id => state.refs.find(r => r.id === id)).filter(Boolean);
  const refBlock = refs => {
    const parts = (refs.names || []).map((n, i) => n ? `image ${i + 1} is ${n}` : '').filter(Boolean);
    return parts.length ? `Characters in the reference images: ${parts.join('; ')}. Wherever the prompt mentions one of these names, draw that character exactly as shown in their reference image.` : '';
  };
  function renderChips() {
    const el = $('#is_chips'); if (!el) return;
    const s = S(), names = slotRefs().map(r => r.name.trim()).filter(n => !isAuto(n));
    el.innerHTML = names.length ? '<span class="is-hint" style="margin:0">Tap to insert:</span>' + names.map(n => `<button class="is-chip ${mentioned(s.prompt, n) ? 'used' : ''}" data-act="chip" data-name="${esc(n)}">${esc(n)}</button>`).join('') : '';
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
    renderChips(); renderPreview();
  }
  function renderRefs() {
    const el = $('#is_refs'); if (!el) return;
    el.innerHTML = state.refs.length ? state.refs.map(r => `<div class="is-ref" data-id="${r.id}" data-rid="${r.id}">${thumbHtml(r)}
      <div class="is-ref-f"><input type="text" data-act="ref-name" value="${esc(r.name)}" placeholder="Name used in prompts, e.g. personA">
      ${modeSelect(r)}
      <textarea data-act="ref-desc" placeholder="Text prompt for this character (looks, outfit, tags…)">${esc(r.description || '')}</textarea>
      <textarea data-act="ref-neg" placeholder="Negative for this character">${esc(r.negative || '')}</textarea>
      <div class="is-row"><button class="is-btn full" data-act="ref-slot">Use in prompt</button><button class="is-btn" data-act="ref-del" title="Delete">🗑</button></div></div></div>`).join('')
      : '<div class="is-empty">No references yet. Upload a character image, or add a text-only character.</div>';
  }
  function openPicker() {
    const s = S(), free = state.refs.filter(r => !s.refSlots.includes(r.id));
    $('#is_lb').innerHTML = `<div class="is-hint">Choose a reference (${s.refSlots.length}/${MAX_REFS} in use)</div>`
      + (free.length ? `<div class="is-pickgrid">${free.map(r => `<div class="is-pickitem" data-pick="${r.id}">${thumbHtml(r)}<div>${esc(r.name)}</div></div>`).join('')}</div>` : '<div class="is-empty">No unused references. Upload a new one.</div>')
      + '<div class="is-row"><button class="is-btn pri full" data-act="pick-upload">Upload new</button><button class="is-btn full" data-act="lb-close">Cancel</button></div>';
    $('#is_lb').classList.add('on');
  }
  async function handleFiles(inp) {
    const files = [...inp.files]; inp.value = ''; let n = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try { const rec = await addRef(await readFile(f), f.name.replace(/\.[^.]+$/, '').slice(0, 40)); n++; if (state.toSlot) slotAdd(rec.id); } catch (e) { toast('error', `Could not read ${f.name}`); }
    }
    state.toSlot = false; $('#is_lb').classList.remove('on'); renderRefs(); renderSlots(); if (n) toast('success', `Added ${n} reference(s).`);
  }
  async function imageToRef(url) { const rec = await addRef(url, 'Generated'); const ok = S().refSlots.length < MAX_REFS && slotAdd(rec.id); renderRefs(); toast('success', ok ? 'Added as reference (IMAGE slot).' : 'Added to references.'); }

  /* ---------- Prompt variables ---------- */
  const TAG = /(?<!\{)\{([\w-]+)\}(?!\})/g;
  function syncVars() {
    const s = S(); const found = new Set();
    for (const t of [s.prompt, s.negative]) for (const m of (t || '').matchAll(TAG)) found.add(m[1]);
    for (const n of found) if (!s.vars.some(v => v.name.toLowerCase() === n.toLowerCase())) s.vars.push({ name: n, value: '', options: [] });
    return found;
  }
  function resolve(text) {
    const s = S();
    let out = (text || '').replace(TAG, (m, n) => { const v = s.vars.find(x => x.name.toLowerCase() === n.toLowerCase()); return v ? v.value.trim() : m; });
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
    const refs = S().useRefs && S().refSlots.length ? await buildRefs('base64', /2\.5/.test(g.model) ? 3 : MAX_REFS) : [];
    const rb = refBlock(refs); if (rb) text += '\n\n' + rb;
    const parts = [];
    refs.forEach((r, i) => { if (r.description) parts.push({ text: `IMAGE_${i + 1}: ${r.description}` }); parts.push({ inlineData: { mimeType: 'image/png', data: r.image } }); });
    if (refs.length) parts.push({ text: REF_INSTR });
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
    const { base, prompt, neg, list } = buildFinal();
    if (!base) return toast('warning', 'Main prompt is empty.');
    const imgs = list.filter(c => c.mode !== 'text');
    { const miss = imgs.map(c => c.name).filter(n => n && !mentioned(base, n)); if (miss.length) toast('info', `${miss.join(', ')} not in the prompt — the model may ignore ${miss.length > 1 ? 'those references' : 'that reference'}.`); }
    if (s.engine === 'standalone' && s.api === 'novelai' && imgs.length) toast('info', 'NovelAI can’t take reference images; text references are still applied.');
    state.busy = true; state.abort = new AbortController(); renderResult();
    try {
      const sig = state.abort.signal;
      const url = s.engine !== 'standalone' ? await genExt(prompt, neg, sig) : s.api === 'novelai' ? await genNovelAI(prompt, neg, sig) : await genGemini(prompt, neg, sig);
      state.last = { url, prompt, neg, saved: false };
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
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(),
      image: l.url, thumb: await makeThumb(l.url), template: s.prompt, negative: s.negative, vars,
      resolved: l.prompt, resolvedNeg: l.neg, refIds: s.useRefs ? [...s.refSlots] : [], engine: s.engine, api: s.api, profile: s.profiles[s.engine] || '', modelRaw: rawModel(),
      model: modelLabel(),
    });
    l.saved = true; renderResult(); if (!quiet) toast('success', 'Saved to library.');
    if (S().tab === 'library') renderLibrary();
  }


  /* ---------- Generator extensions (engine) → connection profile → model ---------- */
  const EXTS = { sillyimages: { label: 'sillyimages', match: m => /sillyimages/i.test(m.homePage || '') || m.display_name === 'Inline Image Generation' } };
  const GEMINI_MODELS = [['gemini-2.5-flash-image', 'Nano Banana (2.5 Flash Image)'], ['gemini-3-pro-image-preview', 'Nano Banana Pro (3 Pro Image)'], ['gemini-3.1-flash-image-preview', 'Nano Banana 2 (3.1 Flash Image)']];
  const NAISTERA_MODELS = [['nano banana', 'Nano Banana'], ['nano banana pro', 'Nano Banana Pro'], ['nano banana 2', 'Nano Banana 2'], ['grok', 'Grok']];
  const NAI_MODELS = [['nai-diffusion-4-5-full', 'NovelAI V4.5 Full'], ['nai-diffusion-4-5-curated', 'NovelAI V4.5 Curated'], ['nai-diffusion-4-full', 'NovelAI V4 Full']];
  const STATIC_TYPES = ['novelai', 'gemini', 'naistera'];
  const extCache = {}; let discovered;
  async function loadExt(id, force = false) {
    if (force) { discovered = undefined; delete extCache[id]; }
    if (extCache[id] !== undefined) return extCache[id];
    extCache[id] = null;
    try {
      discovered = discovered || await (await fetch('/api/extensions/discover')).json();
      for (const e of discovered) {
        if (!e?.name || e.type === 'system') continue;
        const base = `/scripts/extensions/${e.name}`;
        let m; try { m = await (await fetch(`${base}/manifest.json`)).json(); } catch { continue; }
        if (!EXTS[id].match(m)) continue;
        const [prov, set] = await Promise.all([import(/* @vite-ignore */ `${base}/src/providers.js`), import(/* @vite-ignore */ `${base}/src/settings.js`)]);
        let nai = null; try { nai = await import(/* @vite-ignore */ `${base}/src/novelai.js`); } catch { /* optional */ }
        if (prov.resolveActiveProvider && set.getSettings) { extCache[id] = { id, prov, set, nai, name: e.name }; break; }
      }
    } catch (e) { console.warn('[Image Studio] extension lookup failed', id, e); }
    return extCache[id];
  }
  const loadSI = (force) => loadExt('sillyimages', force);
  const mkey = () => { const s = S(); return `${s.engine}:${s.profiles[s.engine] || ''}`; };
  const getProfile = (ext, st) => (st.connectionProfiles || []).find(p => p.id === S().profiles[ext.id]);

  // Temporarily load the chosen profile (connection) + Studio's own model into the extension's live settings. Returns a restore fn.
  function applyConn(ext, st, modelOverride) {
    const backup = ext.set.extractConnectionFields(st), profile = getProfile(ext, st);
    if (profile) for (const k of ext.set.CONNECTION_FIELDS) if (k in profile) st[k] = profile[k];
    const m = String(modelOverride ?? S().models[mkey()] ?? '').trim();
    if (m) { if (st.apiType === 'naistera') st.naisteraModel = m; else st.model = m; }
    return () => Object.assign(st, backup);
  }

  async function genExt(prompt, neg, signal) {
    const s = S(), ext = await loadExt(s.engine);
    if (!ext) throw new Error(`${EXTS[s.engine]?.label || 'Generator extension'} not found. Install it or switch to Standalone.`);
    const st = ext.set.getSettings(), restore = applyConn(ext, st);
    try {
      const provider = ext.prov.resolveActiveProvider(st);
      if (!provider) throw new Error(`Unknown API type in profile: ${st.apiType}`);
      const errs = provider.validate(st);
      if (errs.length) throw new Error(errs.join('; '));
      let text = neg && !provider.supportsNegativePrompt(st) ? `${prompt}\n\nAvoid: ${neg}` : prompt;
      let references = [];
      if (s.useRefs && chars().some(c => c.mode !== 'text')) {
        const max = Math.min(MAX_REFS, ext.prov.getActiveProviderMaxReferences?.(st) || 0);
        if (max > 0 && provider.supportsReferences(st)) references = await buildRefs(provider.capabilities?.referencesFormat === 'dataUrl' ? 'dataUrl' : 'base64', max);
        else toast('info', 'This model does not accept reference images, so they were skipped.');
      }
      const rb = refBlock(references); if (rb) text += '\n\n' + rb;
      const options = { signal, negativePrompt: neg, matchedAdditionalRefs: [], characterDescriptionPromptBlock: '' };
      if (s.aspectOverride) options.aspectRatio = s.aspectOverride;
      const out = await provider.generate({ prompt: text, style: '', references, options });
      if (typeof out !== 'string') throw new Error('Provider returned a video/non-image result.');
      return out;
    } finally { restore(); }
  }

  async function fetchProfileModels(silent = false) {
    const s = S(), ext = await loadExt(s.engine); if (!ext) return;
    const k = mkey(); state.modelTried[k] = true;
    const st = ext.set.getSettings(), restore = applyConn(ext, st, '');
    try { const list = await ext.prov.resolveActiveProvider(st).fetchModels(); state.modelCache[k] = list; if (!silent) toast('success', `${list.length} model(s) found.`); }
    catch (e) { if (!silent) toast('error', 'Could not fetch models: ' + (e.message || e)); } finally { restore(); }
    renderConn();
  }
  const setModel = (v) => { const s = S(); if (s.engine === 'standalone') s[s.api].model = v; else s.models[mkey()] = v; save(); };
  function modelOptions(ext, type) {
    const s = S(); let base = [];
    if (s.engine === 'standalone') base = s.api === 'novelai' ? NAI_MODELS : GEMINI_MODELS;
    else if (type === 'novelai') base = Object.entries(ext.nai?.NOVELAI_MODELS || {}).length ? Object.entries(ext.nai.NOVELAI_MODELS) : NAI_MODELS;
    else if (type === 'gemini') base = GEMINI_MODELS;
    else if (type === 'naistera') base = NAISTERA_MODELS;
    const seen = new Set(base.map(x => x[0]));
    for (const id of state.modelCache[mkey()] || []) if (!seen.has(id)) { seen.add(id); base = [...base, [id, id]]; }
    return base;
  }

  const rawModel = () => { const s = S(); return s.engine === 'standalone' ? s[s.api].model : (s.models[mkey()] || ''); };
  const modelLabel = () => { const s = S(), m = rawModel(); const c = $('#is_conn')?.selectedOptions?.[0]?.textContent || s.engine; return `${c} · ${m || 'profile model'}`; };

  async function renderConn() {
    const eng = $('#is_engine'); if (!eng) return;
    const s = S(), ids = Object.keys(EXTS);
    await Promise.all(ids.map(id => loadExt(id)));
    eng.innerHTML = ids.map(id => `<option value="${id}">${EXTS[id].label}${extCache[id] ? '' : ' (not found)'}</option>`).join('') + '<option value="standalone">Standalone (own connection)</option>';
    eng.value = s.engine;
    const conn = $('#is_conn'), model = $('#is_model'), custom = $('#is_model_custom'), hint = $('#is_sihint');
    let opts = [], defLabel = '';
    if (s.engine === 'standalone') {
      conn.innerHTML = '<option value="gemini">Gemini / nano banana proxy</option><option value="novelai">NovelAI (SillyTavern key)</option>';
      conn.value = s.api; opts = modelOptions(null, s.api);
      hint.textContent = 'Standalone uses the endpoint and key from the Setup tab.';
    } else {
      const ext = extCache[s.engine];
      if (!ext) { conn.innerHTML = '<option value="">Extension not found</option>'; model.innerHTML = ''; custom.style.display = 'none'; hint.textContent = `${EXTS[s.engine].label} is not installed or could not be loaded. Pick Standalone instead.`; return; }
      const st = ext.set.getSettings(), ps = st.connectionProfiles || [];
      conn.innerHTML = ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.apiType)})</option>`).join('') || '<option value="">No profiles</option>';
      if (!ps.some(p => p.id === s.profiles[s.engine])) { s.profiles[s.engine] = st.activeConnectionProfileId || ps[0]?.id || ''; save(); }
      conn.value = s.profiles[s.engine];
      const prof = ps.find(p => p.id === conn.value), type = prof?.apiType;
      defLabel = `Profile's model: ${(type === 'naistera' ? prof?.naisteraModel : prof?.model) || 'not set'}`;
      opts = modelOptions(ext, type);
      if (prof && !STATIC_TYPES.includes(type) && !state.modelTried[mkey()]) fetchProfileModels(true); // auto-load list for proxies / OpenAI-style APIs
      hint.textContent = 'The profile supplies endpoint, key and API type. The model chosen here is used only by Image Studio.';
    }
    const cur = rawModel(), known = opts.map(o => o[0]);
    const isCustom = state.modelOther || (cur && !known.includes(cur));
    model.innerHTML = (s.engine === 'standalone' ? '' : `<option value="">${esc(defLabel)}</option>`)
      + opts.map(([id, l]) => `<option value="${esc(id)}">${esc(l)}</option>`).join('') + '<option value="__other__">Other…</option>';
    model.value = isCustom ? '__other__' : cur;
    custom.style.display = isCustom ? '' : 'none'; custom.value = isCustom ? cur : '';
  }

  /* ---------- Rendering ---------- */
  function renderVars() {
    const s = S(), used = syncVars(), usedLower = new Set([...used].map(x => x.toLowerCase()));
    $('#is_vars').innerHTML = s.vars.map((v, i) => `
      <div class="is-var ${usedLower.has(v.name.toLowerCase()) ? '' : 'unused'}" data-i="${i}">
        <div class="is-var-h"><span>{${esc(v.name)}}</span><button class="is-ib" data-act="var-del" title="Remove variable">🗑</button></div>
        <input type="text" data-act="var-val" value="${esc(v.value)}" placeholder="value for {${esc(v.name)}}">
        <div class="is-row">
          <select data-act="var-pick"><option value="">Saved options…</option>${v.options.map((o, k) => `<option value="${k}">${esc(o)}</option>`).join('')}</select>
          <button class="is-ib" data-act="var-save" title="Save current value as option">★</button>
          <button class="is-ib" data-act="var-rm" title="Delete selected option">−</button>
        </div>
      </div>`).join('') || '<div class="is-hint">Type {style} (or any {name}) in the main prompt to create a variable.</div>';
    renderPreview();
  }
  function renderPreview() { const el = $('#is_prev'); if (!el) return; const f = buildFinal(); el.textContent = f.prompt + (f.neg ? `\n\n— Negative —\n${f.neg}` : ''); }

  function renderResult() {
    const el = $('#is_result'), l = state.last;
    $('#is_gen').innerHTML = state.busy ? '<span class="is-spin"></span>Generating… tap to cancel' : 'Generate';
    if (state.busy) { el.innerHTML = ''; return; }
    el.innerHTML = l ? `<img src="${l.url}" alt="Generated image">
      <div class="is-row"><button class="is-btn full" data-act="save" ${l.saved ? 'disabled' : ''}>${l.saved ? 'Saved' : 'Save to library'}</button>
      <button class="is-btn full" data-act="dl-last">Download</button></div>
      <div class="is-row" style="margin-top:6px"><button class="is-btn full" data-act="res-ref">Use as reference</button></div>` : '';
  }

  async function renderLibrary() {
    const items = (await libAll()).filter(i => !state.libFilter || (i.resolved + ' ' + i.template).toLowerCase().includes(state.libFilter));
    $('#is_lib').innerHTML = items.length ? items.map(i => `<div class="is-card" data-id="${i.id}"><img loading="lazy" src="${i.thumb}" alt=""><div>${esc(i.resolved)}</div></div>`).join('')
      : '<div class="is-empty" style="grid-column:1/-1">No saved images yet. Generate one and tap “Save to library”.</div>';
  }

  async function openLightbox(id) {
    const it = (await libAll()).find(x => x.id === id); if (!it) return;
    state.lbId = id;
    $('#is_lb').innerHTML = `<img src="${it.image}" alt=""><pre>${esc(it.template)}\n\n→ ${esc(it.resolved)}</pre>
      <div class="is-hint">${esc(it.model)} · ${new Date(it.ts).toLocaleString()}</div>
      <div class="is-row"><button class="is-btn pri full" data-act="lb-use">Use this prompt</button><button class="is-btn full" data-act="lb-dl">Download</button></div>
      <div class="is-row"><button class="is-btn full" data-act="lb-ref">Use as reference</button></div>
      <div class="is-row"><button class="is-btn full" data-act="lb-del">Delete</button><button class="is-btn full" data-act="lb-close">Close</button></div>`;
    $('#is_lb').classList.add('on');
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
    $$('[data-show]', p).forEach(e => { const k = e.dataset.show; const on = k === 'ext' ? s.engine !== 'standalone' : (s.engine === 'standalone' && (k === 'standalone' || s.api === k)); e.style.display = on ? '' : 'none'; });
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
    <div id="is_panel" class="is-hidden">
      <div class="is-head">
        <span class="is-title">Image Studio</span>
        <div class="is-op-wrap" title="Panel opacity"><span>◐</span><input type="range" id="is_op" min="25" max="100"></div>
        <button class="is-ib" id="is_min" title="Collapse">▾</button><button class="is-ib" id="is_close" title="Close">✕</button>
      </div>
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
          <div class="is-hint">Name each character, then write the names in your prompt: “personA kissing personB”. Each can be sent as <b>image + text</b>, <b>image only</b> or <b>text only</b>; the text prompt is written in after the name and the negative is added to the negative prompt. NovelAI ignores images but uses the text.</div>
          <details style="margin-top:10px"><summary class="is-hint" style="cursor:pointer">Final prompt preview</summary><pre id="is_prev" style="white-space:pre-wrap;font-size:12px"></pre></details>
          <button id="is_gen" class="is-btn pri full" style="margin-top:12px" data-act="gen">Generate</button>
          <div id="is_result" class="is-result"></div>
        </section>
        <section class="is-sec" data-tab="library">
          <input type="text" id="is_search" placeholder="Search saved prompts">
          <div id="is_lib" class="is-lib"></div>
        </section>
        <section class="is-sec" data-tab="refs">
          <div class="is-hint">Saved characters and subjects. Pick up to 4 per image from the Create tab.</div>
          <button class="is-btn pri full" data-act="ref-upload">Upload images</button>
          <button class="is-btn full" style="margin-top:6px" data-act="ref-text-new">＋ New text-only character</button>
          <div id="is_refs" style="margin-top:8px"></div>
          <input type="file" id="is_file" accept="image/*" multiple hidden>
        </section>
        <section class="is-sec" data-tab="setup">
          <div data-show="ext">
            <div class="is-hint">Endpoint, key and API type come from the extension profile you pick on the Create tab. Nothing to enter here.</div>
            <button class="is-btn full" data-act="si-styles">Import the extension's styles as {style} options</button>
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
          <label class="is-l"><input type="checkbox" data-k="autosave"> Auto-save every result to library</label>
          <label class="is-l"><input type="checkbox" data-k="showButton"> Show floating 🎨 button <span class="is-hint">(if hidden, open from the wand menu or Extensions settings)</span></label>
          <button class="is-btn full" style="margin-top:8px" data-act="reset-pos">Reset button &amp; window position</button>
        </section>
      </div>
      <div id="is_lb" class="is-lb"></div>
    </div>`);
    const p = $('#is_panel');

    $('#is_fab').addEventListener('click', e => { if (e.currentTarget._dragged) return; toggle(); });
    $('#is_close').addEventListener('click', () => p.classList.add('is-hidden'));
    $('#is_min').addEventListener('click', () => { const s = S(); s.minimized = !s.minimized; save(); applyUI(); });
    $('#is_op').addEventListener('input', e => { const s = S(); s.opacity = e.target.value / 100; p.style.setProperty('--is-op', s.opacity); save(); });
    $('#is_search').addEventListener('input', e => { state.libFilter = e.target.value.toLowerCase(); renderLibrary(); });

    p.addEventListener('click', async (e) => {
      const tab = e.target.closest('.is-tab'); if (tab) { const s = S(); s.tab = tab.dataset.tab; save(); applyUI(); if (s.tab === 'library') renderLibrary(); if (s.tab === 'refs') renderRefs(); if (s.tab === 'setup') renderImport(); return; }
      const pk = e.target.closest('[data-pick]'); if (pk) { slotAdd(pk.dataset.pick); $('#is_lb').classList.remove('on'); return; }
      const card = e.target.closest('.is-card'); if (card) return openLightbox(card.dataset.id);
      const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
      const s = S(), vi = b.closest('.is-var')?.dataset.i, v = vi !== undefined ? s.vars[vi] : null;
      switch (b.dataset.act) {
        case 'gen': return generate();
        case 'save': return saveLast();
        case 'dl-last': return download(state.last.url, `image-studio-${Date.now()}.png`);
        case 'var-add': { const n = $('#is_newvar').value.trim().replace(/[^\w-]/g, ''); if (n && !s.vars.some(x => x.name.toLowerCase() === n.toLowerCase())) { s.vars.push({ name: n, value: '', options: [] }); $('#is_newvar').value = ''; save(); renderVars(); } return; }
        case 'var-del': s.vars.splice(vi, 1); save(); return renderVars();
        case 'var-save': if (v.value.trim() && !v.options.includes(v.value.trim())) { v.options.push(v.value.trim()); save(); renderVars(); } return;
        case 'var-rm': { const k = b.closest('.is-var').querySelector('select').value; if (k !== '') { v.options.splice(+k, 1); save(); renderVars(); } return; }
        case 'import': { const c = JSON.parse($('#is_import').dataset.list)[$('#is_imp_sel').value]; if (c) { s.gemini.endpoint = c.endpoint; s.gemini.key = c.key; if (c.model) s.gemini.model = c.model; s.engine = 'standalone'; s.api = 'gemini'; save(); applyUI(); renderConn(); toast('success', `Imported from ${c.name}.`); } return; }
        case 'si-refresh': for (const id of Object.keys(EXTS)) await loadExt(id, true); await renderConn(); return toast('info', 'Rescanned.');
        case 'model-fetch': return fetchProfileModels(false);
        case 'si-styles': {
          const si = await loadExt(s.engine === 'standalone' ? 'sillyimages' : s.engine); if (!si) return toast('error', 'Generator extension not found.');
          const list = (si.set.getSettings().styles || []).filter(x => x.value);
          if (!list.length) return toast('info', 'No styles saved in sillyimages.');
          let sv = s.vars.find(x => x.name.toLowerCase() === 'style'); if (!sv) { sv = { name: 'style', value: '', options: [] }; s.vars.push(sv); }
          list.forEach(x => { if (!sv.options.includes(x.value)) sv.options.push(x.value); });
          save(); renderVars(); return toast('success', `Imported ${list.length} style(s) into {style}.`);
        }
        case 'slot-add': return openPicker();
        case 'ref-text-new': { await addTextRef(); renderRefs(); return toast('success', 'Text-only character added. Give it a name and prompt.'); }
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
        case 'ref-slot': { if (slotAdd(b.closest('.is-ref').dataset.id)) toast('success', 'Added to this generation.'); return; }
        case 'ref-del': { const id = b.closest('.is-ref').dataset.id; if (confirm('Delete this reference?')) { await dbDo('readwrite', st => st.delete(id), REFS); state.refs = state.refs.filter(r => r.id !== id); s.refSlots = s.refSlots.filter(x => x !== id); save(); renderRefs(); renderSlots(); } return; }
        case 'res-ref': return imageToRef(state.last.url);
        case 'lb-ref': { const it = (await libAll()).find(x => x.id === state.lbId); if (it) { await imageToRef(it.image); $('#is_lb').classList.remove('on'); } return; }
        case 'lb-close': return $('#is_lb').classList.remove('on');
        case 'lb-dl': { const it = (await libAll()).find(x => x.id === state.lbId); if (it) download(it.image, `image-studio-${it.id}.png`); return; }
        case 'lb-del': if (confirm('Delete this image from the library?')) { await libDel(state.lbId); $('#is_lb').classList.remove('on'); renderLibrary(); } return;
        case 'lb-use': {
          const it = (await libAll()).find(x => x.id === state.lbId); if (!it) return;
          s.prompt = it.template; s.negative = it.negative;
          if (it.engine) { s.engine = it.engine; s.api = it.api || s.api; if (it.profile) s.profiles[it.engine] = it.profile; if (it.engine === 'standalone') s[s.api].model = it.modelRaw || s[s.api].model; else if (it.profile) s.models[`${it.engine}:${it.profile}`] = it.modelRaw || ''; }
          else if (it.provider) { s.engine = it.provider === 'sillyimages' ? 'sillyimages' : 'standalone'; if (it.provider !== 'sillyimages') s.api = it.provider; }
          s.vars = Object.entries(it.vars).map(([name, value]) => ({ options: [], ...(s.vars.find(x => x.name === name) || {}), name, value }));
          if (!state.refsLoaded) await loadRefs();
          s.refSlots = (it.refIds || []).filter(id => state.refs.some(r => r.id === id)).slice(0, MAX_REFS);
          if ((it.refIds || []).length > s.refSlots.length) toast('info', 'Some saved references no longer exist.');
          save(); $('#is_lb').classList.remove('on'); s.tab = 'create'; applyUI(); renderVars(); renderSlots(); renderConn(); return;
        }
      }
    });

    p.addEventListener('input', (e) => {
      const t = e.target, s = S();
      if (t.dataset.act === 'var-val') { s.vars[t.closest('.is-var').dataset.i].value = t.value; save(); return renderPreview(); }
      if (t.dataset.act === 'model-custom') { setModel(t.value.trim()); return; }
      if (t.dataset.act === 'slot-name') {
        const r = state.refs.find(x => x.id === s.refSlots[+t.closest('.is-slotrow').dataset.i]); if (!r) return;
        r.name = t.value.trim() || `Reference ${+t.closest('.is-slotrow').dataset.i + 1}`;
        clearTimeout(state.refT[r.id]); state.refT[r.id] = setTimeout(() => putRef(r), 400); renderChips(); return renderPreview();
      }
      if (['ref-name', 'ref-desc', 'ref-neg'].includes(t.dataset.act)) {
        const box = t.closest('[data-rid]'), id = box?.dataset.rid, r = state.refs.find(x => x.id === id); if (!r) return;
        r[{ 'ref-name': 'name', 'ref-desc': 'description', 'ref-neg': 'negative' }[t.dataset.act]] = t.value;
        const inRefs = box.classList.contains('is-ref');
        clearTimeout(state.refT[id]); state.refT[id] = setTimeout(() => { putRef(r); if (inRefs) renderSlots(); else { renderChips(); renderPreview(); } }, 400); return;
      }
      if (t.dataset.k) {
        let val = t.type === 'checkbox' ? t.checked : (t.hasAttribute('data-num') ? Number(t.value) : t.value);
        setPath(s, t.dataset.k, val); save();
        if (t.dataset.k === 'showButton') { applyUI(); if (!val) toast('info', 'Button hidden. Open Image Studio from the wand menu or Extensions settings.'); }
        if (t.dataset.k === 'prompt' || t.dataset.k === 'negative') { clearTimeout(build._t); build._t = setTimeout(renderVars, 400); renderChips(); }
      }
    });
    p.addEventListener('change', (e) => {
      const t = e.target, s = S();
      if (t.id === 'is_file') return handleFiles(t);
      if (t.dataset.act === 'engine') { s.engine = t.value; state.modelOther = false; save(); applyUI(); return renderConn(); }
      if (t.dataset.act === 'conn') { if (s.engine === 'standalone') s.api = t.value; else s.profiles[s.engine] = t.value; state.modelOther = false; save(); applyUI(); return renderConn(); }
      if (t.dataset.act === 'ref-mode') { const r = state.refs.find(x => x.id === t.closest('[data-rid]')?.dataset.rid); if (r) { r.mode = t.value; putRef(r); renderSlots(); renderRefs(); } return; }
      if (t.dataset.act === 'model') { if (t.value === '__other__') { state.modelOther = true; $('#is_model_custom').style.display = ''; return; } state.modelOther = false; setModel(t.value); return renderConn(); }
      if (t.dataset.act === 'var-pick' && t.value !== '') { const v = S().vars[t.closest('.is-var').dataset.i]; v.value = v.options[+t.value]; save(); renderVars(); }
    });
  }

  /* ---------- dragging (floating button + desktop window) ---------- */
  function dragify(el, handle, { skip, enabled, move, end }) {
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
      if (e.pointerId !== id) return; id = null;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (moving) { handle._dragged = true; setTimeout(() => { handle._dragged = false; }, 80); end(); }
      moving = false;
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
    if (!s.panelPos || !desk()) { Object.assign(p.style, { left: '', top: '', right: '', bottom: '', maxHeight: '' }); return; }
    const w = p.offsetWidth || Math.min(440, innerWidth - 28), x = clamp(s.panelPos.x, 4 - w + 120, innerWidth - 120), y = clamp(s.panelPos.y, 4, innerHeight - 56);
    Object.assign(p.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', maxHeight: (innerHeight - y - 8) + 'px' });
  }
  function setupDrag() {
    const f = $('#is_fab'), p = $('#is_panel');
    dragify(f, f, {
      move: (x, y) => { x = clamp(x, 4, innerWidth - f.offsetWidth - 4); y = clamp(y, 4, innerHeight - f.offsetHeight - 4); Object.assign(f.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' }); f._x = x; f._y = y; },
      end: () => { S().fabPos = { fx: f._x / Math.max(1, innerWidth - f.offsetWidth), fy: f._y / Math.max(1, innerHeight - f.offsetHeight) }; save(); },
    });
    dragify(p, $('.is-head', p), {
      skip: 'button,input,select', enabled: desk,
      move: (x, y) => { const w = p.offsetWidth; x = clamp(x, 4 - w + 120, innerWidth - 120); y = clamp(y, 4, innerHeight - 56); Object.assign(p.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', maxHeight: (innerHeight - y - 8) + 'px' }); p._x = x; p._y = y; },
      end: () => { S().panelPos = { x: p._x, y: p._y }; save(); },
    });
    f.addEventListener('click', e => { if (f._dragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    window.addEventListener('resize', () => { placeFab(); placePanel(); });
  }

  function toggle() { const p = $('#is_panel'); p.classList.toggle('is-hidden'); if (!p.classList.contains('is-hidden')) { placePanel(); applyUI(); renderVars(); renderResult(); renderConn(); renderSlots(); } }

  function mountMenus(tries = 0) {
    const menu = $('#extensionsMenu');
    if (menu && !$('#is_menu_item')) menu.insertAdjacentHTML('beforeend', '<div id="is_menu_item" class="list-group-item flex-container flexGap5 interactable" tabindex="0"><div class="fa-solid fa-palette extensionsMenuExtensionButton"></div><span>Image Studio</span></div>');
    $('#is_menu_item')?.addEventListener('click', () => { if ($('#is_panel').classList.contains('is-hidden')) toggle(); });
    const host = $('#extensions_settings2') || $('#extensions_settings');
    if (host && !$('#is_settings')) host.insertAdjacentHTML('beforeend', `<div id="is_settings" class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Image Studio</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input type="checkbox" id="is_show_btn"><span>Show floating button</span></label><div class="menu_button" id="is_open_btn">Open Image Studio</div></div></div>`);
    const sb = $('#is_show_btn'); if (sb && !sb.dataset.bound) { sb.dataset.bound = 1; sb.checked = S().showButton; sb.addEventListener('change', () => { S().showButton = sb.checked; save(); applyUI(); }); }
    $('#is_open_btn')?.addEventListener('click', () => { if ($('#is_panel').classList.contains('is-hidden')) toggle(); });
    if ((!menu || !host) && tries < 20) setTimeout(() => mountMenus(tries + 1), 500);
  }

  jQuery(() => { build(); setupDrag(); applyUI(); placeFab(); placePanel(); renderVars(); renderResult(); mountMenus(); loadRefs().then(() => { renderSlots(); renderRefs(); }); });
})();
