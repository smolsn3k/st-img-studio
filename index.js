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
    provider: 'sillyimages', siProfile: '', siAspect: '', refSlots: [], useRefs: true,
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
  const S = () => { const es = ctx().extensionSettings; es[MODULE] = es[MODULE] || {}; return fill(es[MODULE], DEFAULTS); };
  const save = () => ctx().saveSettingsDebounced();
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };

  const state = { last: null, busy: false, abort: null, libFilter: '', lbId: null, refs: [], refsLoaded: false, toSlot: false, refT: {} };

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
    const rec = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), name: name || `Reference ${state.refs.length + 1}`, description: '', image, thumb: await makeThumb(image, 200) };
    await putRef(rec); state.refs.unshift(rec); return rec;
  }
  function slotAdd(id) {
    const s = S(); if (s.refSlots.includes(id)) return true;
    if (s.refSlots.length >= MAX_REFS) { toast('warning', `Up to ${MAX_REFS} references per image.`); return false; }
    s.refSlots.push(id); save(); renderSlots(); return true;
  }
  async function buildRefs(fmt, max) {
    if (!state.refsLoaded) await loadRefs();
    const s = S(), ids = s.refSlots.slice(0, Math.min(max, MAX_REFS));
    if (s.refSlots.length > ids.length) toast('warning', `This model takes ${ids.length} reference(s); using the first ${ids.length}.`);
    return ids.map(id => state.refs.find(r => r.id === id)).filter(Boolean)
      .map(r => ({ image: fmt === 'dataUrl' ? r.image : r.image.split(',')[1], description: refLabel(r).replace(/\s+/g, ' ').trim(), source: 'image-studio' }));
  }
  function renderSlots() {
    const el = $('#is_slots'); if (!el) return;
    const s = S();
    if (state.refsLoaded) s.refSlots = s.refSlots.filter(id => state.refs.some(r => r.id === id));
    el.innerHTML = s.refSlots.map((id, i) => { const r = state.refs.find(x => x.id === id); if (!r) return ''; return `<div class="is-slot" data-i="${i}"><img src="${r.thumb}" alt=""><span class="is-tag">IMAGE_${i + 1}</span><span class="is-nm">${esc(r.name)}</span><button class="is-x" data-act="slot-rm" title="Remove">✕</button></div>`; }).join('')
      + (s.refSlots.length < MAX_REFS ? '<button class="is-slot is-add" data-act="slot-add" title="Add reference">＋</button>' : '');
    $('#is_refcount').textContent = `${s.refSlots.length}/${MAX_REFS}`;
  }
  function renderRefs() {
    const el = $('#is_refs'); if (!el) return;
    el.innerHTML = state.refs.length ? state.refs.map(r => `<div class="is-ref" data-id="${r.id}"><img src="${r.thumb}" alt="">
      <div class="is-ref-f"><input type="text" data-act="ref-name" value="${esc(r.name)}" placeholder="Name">
      <textarea data-act="ref-desc" placeholder="Appearance notes sent with the image (hair, eyes, outfit…)">${esc(r.description)}</textarea>
      <div class="is-row"><button class="is-btn full" data-act="ref-slot">Use in prompt</button><button class="is-btn" data-act="ref-del" title="Delete">🗑</button></div></div></div>`).join('')
      : '<div class="is-empty">No references yet. Upload a character image to reuse it in any generation.</div>';
  }
  function openPicker() {
    const s = S(), free = state.refs.filter(r => !s.refSlots.includes(r.id));
    $('#is_lb').innerHTML = `<div class="is-hint">Choose a reference (${s.refSlots.length}/${MAX_REFS} in use)</div>`
      + (free.length ? `<div class="is-pickgrid">${free.map(r => `<div class="is-pickitem" data-pick="${r.id}"><img src="${r.thumb}" alt=""><div>${esc(r.name)}</div></div>`).join('')}</div>` : '<div class="is-empty">No unused references. Upload a new one.</div>')
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
    const text = neg ? `${prompt}\n\nAvoid: ${neg}` : prompt;
    const refs = S().useRefs && S().refSlots.length ? await buildRefs('base64', /2\.5/.test(g.model) ? 3 : MAX_REFS) : [];
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
    const prompt = resolve(s.prompt), neg = resolve(s.negative);
    if (!prompt) return toast('warning', 'Main prompt is empty.');
    if (s.provider === 'novelai' && s.useRefs && s.refSlots.length) toast('info', 'NovelAI ignores reference images.');
    state.busy = true; state.abort = new AbortController(); renderResult();
    try {
      const sig = state.abort.signal;
      const url = s.provider === 'novelai' ? await genNovelAI(prompt, neg, sig) : s.provider === 'gemini' ? await genGemini(prompt, neg, sig) : await genSillyimages(prompt, neg, sig);
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
      resolved: l.prompt, resolvedNeg: l.neg, refIds: s.useRefs ? [...s.refSlots] : [], provider: s.provider,
      model: modelLabel(),
    });
    l.saved = true; renderResult(); if (!quiet) toast('success', 'Saved to library.');
    if (S().tab === 'library') renderLibrary();
  }


  /* ---------- sillyimages integration (reuses its providers + connection profiles) ---------- */
  let siCache;
  async function loadSI(force = false) {
    if (siCache !== undefined && !force) return siCache;
    siCache = null;
    try {
      const list = await (await fetch('/api/extensions/discover')).json();
      for (const e of list) {
        if (!e?.name || e.type === 'system') continue;
        const base = `/scripts/extensions/${e.name}`;
        let m; try { m = await (await fetch(`${base}/manifest.json`)).json(); } catch { continue; }
        if (!/sillyimages/i.test(m.homePage || '') && m.display_name !== 'Inline Image Generation') continue;
        const [prov, set] = await Promise.all([import(/* @vite-ignore */ `${base}/src/providers.js`), import(/* @vite-ignore */ `${base}/src/settings.js`)]);
        if (prov.resolveActiveProvider && set.getSettings) { siCache = { prov, set, name: e.name }; break; }
      }
    } catch (e) { console.warn('[Image Studio] sillyimages lookup failed', e); }
    return siCache;
  }

  async function genSillyimages(prompt, neg, signal) {
    const si = await loadSI();
    if (!si) throw new Error('sillyimages extension not found. Install it, or switch to a standalone model.');
    const st = si.set.getSettings();
    const profile = (st.connectionProfiles || []).find(p => p.id === S().siProfile);
    const backup = si.set.extractConnectionFields(st);
    try {
      // Temporarily load the chosen connection profile, then restore (nothing is saved).
      if (profile) for (const k of si.set.CONNECTION_FIELDS) if (k in profile) st[k] = profile[k];
      const provider = si.prov.resolveActiveProvider(st);
      if (!provider) throw new Error(`Unknown sillyimages API type: ${st.apiType}`);
      const errs = provider.validate(st);
      if (errs.length) throw new Error(errs.join('; '));
      const text = neg && !provider.supportsNegativePrompt(st) ? `${prompt}\n\nAvoid: ${neg}` : prompt;
      let references = [];
      if (S().useRefs && S().refSlots.length) {
        const max = Math.min(MAX_REFS, si.prov.getActiveProviderMaxReferences?.(st) || 0);
        if (max > 0 && provider.supportsReferences(st)) references = await buildRefs(provider.capabilities?.referencesFormat === 'dataUrl' ? 'dataUrl' : 'base64', max);
        else toast('info', 'This model does not accept reference images, so they were skipped.');
      }
      const options = { signal, negativePrompt: neg, matchedAdditionalRefs: [], characterDescriptionPromptBlock: '' };
      if (S().siAspect) options.aspectRatio = S().siAspect;
      const out = await provider.generate({ prompt: text, style: '', references, options });
      if (typeof out !== 'string') throw new Error('Provider returned a video/non-image result.');
      return out;
    } finally { Object.assign(st, backup); }
  }

  async function renderSI() {
    const sel = $('#is_siprof'); if (!sel) return;
    const si = await loadSI(), hint = $('#is_sihint'), s = S();
    if (!si) { sel.innerHTML = '<option value="">sillyimages not found</option>'; hint.textContent = 'sillyimages is not installed or could not be loaded. Use a standalone model instead.'; return; }
    const ps = si.set.getSettings().connectionProfiles || [];
    sel.innerHTML = ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.apiType)} · ${esc(p.model || '?')}</option>`).join('') || '<option value="">No profiles</option>';
    if (!ps.some(p => p.id === s.siProfile)) { s.siProfile = si.set.getSettings().activeConnectionProfileId || ps[0]?.id || ''; save(); }
    sel.value = s.siProfile;
    hint.textContent = 'Uses the endpoint, key and model from this sillyimages profile. Make one profile per model (e.g. “Nano Banana”, “NovelAI 4.5”) in sillyimages settings.';
  }

  const modelLabel = () => { const s = S(); if (s.provider === 'novelai') return s.novelai.model; if (s.provider === 'gemini') return s.gemini.model; return $('#is_siprof')?.selectedOptions?.[0]?.textContent || 'sillyimages'; };

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
  function renderPreview() { const s = S(); $('#is_prev').textContent = resolve(s.prompt) + (s.negative ? `\n\n— Negative —\n${resolve(s.negative)}` : ''); }

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
      <div class="is-hint">${esc(it.provider)} · ${esc(it.model)} · ${new Date(it.ts).toLocaleString()}</div>
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
    $$('.is-tab', p).forEach(t => t.classList.toggle('on', t.dataset.tab === s.tab));
    $$('.is-sec', p).forEach(t => t.classList.toggle('on', t.dataset.tab === s.tab));
    $$('.is-prov', p).forEach(e => e.style.display = e.dataset.prov === s.provider ? '' : 'none');
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
          <label class="is-l">Model</label>
          <select data-k="provider"><option value="sillyimages">sillyimages connection</option><option value="gemini">Nano Banana (standalone)</option><option value="novelai">NovelAI 4.5 (standalone)</option></select>
          <div class="is-prov" data-prov="sillyimages">
            <label class="is-l">sillyimages profile (model)</label><select id="is_siprof" data-k="siProfile"></select>
            <label class="is-l">Aspect ratio override (Gemini / nano banana only)</label>
            <select data-k="siAspect"><option value="">Use profile setting</option>${opt(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], '')}</select>
            <div class="is-hint" id="is_sihint"></div>
          </div>
          <label class="is-l">Main prompt — use {tags} for swappable parts</label>
          <textarea data-k="prompt" placeholder="1girl, {style}, standing in a forest"></textarea>
          <label class="is-l">Negative prompt</label>
          <textarea data-k="negative" style="min-height:56px"></textarea>
          <label class="is-l">Variables</label>
          <div id="is_vars"></div>
          <div class="is-row"><input type="text" id="is_newvar" placeholder="new variable name"><button class="is-btn" data-act="var-add">Add</button></div>
          <div class="is-row" style="justify-content:space-between;margin-top:12px"><span class="is-l" style="margin:0">Character references <b id="is_refcount"></b></span><label class="is-l" style="margin:0"><input type="checkbox" data-k="useRefs"> Send</label></div>
          <div id="is_slots" class="is-slots"></div>
          <div class="is-hint">Mention them in the prompt as IMAGE_1, IMAGE_2… Notes from the Refs tab are sent with each image. NovelAI ignores references.</div>
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
          <div id="is_refs" style="margin-top:8px"></div>
          <input type="file" id="is_file" accept="image/*" multiple hidden>
        </section>
        <section class="is-sec" data-tab="setup">
          <div class="is-prov" data-prov="sillyimages">
            <div class="is-hint">Connection, key and model come from sillyimages, so there is nothing to enter here.</div>
            <button class="is-btn full" data-act="si-styles">Import sillyimages styles as {style} options</button>
            <button class="is-btn full" style="margin-top:6px" data-act="si-refresh">Re-scan sillyimages profiles</button>
          </div>
          <label class="is-l">Copy settings from another image extension (standalone mode)</label><div id="is_import"></div>
          <div class="is-prov" data-prov="gemini">
            <label class="is-l">Endpoint (Google or proxy)</label><input type="text" data-k="gemini.endpoint">
            <label class="is-l">API key</label><input type="password" data-k="gemini.key" autocomplete="off">
            <label class="is-l">Model</label><input type="text" data-k="gemini.model" list="is_gm">
            <datalist id="is_gm"><option value="gemini-2.5-flash-image"><option value="gemini-3-pro-image-preview"></datalist>
            <div class="is-grid2"><div><label class="is-l">Aspect ratio</label><select data-k="gemini.aspect">${opt(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], '')}</select></div>
            <div><label class="is-l">Size (Pro models)</label><select data-k="gemini.size">${opt(['1K', '2K', '4K'], '')}</select></div></div>
          </div>
          <div class="is-prov" data-prov="novelai">
            <div class="is-hint">Uses the NovelAI key saved in SillyTavern (API Connections → NovelAI).</div>
            <label class="is-l">Model</label><select data-k="novelai.model">${opt(['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full'], '')}</select>
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
          <label class="is-l"><input type="checkbox" data-k="showButton"> Show floating 🎨 button</label>
        </section>
      </div>
      <div id="is_lb" class="is-lb"></div>
    </div>`);
    const p = $('#is_panel');

    $('#is_fab').addEventListener('click', toggle);
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
        case 'import': { const c = JSON.parse($('#is_import').dataset.list)[$('#is_imp_sel').value]; if (c) { s.gemini.endpoint = c.endpoint; s.gemini.key = c.key; if (c.model) s.gemini.model = c.model; s.provider = 'gemini'; save(); applyUI(); toast('success', `Imported from ${c.name}.`); } return; }
        case 'si-refresh': await loadSI(true); await renderSI(); return toast('info', 'Profiles refreshed.');
        case 'si-styles': {
          const si = await loadSI(); if (!si) return toast('error', 'sillyimages not found.');
          const list = (si.set.getSettings().styles || []).filter(x => x.value);
          if (!list.length) return toast('info', 'No styles saved in sillyimages.');
          let sv = s.vars.find(x => x.name.toLowerCase() === 'style'); if (!sv) { sv = { name: 'style', value: '', options: [] }; s.vars.push(sv); }
          list.forEach(x => { if (!sv.options.includes(x.value)) sv.options.push(x.value); });
          save(); renderVars(); return toast('success', `Imported ${list.length} style(s) into {style}.`);
        }
        case 'slot-add': return openPicker();
        case 'slot-rm': { s.refSlots.splice(+b.closest('.is-slot').dataset.i, 1); save(); return renderSlots(); }
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
          s.prompt = it.template; s.negative = it.negative; s.provider = it.provider;
          s.vars = Object.entries(it.vars).map(([name, value]) => ({ options: [], ...(s.vars.find(x => x.name === name) || {}), name, value }));
          if (!state.refsLoaded) await loadRefs();
          s.refSlots = (it.refIds || []).filter(id => state.refs.some(r => r.id === id)).slice(0, MAX_REFS);
          if ((it.refIds || []).length > s.refSlots.length) toast('info', 'Some saved references no longer exist.');
          save(); $('#is_lb').classList.remove('on'); s.tab = 'create'; applyUI(); renderVars(); renderSlots(); return;
        }
      }
    });

    p.addEventListener('input', (e) => {
      const t = e.target, s = S();
      if (t.dataset.act === 'var-val') { s.vars[t.closest('.is-var').dataset.i].value = t.value; save(); return renderPreview(); }
      if (t.dataset.act === 'ref-name' || t.dataset.act === 'ref-desc') {
        const id = t.closest('.is-ref').dataset.id, r = state.refs.find(x => x.id === id); if (!r) return;
        r[t.dataset.act === 'ref-name' ? 'name' : 'description'] = t.value;
        clearTimeout(state.refT[id]); state.refT[id] = setTimeout(() => { putRef(r); renderSlots(); }, 400); return;
      }
      if (t.dataset.k) {
        let val = t.type === 'checkbox' ? t.checked : (t.hasAttribute('data-num') ? Number(t.value) : t.value);
        setPath(s, t.dataset.k, val); save();
        if (t.dataset.k === 'prompt' || t.dataset.k === 'negative') { clearTimeout(build._t); build._t = setTimeout(renderVars, 400); }
        if (t.dataset.k === 'provider') { applyUI(); renderSI(); }
      }
    });
    p.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'is_file') return handleFiles(t);
      if (t.dataset.act === 'var-pick' && t.value !== '') { const v = S().vars[t.closest('.is-var').dataset.i]; v.value = v.options[+t.value]; save(); renderVars(); }
    });
  }

  function toggle() { const p = $('#is_panel'); p.classList.toggle('is-hidden'); if (!p.classList.contains('is-hidden')) { applyUI(); renderVars(); renderResult(); renderSI(); renderSlots(); } }

  function mountMenus(tries = 0) {
    const menu = $('#extensionsMenu');
    if (menu && !$('#is_menu_item')) menu.insertAdjacentHTML('beforeend', '<div id="is_menu_item" class="list-group-item flex-container flexGap5 interactable" tabindex="0"><div class="fa-solid fa-palette extensionsMenuExtensionButton"></div><span>Image Studio</span></div>');
    $('#is_menu_item')?.addEventListener('click', () => { if ($('#is_panel').classList.contains('is-hidden')) toggle(); });
    const host = $('#extensions_settings2') || $('#extensions_settings');
    if (host && !$('#is_settings')) host.insertAdjacentHTML('beforeend', `<div id="is_settings" class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Image Studio</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div class="menu_button" id="is_open_btn">Open Image Studio</div></div></div>`);
    $('#is_open_btn')?.addEventListener('click', () => { if ($('#is_panel').classList.contains('is-hidden')) toggle(); });
    if ((!menu || !host) && tries < 20) setTimeout(() => mountMenus(tries + 1), 500);
  }

  jQuery(() => { build(); applyUI(); renderVars(); renderResult(); mountMenus(); loadRefs().then(() => { renderSlots(); renderRefs(); }); });
})();
