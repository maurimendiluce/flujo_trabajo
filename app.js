(() => {
'use strict';

/* ---------- utilidades ---------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); }));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const debounce = (fn, ms) => {
  let t = null;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  f.flush = () => { if (t !== null) { clearTimeout(t); t = null; fn(); } };   // solo si hay un guardado pendiente
  return f;
};
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 4200);
}

/* ---------- markdown + LaTeX (KaTeX) ---------- */
// Las fórmulas se extraen ANTES de pasar por markdown (para que _ * \\ no se interpreten),
// se reemplazan por marcadores y se vuelven a insertar ya renderizadas, después de sanitizar.
function extractMath(md) {
  const maths = [];
  const stash = (raw, tex, display) => { maths.push({ raw, tex, display }); return `zzmathzz${maths.length - 1}zz`; };
  // no tocar bloques ni código en línea
  const parts = md.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g);
  const out = parts.map((seg, i) => {
    if (i % 2) return seg;
    return seg
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => stash(m, t.trim(), true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => stash(m, t.trim(), true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => stash(m, t.trim(), false))
      .replace(/\\begin\{(equation|align|gather|multline)(\*?)\}[\s\S]+?\\end\{\1\2\}/g, m => stash(m, m, true))
      // $...$ en línea: sin espacios pegados a los $, y el cierre no seguido de dígito ("$5 y $10" no es fórmula)
      .replace(/(?<![\\$])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/g, (m, t) => stash(m, t, false));
  });
  return { text: out.join(''), maths };
}

function renderMd(md, target) {
  if (!window.marked || !window.DOMPurify) { target.innerHTML = `<pre>${esc(md)}</pre>`; return; }
  const { text, maths } = extractMath(md || '');
  let html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: false }), { ADD_ATTR: ['target'] });
  html = html.replace(/zzmathzz(\d+)zz/g, (m, i) => {
    const x = maths[+i]; if (!x) return m;
    if (!window.katex) return esc(x.raw);
    try { return katex.renderToString(x.tex, { displayMode: x.display, throwOnError: false, output: 'htmlAndMathml' }); }
    catch { return esc(x.raw); }
  });
  target.innerHTML = html;
  $$('a[href]', target).forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  $$('pre', target).forEach(pre => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'copy-btn'; b.textContent = 'Copiar';
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText); b.textContent = '¡Copiado!'; }
      catch { b.textContent = 'No se pudo'; }
      setTimeout(() => b.textContent = 'Copiar', 1400);
    });
    pre.appendChild(b);
  });
}

/* ---------- capa de datos ---------- */
// Cada elemento: { id, kind: 'task'|'link'|'note'|'config'|'category', data: {...} }
const KINDS = ['task', 'link', 'note', 'config', 'category'];
const cfg = window.APP_CONFIG || {};
const useSB = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);   // modo nube configurado
let sb = null;
let items = [];
const LS_KEY = 'flujo-trabajo-v1';

let lsQueue = Promise.resolve();   // guardados locales en serie: evita que dos guardados superpuestos se pisen
const lsRun = fn => (lsQueue = lsQueue.then(fn, fn));
const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } };
const localAdapter = {
  async load() { return lsRead(); },
  save(it) {
    return lsRun(() => {
      const all = lsRead(); const i = all.findIndex(x => x.id === it.id);
      if (i >= 0) all[i] = it; else all.push(it);
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    });
  },
  del(id) { return lsRun(() => localStorage.setItem(LS_KEY, JSON.stringify(lsRead().filter(x => x.id !== id)))); },
  async replaceAll(arr) { return lsRun(() => localStorage.setItem(LS_KEY, JSON.stringify(arr))); },
};
const sbAdapter = {
  async load() {
    const { data, error } = await sb.from('flujo_items').select('id,kind,data').order('updated_at');
    if (error) throw error; return data || [];
  },
  async save(it) {
    const { error } = await sb.from('flujo_items').upsert({ id: it.id, kind: it.kind, data: it.data, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async del(id) { const { error } = await sb.from('flujo_items').delete().eq('id', id); if (error) throw error; },
  async replaceAll(arr) {
    const { error: e1 } = await sb.from('flujo_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (e1) throw e1;
    if (arr.length) { const { error } = await sb.from('flujo_items').insert(arr.map(a => ({ id: a.id, kind: a.kind, data: a.data }))); if (error) throw error; }
  },
};
const store = () => useSB ? sbAdapter : localAdapter;

const ofKind = k => items.filter(i => i.kind === k);
async function put(kind, data, id) {
  id = id || uid();
  const it = { id, kind, data };
  const i = items.findIndex(x => x.id === id);
  const prev = i >= 0 ? items[i] : null;
  if (i >= 0) items[i] = it; else items.push(it);
  try { await store().save(it); }
  catch (e) {
    console.error(e);
    if (prev) items[items.findIndex(x => x.id === id)] = prev; else items = items.filter(x => x.id !== id);
    toast('No se pudo guardar: ' + (e.message || e));
    throw e;
  }
  return it;
}
async function remove(id) {
  items = items.filter(x => x.id !== id);
  try { await store().del(id); } catch (e) { console.error(e); toast('No se pudo borrar: ' + (e.message || e)); }
}

/* ---------- categorías (con color) ---------- */
const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c'];
const HEX = /^#[0-9a-f]{6}$/i;
const cats = () => ofKind('category').sort((a, b) => a.data.name.localeCompare(b.data.name, 'es'));
const catById = id => id ? items.find(x => x.id === id && x.kind === 'category') : null;
const catColor = c => HEX.test(c?.data.color) ? c.data.color : '#64748b';
const catChip = id => { const c = catById(id); return c ? `<span class="chip" style="--c:${catColor(c)}">${esc(c.data.name)}</span>` : ''; };
const nextColor = () => { const used = new Set(cats().map(c => catColor(c).toLowerCase())); return PALETTE.find(p => !used.has(p)) || PALETTE[cats().length % PALETTE.length]; };
const usesCat = i => (i.kind === 'task' || i.kind === 'link');
const catUsage = id => items.filter(i => usesCat(i) && i.data.catId === id).length;
const catOptions = sel => `<option value="">Sin categoría</option>` +
  cats().map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.data.name)}</option>`).join('') +
  `<option value="__new">＋ Nueva categoría…</option>`;
const dupName = (name, exceptId) => cats().some(x => x.id !== exceptId && x.data.name.toLowerCase() === name.toLowerCase());

function fillCatSelects() {
  const s = $('#task-cat'); const v = s.value;
  s.innerHTML = catOptions(''); s.value = catById(v) ? v : '';
}

// Migración: las categorías antiguas eran texto (data.cat); ahora son elementos con color (data.catId)
async function migrateLegacyCats() {
  const legacy = items.filter(i => usesCat(i) && i.data.cat && !i.data.catId);
  if (!legacy.length) return;
  try {
    for (const it of legacy) {
      const name = it.data.cat.trim();
      let c = cats().find(x => x.data.name.toLowerCase() === name.toLowerCase());
      if (!c) c = await put('category', { name, color: nextColor() });
      const { cat, ...rest } = it.data;
      await put(it.kind, { ...rest, catId: c.id }, it.id);
    }
  } catch (e) {
    toast('No se pudieron migrar las categorías. ¿Ejecutaste supabase-update.sql?');
  }
}

let onCatsClose = null, lastNewCat = null;
function openCats(done) {
  onCatsClose = done || null; lastNewCat = null;
  renderCatManager(); $('#dlg-cats').showModal(); $('#cat-new-name').focus();
}
function renderCatManager() {
  $('#cat-manage').innerHTML = cats().map(c => `
    <li class="cat-row" data-id="${c.id}">
      <input type="color" value="${catColor(c)}" aria-label="Color de ${esc(c.data.name)}">
      <input class="cat-name" value="${esc(c.data.name)}" maxlength="40" aria-label="Nombre">
      <span class="muted small-text">${catUsage(c.id)} uso(s)</span>
      <button class="icon-btn" data-act="del" aria-label="Borrar categoría" title="Borrar">✕</button>
    </li>`).join('') || '<li class="empty small-text">Todavía no hay categorías.</li>';
  $('#cat-new-color').value = nextColor();
}
$('#cat-manage').addEventListener('change', async e => {
  const c = catById(e.target.closest('.cat-row')?.dataset.id); if (!c) return;
  try {
    if (e.target.type === 'color') await put('category', { ...c.data, color: e.target.value }, c.id);
    else if (e.target.classList.contains('cat-name')) {
      const name = e.target.value.trim();
      if (!name || dupName(name, c.id)) { toast(name ? 'Ya existe una categoría con ese nombre' : 'El nombre no puede estar vacío'); e.target.value = c.data.name; return; }
      await put('category', { ...c.data, name }, c.id);
    }
  } catch { /* put() ya avisó */ }
  renderCatManager(); route();
});
$('#cat-manage').addEventListener('click', async e => {
  const b = e.target.closest('[data-act=del]'); if (!b) return;
  const c = catById(b.closest('.cat-row').dataset.id); if (!c) return;
  const n = catUsage(c.id);
  if (!confirm(`¿Borrar la categoría "${c.data.name}"?${n ? ` ${n} elemento(s) quedarán sin categoría.` : ''}`)) return;
  for (const it of items.filter(i => usesCat(i) && i.data.catId === c.id)) await put(it.kind, { ...it.data, catId: '' }, it.id).catch(() => {});
  await remove(c.id); renderCatManager(); route();
});
$('#cat-add').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#cat-new-name').value.trim(); if (!name) return;
  if (dupName(name)) { toast('Ya existe una categoría con ese nombre'); return; }
  try { const it = await put('category', { name, color: $('#cat-new-color').value }); lastNewCat = it.id; } catch { return; }
  $('#cat-new-name').value = ''; renderCatManager(); route(); $('#cat-new-name').focus();
});
$('#cats-close').onclick = () => $('#dlg-cats').close();
$('#dlg-cats').addEventListener('close', () => { fillCatSelects(); const f = onCatsClose; onCatsClose = null; if (f) f(lastNewCat); });
$('#btn-cats-task').onclick = () => openCats();
$('#task-cat').addEventListener('change', e => {
  if (e.target.value !== '__new') return;
  e.target.value = '';
  openCats(newId => { if (newId) e.target.value = newId; });
});

/* ---------- diálogo genérico ---------- */
const dlg = $('#dlg');
function openEditor({ title, fields, onSave, onDelete }) {
  $('#dlg-title').textContent = title;
  $('#dlg-fields').innerHTML = fields.map(f => f.type === 'select'
    ? `<label>${esc(f.label)}<select name="${f.key}">${f.options.map(o => `<option value="${esc(o.v)}"${o.v === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`
    : f.type === 'textarea'
    ? `<label>${esc(f.label)}<textarea name="${f.key}" rows="6" maxlength="${f.max || 4000}">${esc(f.value ?? '')}</textarea></label>`
    : `<label>${esc(f.label)}
        <input name="${f.key}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} maxlength="${f.max || 200}">
      </label>`).join('');
  $('#dlg-del').hidden = !onDelete;
  $('#dlg-form').onsubmit = async e => {
    e.preventDefault();
    const vals = Object.fromEntries(new FormData($('#dlg-form')).entries());
    if (await onSave(vals) !== false) dlg.close();
  };
  $('#dlg-del').onclick = async () => { if (confirm('¿Borrar definitivamente?')) { await onDelete(); dlg.close(); } };
  $('#dlg-cancel').onclick = () => dlg.close();
  dlg.showModal();
  $('#dlg-fields input')?.focus();
}
const catFieldOptions = () => [{ v: '', label: 'Sin categoría' }, ...cats().map(c => ({ v: c.id, label: c.data.name }))];

/* ---------- Google Tasks (aparecen en Google Calendar) ---------- */
const GCLIENT = cfg.GOOGLE_CLIENT_ID || '';
const GAPI = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';
const G = { token: null, exp: 0, was: false, q: Promise.resolve() };
const gOn = () => !!(G.token && Date.now() < G.exp - 30000);

function updateGoogleUI() {
  const b = $('#btn-google');
  b.hidden = !GCLIENT;
  b.textContent = gOn() ? '✓ Google Tasks' : 'Conectar Google';
  b.classList.toggle('on', gOn());
  $('#btn-gsync').hidden = !GCLIENT || !gOn();
}
function gAuth() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) return reject(new Error('la librería de Google no cargó'));
    google.accounts.oauth2.initTokenClient({
      client_id: GCLIENT,
      scope: 'https://www.googleapis.com/auth/tasks',
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        G.token = r.access_token; G.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000; G.was = true;
        resolve();
      },
      error_callback: e => reject(new Error(e?.type === 'popup_closed' ? 'cerraste la ventana de Google' : (e?.type || 'error de autorización'))),
    }).requestAccessToken({ prompt: '' });
  });
}
async function gfetch(method, url, body) {
  if (!gOn()) await gAuth();
  const r = await fetch(url, {
    method, headers: { Authorization: 'Bearer ' + G.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  if (!r.ok) { const e = new Error(`error ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
function gNotes(t) {
  const parts = [];
  const c = catById(t.catId); if (c) parts.push(`Categoría: ${c.data.name}`);
  if (t.desc?.trim()) parts.push(t.desc.trim());
  if (t.subs?.length) parts.push('Subtareas:\n' + t.subs.map(s => `${s.done ? '☑' : '☐'} ${s.text}`).join('\n'));
  return parts.join('\n\n').slice(0, 8000);
}
function gPayload(t, patch) {
  const p = { title: t.title, status: t.done ? 'completed' : 'needsAction' };
  const notes = gNotes(t);
  if (notes || patch) p.notes = notes;
  if (t.due) p.due = `${t.due}T00:00:00.000Z`; else if (patch) p.due = null;
  if (patch && !t.done) p.completed = null;
  return p;
}
async function gPushOne(id) {
  const it = items.find(x => x.id === id && x.kind === 'task'); if (!it) return;
  if (it.data.gtask) {
    try { await gfetch('PATCH', `${GAPI}/${it.data.gtask}`, gPayload(it.data, true)); return; }
    catch (e) { if (e.status !== 404 && e.status !== 410) throw e; /* la borraron en Google: se vuelve a crear */ }
  }
  if (it.data.done) return;
  const r = await gfetch('POST', GAPI, gPayload(it.data, false));
  const cur = items.find(x => x.id === id && x.kind === 'task');
  if (cur) await put('task', { ...cur.data, gtask: r.id }, id);
}
async function gSyncAll() {
  let n = 0;
  for (const it of ofKind('task').slice()) {
    if (!it.data.gtask && it.data.done) continue;
    await gPushOne(it.id); n++;
  }
  toast(`${n} tarea(s) sincronizadas con Google Tasks`);
}
function gFail(e) {
  console.error(e);
  G.token = null; G.was = false; updateGoogleUI();
  toast(`Google Tasks: ${e.message}. Tocá "Conectar Google" para reanudar la sincronización.`);
}
const gQueue = fn => { G.q = G.q.then(fn).catch(gFail); };
const gSync = id => { if (G.was) gQueue(() => gPushOne(id)); };
const gDelete = gid => {
  if (!G.was || !gid) return;
  gQueue(async () => { try { await gfetch('DELETE', `${GAPI}/${gid}`); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; } });
};
$('#btn-google').onclick = async () => {
  if (gOn()) {
    if (!confirm('¿Desconectar Google Tasks? Las tareas ya enviadas quedan en Google.')) return;
    try { google.accounts.oauth2.revoke(G.token, () => {}); } catch {}
    G.token = null; G.was = false; updateGoogleUI(); return;
  }
  try { await gAuth(); updateGoogleUI(); gQueue(gSyncAll); }
  catch (e) { toast('Google: ' + e.message); }
};
$('#btn-gsync').onclick = () => gQueue(gSyncAll);

/* ---------- TAREAS ---------- */
const taskUI = { status: 'pending', cat: '', open: new Set() };
const tasks = () => ofKind('task');

function dueInfo(due, done) {
  if (!due) return { text: 'Sin fecha', cls: '' };
  const d = new Date(due + 'T00:00');
  const t = new Date(todayStr() + 'T00:00');
  const diff = Math.round((d - t) / 86400000);
  const fmt = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  if (done) return { text: fmt, cls: '' };
  if (diff < 0)  return { text: `Vencida · ${fmt}`, cls: 'over' };
  if (diff === 0) return { text: 'Hoy', cls: 'today' };
  if (diff === 1) return { text: 'Mañana', cls: '' };
  return { text: fmt, cls: '' };
}

const subStats = t => { const s = t.subs || []; return { n: s.length, d: s.filter(x => x.done).length }; };
function detailHtml(t) {
  return `<div class="t-detail">
    <div class="t-desc md">${t.desc ? '' : '<span class="muted small-text">Sin descripción. Tocá ✎ para agregar una (admite Markdown y LaTeX).</span>'}</div>
    <ul class="subs">${(t.subs || []).map(s => `
      <li class="sub ${s.done ? 'done' : ''}" data-sid="${s.id}">
        <input type="checkbox" class="sub-check" ${s.done ? 'checked' : ''} aria-label="Subtarea hecha">
        <input class="sub-text" value="${esc(s.text)}" maxlength="200" aria-label="Texto de la subtarea">
        <button class="icon-btn" data-act="sub-del" aria-label="Quitar subtarea" title="Quitar">✕</button>
      </li>`).join('')}</ul>
    <input class="sub-add" placeholder="＋ Agregar subtarea (Enter)" maxlength="200" aria-label="Agregar subtarea">
  </div>`;
}

const chipFilters = (cur) => cats().length
  ? `<button class="chip all ${cur ? '' : 'on'}" data-c="">Todas</button>` +
    cats().map(c => `<button class="chip ${cur === c.id ? 'on' : ''}" style="--c:${catColor(c)}" data-c="${c.id}">${esc(c.data.name)}</button>`).join('')
  : '';

function renderTasks() {
  if (taskUI.cat && !catById(taskUI.cat)) taskUI.cat = '';
  $('#task-cats').innerHTML = chipFilters(taskUI.cat);
  $$('#task-status button').forEach(b => b.classList.toggle('on', b.dataset.v === taskUI.status));

  const list = tasks().filter(t => {
    if (taskUI.status === 'pending' && t.data.done) return false;
    if (taskUI.status === 'done' && !t.data.done) return false;
    if (taskUI.cat && t.data.catId !== taskUI.cat) return false;
    return true;
  });
  list.sort((a, b) => {
    if (!!a.data.done !== !!b.data.done) return a.data.done ? 1 : -1;
    const da = a.data.due || '9999', db = b.data.due || '9999';
    return da.localeCompare(db) || (a.data.created || '').localeCompare(b.data.created || '');
  });

  $('#task-list').innerHTML = list.map(t => {
    const d = t.data, di = dueInfo(d.due, d.done), st = subStats(d), open = taskUI.open.has(t.id);
    return `<li class="task ${d.done ? 'done' : ''} ${open ? 'open' : ''}" data-id="${t.id}">
      <input type="checkbox" ${d.done ? 'checked' : ''} aria-label="Marcar como hecha">
      <span class="t-title">${esc(d.title)}</span>
      ${catChip(d.catId)}
      ${st.n ? `<span class="t-progress${st.d === st.n ? ' full' : ''}" title="Subtareas hechas">☑ ${st.d}/${st.n}</span>` : ''}
      ${d.desc ? '<span class="t-hasdesc" title="Tiene descripción">≡</span>' : ''}
      <span class="due ${di.cls}">${esc(di.text)}</span>
      <button class="icon-btn" data-act="toggle" aria-expanded="${open}" aria-label="Detalle: descripción y subtareas" title="Detalle: descripción y subtareas">${open ? '▾' : '▸'}</button>
      <button class="icon-btn" data-act="edit" aria-label="Editar tarea" title="Editar">✎</button>
      ${open ? detailHtml(d) : ''}
    </li>`;
  }).join('');
  $$('#task-list .task.open').forEach(li => {
    const it = items.find(x => x.id === li.dataset.id);
    if (it?.data.desc) renderMd(it.data.desc, $('.t-desc', li));
  });
  const empty = $('#task-empty');
  empty.hidden = list.length > 0;
  empty.textContent = tasks().length === 0 ? 'Todavía no hay tareas. Agregá la primera arriba.'
    : taskUI.status === 'pending' ? '¡Nada pendiente con este filtro!' : 'No hay tareas con este filtro.';
}

$('#task-form').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#task-title').value.trim(); if (!title) return;
  const catId = $('#task-cat').value === '__new' ? '' : $('#task-cat').value;
  try {
    const it = await put('task', { title, due: $('#task-due').value, catId, done: false, created: new Date().toISOString(), gtask: '' });
    $('#task-title').value = ''; $('#task-title').focus();
    renderTasks(); gSync(it.id);
  } catch { /* put() ya avisó */ }
});
$('#task-status').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { taskUI.status = b.dataset.v; renderTasks(); } });
$('#task-cats').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { taskUI.cat = b.dataset.c; renderTasks(); } });
async function saveSubs(it, subs) {
  try { await put('task', { ...it.data, subs }, it.id); } catch { /* put() ya avisó */ }
  renderTasks(); gSync(it.id);
}
$('#task-list').addEventListener('click', async e => {
  const li = e.target.closest('.task'); if (!li) return;
  const it = items.find(x => x.id === li.dataset.id); if (!it) return;
  if (e.target.closest('.t-detail')) {   // panel de detalle: solo el botón de quitar subtarea
    const del = e.target.closest('[data-act=sub-del]');
    if (del) await saveSubs(it, (it.data.subs || []).filter(s => s.id !== del.closest('.sub').dataset.sid));
    return;
  }
  if (e.target.matches('input[type=checkbox]')) {
    try {
      await put('task', { ...it.data, done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null }, it.id);
      renderTasks(); gSync(it.id);
    } catch { renderTasks(); }
  } else if (e.target.closest('[data-act=toggle]') || e.target.closest('.t-title')) {
    taskUI.open.has(it.id) ? taskUI.open.delete(it.id) : taskUI.open.add(it.id);
    renderTasks();
  } else if (e.target.closest('[data-act=edit]')) {
    openEditor({
      title: 'Editar tarea',
      fields: [
        { key: 'title', label: 'Tarea', value: it.data.title, required: true },
        { key: 'due', label: 'Fecha', type: 'date', value: it.data.due },
        { key: 'catId', label: 'Categoría', type: 'select', value: it.data.catId || '', options: catFieldOptions() },
        { key: 'desc', label: 'Descripción (Markdown y LaTeX)', type: 'textarea', value: it.data.desc || '' },
      ],
      onSave: async v => {
        if (!v.title.trim()) return false;
        try { await put('task', { ...it.data, title: v.title.trim(), due: v.due, catId: v.catId, desc: (v.desc || '').trim() }, it.id); } catch { return false; }
        renderTasks(); gSync(it.id);
      },
      onDelete: async () => { const g = it.data.gtask; taskUI.open.delete(it.id); await remove(it.id); renderTasks(); gDelete(g); },
    });
  }
});
// subtareas: tildar / editar el texto (change) y agregar con Enter
$('#task-list').addEventListener('change', async e => {
  const li = e.target.closest('.task'), sub = e.target.closest('.sub'); if (!li || !sub) return;
  const it = items.find(x => x.id === li.dataset.id); if (!it) return;
  const sid = sub.dataset.sid; let subs = [...(it.data.subs || [])];
  if (e.target.classList.contains('sub-check')) subs = subs.map(s => s.id === sid ? { ...s, done: e.target.checked } : s);
  else if (e.target.classList.contains('sub-text')) {
    const text = e.target.value.trim();
    subs = text ? subs.map(s => s.id === sid ? { ...s, text } : s) : subs.filter(s => s.id !== sid);   // vacío = quitar
  } else return;
  await saveSubs(it, subs);
});
$('#task-list').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  if (e.target.classList.contains('sub-text')) { e.preventDefault(); e.target.blur(); return; }
  if (!e.target.classList.contains('sub-add')) return;
  e.preventDefault();
  const text = e.target.value.trim(); if (!text) return;
  const li = e.target.closest('.task'), it = items.find(x => x.id === li?.dataset.id); if (!it) return;
  await saveSubs(it, [...(it.data.subs || []), { id: uid(), text, done: false }]);
  $(`#task-list .task[data-id="${it.id}"] .sub-add`)?.focus();
});

/* ---------- CONFIGURACIÓN ---------- */
const cfgItem = () => ofKind('config')[0];
const cfgMd = () => cfgItem()?.data.md ?? window.CONFIG_SEED ?? '';
function renderConfig() { renderMd(cfgMd(), $('#cfg-view')); }
function setCfgEditing(on) {
  $('#cfg-view').hidden = on; $('#cfg-editor').hidden = !on;
  $('#cfg-edit').hidden = on; $('#cfg-save').hidden = !on; $('#cfg-cancel').hidden = !on;
  $('#cfg-reset').hidden = !on;
  if (on) { $('#cfg-editor').value = cfgMd(); $('#cfg-editor').focus(); }
}
$('#cfg-edit').onclick = () => setCfgEditing(true);
$('#cfg-cancel').onclick = () => setCfgEditing(false);
$('#cfg-reset').onclick = () => { if (confirm('¿Reemplazar el texto del editor por el original del zip?')) $('#cfg-editor').value = window.CONFIG_SEED || ''; };
$('#cfg-save').onclick = async () => {
  try { await put('config', { md: $('#cfg-editor').value }, cfgItem()?.id); } catch { return; }
  setCfgEditing(false); renderConfig(); toast('Configuración guardada');
};

/* ---------- NOTAS ---------- */
const noteUI = { id: null, mode: 'split', q: '', tag: '' };
const notes = () => ofKind('note');
const curNote = () => items.find(x => x.id === noteUI.id && x.kind === 'note');
const noteTitle = n => (n.data.title || '').trim() || 'Sin título';
const tagsOf = n => n.data.tags || [];
const tagColor = t => `hsl(${hue(t)} 60% 45%)`;
const tagNorm = s => s.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLocaleLowerCase('es').slice(0, 30);
const tagChip = (t, extra = '') => `<span class="chip tag" style="--c:${tagColor(t)}">#${esc(t)}${extra}</span>`;
// fijadas primero; después, la más recientemente modificada
const sortNotes = list => [...list].sort((a, b) => (!!b.data.pinned - !!a.data.pinned) || (b.data.updated || '').localeCompare(a.data.updated || ''));
function allTags() {
  const m = new Map();
  notes().forEach(n => tagsOf(n).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return new Map([...m].sort((x, y) => x[0].localeCompare(y[0], 'es')));
}

// plantillas (las fórmulas usan LaTeX)
const todayEs = () => new Date().toLocaleDateString('es-AR');
const TEMPLATES = {
  reunion: { label: 'Acta de reunión', tags: ['reunión'], title: d => `Reunión ${d}`, body: d => String.raw`# Reunión — ${d}

**Fecha:** ${d}
**Participantes:**

## Temas
-

## Acuerdos
-

## Pendientes
- [ ]
` },
  clase: { label: 'Clase', tags: ['docencia'], title: d => `Clase ${d}`, body: d => String.raw`# Clase — ${d}

**Materia / tema:**

## Objetivos
-

## Desarrollo
Se busca $u_h \in V_h$ tal que $a(u_h, v_h) = \ell(v_h)\ \forall v_h \in V_h$.

## Ejercicios
1.

## Para la próxima clase
-
` },
  idea: { label: 'Idea de investigación', tags: ['investigación'], title: () => 'Idea: ', body: () => String.raw`# Idea

## Pregunta
¿?

## Contexto
-

## Planteo
$$
\text{ecuación o esquema numérico}
$$

## Referencias
-

## Próximos pasos
- [ ]
` },
  paper: { label: 'Resumen de paper', tags: ['lectura'], title: () => 'Paper: ', body: () => String.raw`# Paper

**Referencia:**
**Link:**

## Problema

## Método

## Resultados

## Comentarios

## Para usar / citar
-
` },
};
$('#note-tpl').innerHTML = '<option value="">＋ Nueva desde plantilla…</option>' +
  Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');

function renderNoteList() {
  const tags = allTags();
  if (noteUI.tag && !tags.has(noteUI.tag)) noteUI.tag = '';
  $('#note-tag-filter').innerHTML = tags.size
    ? `<button class="chip all ${noteUI.tag ? '' : 'on'}" data-t="">Todas</button>` +
      [...tags].map(([t, n]) => `<button class="chip tag ${noteUI.tag === t ? 'on' : ''}" style="--c:${tagColor(t)}" data-t="${esc(t)}">#${esc(t)} <small>${n}</small></button>`).join('') +
      `<button class="chip" data-manage="1" title="Administrar etiquetas" aria-label="Administrar etiquetas">⚙</button>`
    : '';
  const q = norm(noteUI.q);
  const list = sortNotes(notes().filter(n =>
    (!noteUI.tag || tagsOf(n).includes(noteUI.tag)) &&
    (!q || norm(n.data.title + ' ' + n.data.body + ' ' + tagsOf(n).join(' ')).includes(q))));
  $('#note-list').innerHTML = list.map(n => {
    const tg = tagsOf(n);
    return `<li><button class="note-item ${n.id === noteUI.id ? 'on' : ''}" data-id="${n.id}">
      <span class="n-title">${n.data.pinned ? '📌 ' : ''}${esc(noteTitle(n))}</span>
      <span class="n-snip">${esc((n.data.body || '').replace(/[#*`>\-\n]+/g, ' ').trim().slice(0, 70)) || 'Vacía'}</span>
      ${tg.length ? `<span class="n-tags">${tg.slice(0, 3).map(t => tagChip(t)).join('')}${tg.length > 3 ? `<small class="muted">+${tg.length - 3}</small>` : ''}</span>` : ''}
    </button></li>`;
  }).join('') || `<li class="empty small-text">${notes().length ? 'Sin resultados' : 'Aún no hay notas'}</li>`;
}
function renderNoteMeta() {
  const n = curNote(); if (!n) return;
  const pin = $('#note-pin');
  pin.textContent = n.data.pinned ? '📌 Fijada' : '📌 Fijar';
  pin.setAttribute('aria-pressed', String(!!n.data.pinned)); pin.classList.toggle('on', !!n.data.pinned);
  $('#note-tags').innerHTML = tagsOf(n).map(t =>
    tagChip(t, ` <button type="button" class="chip-x" data-t="${esc(t)}" aria-label="Quitar etiqueta ${esc(t)}">×</button>`)).join('');
  $('#tag-list').innerHTML = [...allTags().keys()].filter(t => !tagsOf(n).includes(t)).map(t => `<option value="${esc(t)}">`).join('');
}
function showNote() {
  const n = curNote();
  $('#note-main').hidden = !n; $('#note-none').hidden = !!n;
  if (!n) return;
  $('#note-title').value = n.data.title || '';
  $('#note-body').value = n.data.body || '';
  $('#note-state').textContent = '';
  renderMd(n.data.body || '', $('#note-preview'));
  renderNoteMeta(); applyNoteMode();
}
function applyNoteMode() {
  $('.notes-body').dataset.mode = noteUI.mode;
  $('#md-tools').hidden = noteUI.mode === 'view';
  $$('#note-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === noteUI.mode));
}
function renderNotes() {
  if (noteUI.id && !items.some(x => x.id === noteUI.id)) noteUI.id = null;
  if (!noteUI.id && notes().length) noteUI.id = sortNotes(notes())[0].id;
  renderNoteList(); showNote();
}
const saveNote = debounce(async () => {
  const n = curNote(); if (!n) return;
  const data = { ...n.data, title: $('#note-title').value, body: $('#note-body').value, updated: new Date().toISOString() };
  try { await put('note', data, n.id); $('#note-state').textContent = 'Guardado'; renderNoteList(); }
  catch { $('#note-state').textContent = 'Error al guardar'; }
}, 600);
const onNoteInput = () => {
  $('#note-state').textContent = 'Guardando…';
  renderMd($('#note-body').value, $('#note-preview'));
  // actualiza en memoria al instante para no perder cambios al cambiar de nota
  const n = curNote();
  if (n) n.data = { ...n.data, title: $('#note-title').value, body: $('#note-body').value };
  saveNote();
};
$('#note-title').addEventListener('input', onNoteInput);
$('#note-body').addEventListener('input', onNoteInput);
$('#note-body').addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey) { // tab = 2 espacios
    e.preventDefault(); const t = e.target, s = t.selectionStart;
    t.setRangeText('  ', s, t.selectionEnd, 'end'); onNoteInput();
  }
});
$('#md-tools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const ta = $('#note-body'), pre = b.dataset.pre, post = b.dataset.post;
  const s = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(s, end) || b.dataset.ph;
  ta.setRangeText(pre + sel + post, s, end, 'end');
  ta.focus(); ta.setSelectionRange(s + pre.length, s + pre.length + sel.length);
  onNoteInput();
});
$('#note-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { noteUI.mode = b.dataset.v; applyNoteMode(); } });
$('#note-search').addEventListener('input', e => { noteUI.q = e.target.value; renderNoteList(); });
$('#note-tag-filter').addEventListener('click', e => { const b = e.target.closest('button'); if (b?.dataset.manage) return openTags(); if (b) { noteUI.tag = b.dataset.t; renderNoteList(); } });
$('#note-list').addEventListener('click', e => {
  const b = e.target.closest('.note-item'); if (!b) return;
  saveNote.flush(); noteUI.id = b.dataset.id; renderNoteList(); showNote();
});

// administrador de etiquetas: renombrar / unir / quitar en todas las notas (no cambia la fecha de modificación)
function openTags() { renderTagManager(); $('#dlg-tags').showModal(); }
function renderTagManager() {
  $('#tag-manage').innerHTML = [...allTags()].map(([t, n]) => `
    <li class="cat-row" data-t="${esc(t)}">
      <input class="cat-name" value="${esc(t)}" maxlength="30" aria-label="Nombre de la etiqueta">
      <span class="muted small-text">${n} nota(s)</span>
      <button class="icon-btn" data-act="del" aria-label="Quitar etiqueta ${esc(t)}" title="Quitar de todas las notas">✕</button>
    </li>`).join('') || '<li class="empty small-text">Todavía no hay etiquetas.</li>';
}
async function mapTag(from, to) {   // to = '' → quitar
  for (const n of notes().filter(n => tagsOf(n).includes(from))) {
    const tags = [...new Set(tagsOf(n).map(t => t === from ? to : t).filter(Boolean))];
    await put('note', { ...n.data, tags }, n.id).catch(() => {});
  }
  if (noteUI.tag === from) noteUI.tag = to;
  renderTagManager(); renderNoteList(); if (curNote()) renderNoteMeta();
}
$('#tag-manage').addEventListener('change', async e => {
  const row = e.target.closest('.cat-row'); if (!row || !e.target.classList.contains('cat-name')) return;
  const from = row.dataset.t, to = tagNorm(e.target.value);
  if (!to) { e.target.value = from; toast('El nombre no puede estar vacío'); return; }
  if (to === from) { e.target.value = from; return; }
  if (allTags().has(to) && !confirm(`Ya existe #${to}. ¿Unir #${from} con #${to}?`)) { e.target.value = from; return; }
  await mapTag(from, to);
});
$('#tag-manage').addEventListener('click', async e => {
  const b = e.target.closest('[data-act=del]'); if (!b) return;
  const t = b.closest('.cat-row').dataset.t, n = allTags().get(t) || 0;
  if (!confirm(`¿Quitar la etiqueta #${t} de ${n} nota(s)? Las notas no se borran.`)) return;
  await mapTag(t, '');
});
$('#btn-tags').addEventListener('click', openTags);
$('#tags-close').onclick = () => $('#dlg-tags').close();

// fijar y etiquetas (no cambian la fecha de modificación)
async function patchNote(patch) {
  const n = curNote(); if (!n) return;
  try { await put('note', { ...n.data, ...patch }, n.id); } catch { return; }
  renderNoteList(); renderNoteMeta();
}
$('#note-pin').addEventListener('click', () => { const n = curNote(); if (n) patchNote({ pinned: !n.data.pinned }); });
function addTags(raw) {
  const n = curNote(); if (!n) return;
  const have = new Set(tagsOf(n));
  raw.split(',').map(tagNorm).filter(Boolean).forEach(t => have.add(t));
  patchNote({ tags: [...have] });
}
$('#note-tag-input').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault(); const v = e.target.value; e.target.value = ''; if (v.trim()) addTags(v);
});
$('#note-tag-input').addEventListener('change', e => { const v = e.target.value; e.target.value = ''; if (v.trim()) addTags(v); });
$('#note-tags').addEventListener('click', e => {
  const b = e.target.closest('.chip-x'); const n = curNote(); if (!b || !n) return;
  patchNote({ tags: tagsOf(n).filter(t => t !== b.dataset.t) });
});

async function newNote(extra = {}) {
  saveNote.flush();
  try {
    const it = await put('note', { title: '', body: '', tags: [], pinned: false, ...extra, updated: new Date().toISOString() });
    noteUI.q = ''; noteUI.tag = ''; $('#note-search').value = ''; noteUI.id = it.id; noteUI.mode = 'split';
    renderNoteList(); showNote(); $('#note-title').focus();
  } catch { /* put() ya avisó */ }
}
$('#note-new').addEventListener('click', () => newNote());
$('#note-tpl').addEventListener('change', e => {
  const t = TEMPLATES[e.target.value]; e.target.value = ''; if (!t) return;
  newNote({ title: t.title(todayEs()), body: t.body(todayEs()), tags: [...t.tags] });
});
$('#note-del').addEventListener('click', async () => {
  const n = curNote(); if (!n) return;
  if (!confirm(`¿Borrar la nota "${noteTitle(n)}"?`)) return;
  await remove(n.id); noteUI.id = null; renderNotes();
});
window.addEventListener('beforeunload', () => saveNote.flush());

/* ---------- navegación ---------- */
const TABS = { tareas: renderTasks, config: renderConfig, notas: renderNotes };
function route() {
  let tab = location.hash.replace('#', ''); if (!TABS[tab]) tab = 'tareas';
  saveNote.flush();
  fillCatSelects();
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + tab);
  $$('.tabs a').forEach(a => { const on = a.dataset.tab === tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  TABS[tab]();
}
window.addEventListener('hashchange', route);

/* ---------- exportar / importar ---------- */
$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'flujo-trabajo', version: 2, exported: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `flujo-trabajo-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#btn-import').onclick = () => $('#file-import').click();
$('#file-import').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const arr = Array.isArray(j) ? j : j.items;
    const ok = Array.isArray(arr) && arr.every(i => i && i.id && KINDS.includes(i.kind) && typeof i.data === 'object');
    if (!ok) throw new Error('formato inválido');
    if (!confirm(`Esto REEMPLAZA todos tus datos actuales por los ${arr.length} elementos del archivo. ¿Continuar?`)) return;
    await store().replaceAll(arr); items = arr; await migrateLegacyCats(); route(); toast('Datos importados');
  } catch (err) { toast('No se pudo importar: ' + err.message); }
};

/* ---------- arranque y login ---------- */
const LOGIN_TIMEOUT_MS = 15000;
const withTimeout = (p, ms) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms)),
]);
const MSG_LOAD_FAIL = 'No se pudieron cargar tus datos. Revisá tu conexión a internet e intentá de nuevo.';

function loginMessage(err) {
  const m = String(err?.message || '');
  if (err?.code === 'timeout') return 'La conexión tardó demasiado. Intentá de nuevo.';
  if (err?.name === 'AuthRetryableFetchError' || err?.status === 0 || /failed to fetch|network|load failed/i.test(m))
    return 'No se pudo conectar con el servidor. Revisá tu conexión a internet e intentá de nuevo.';
  if (err?.code === 'invalid_credentials' || (err?.status === 400 && /invalid login/i.test(m)))
    return 'Email o contraseña incorrectos.';
  if (err?.status === 429) return 'Demasiados intentos. Esperá un momento e intentá de nuevo.';
  return 'No se pudo ingresar: ' + m;
}
function setLogin(busy, msg = '') {
  const btn = $('#login-btn');
  btn.disabled = busy; btn.classList.toggle('busy', busy);
  btn.textContent = busy ? 'Entrando…' : 'Entrar';
  $('#login-email').disabled = busy; $('#login-pass').disabled = busy;
  $('#login-error').textContent = msg;
}
async function onLogin(e) {
  e.preventDefault();
  if (navigator.onLine === false) { setLogin(false, 'Sin conexión a internet. Conectate e intentá de nuevo.'); return; }
  setLogin(true);
  let error = null;
  try {
    ({ error } = await withTimeout(
      sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value }),
      LOGIN_TIMEOUT_MS));
  } catch (err) { error = err; }
  if (error) { setLogin(false, loginMessage(error)); $('#login-pass').focus(); return; }
  if (!(await startApp())) setLogin(false, MSG_LOAD_FAIL);
}

async function startApp() {
  try { items = await withTimeout(store().load(), 20000); }
  catch (e) {
    console.error(e);
    if (useSB) return false;   // en modo nube no se muestra una app vacía si falló la carga
    toast('Error al cargar datos: ' + (e.message || e)); items = [];
  }
  $('#boot').hidden = true; $('#login').hidden = true; $('#app').hidden = false;
  $('#mode-badge').textContent = useSB ? 'Nube' : 'Local';
  $('#mode-badge').title = useSB ? 'Datos guardados en Supabase' : 'Datos guardados solo en este navegador. Usá Exportar para hacer copias.';
  $('#btn-logout').hidden = !useSB;
  await migrateLegacyCats();
  updateGoogleUI();
  route();
  return true;
}

async function init() {
  if (!useSB) { await startApp(); return; }
  if (!window.supabase) {   // la librería de Supabase no cargó (sin conexión o bloqueada)
    $('#login').hidden = false;
    $$('#login-form label').forEach(l => l.hidden = true);
    $('#login-email').required = false; $('#login-pass').required = false;
    $('#login-btn').textContent = 'Recargar';
    $('#login-error').textContent = 'No se pudo cargar el servicio de acceso (error de conexión). Revisá tu internet y recargá la página.';
    $('#login-form').addEventListener('submit', e => { e.preventDefault(); location.reload(); });
    return;
  }
  $('#boot').hidden = false;   // "Entrando…" mientras se comprueba la sesión
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  $('#btn-logout').onclick = async () => { try { await sb.auth.signOut(); } catch {} location.reload(); };
  $('#login-form').addEventListener('submit', onLogin);
  let session = null;
  try { session = (await withTimeout(sb.auth.getSession(), LOGIN_TIMEOUT_MS)).data.session; } catch { session = null; }
  if (session && await startApp()) return;
  $('#boot').hidden = true; $('#login').hidden = false;
  if (session) $('#login-error').textContent = MSG_LOAD_FAIL;
}
init();
})();
