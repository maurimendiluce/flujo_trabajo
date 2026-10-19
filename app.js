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
const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = () => { clearTimeout(t); fn(); }; return f; };

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
const useSB = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
let sb = null;
let items = [];
const LS_KEY = 'flujo-trabajo-v1';

const localAdapter = {
  async load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } },
  async save(it) {
    const all = await this.load(); const i = all.findIndex(x => x.id === it.id);
    if (i >= 0) all[i] = it; else all.push(it);
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  },
  async del(id) { localStorage.setItem(LS_KEY, JSON.stringify((await this.load()).filter(x => x.id !== id))); },
  async replaceAll(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); },
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
  for (const id of ['task-cat', 'link-cat']) {
    const s = $('#' + id); const v = s.value;
    s.innerHTML = catOptions(''); s.value = catById(v) ? v : '';
  }
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
$('#btn-cats-link').onclick = () => openCats();
for (const id of ['task-cat', 'link-cat']) {
  $('#' + id).addEventListener('change', e => {
    if (e.target.value !== '__new') return;
    e.target.value = '';
    openCats(newId => { if (newId) e.target.value = newId; });
  });
}

/* ---------- diálogo genérico ---------- */
const dlg = $('#dlg');
function openEditor({ title, fields, onSave, onDelete }) {
  $('#dlg-title').textContent = title;
  $('#dlg-fields').innerHTML = fields.map(f => f.type === 'select'
    ? `<label>${esc(f.label)}<select name="${f.key}">${f.options.map(o => `<option value="${esc(o.v)}"${o.v === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`
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
function gPayload(t, patch) {
  const c = catById(t.catId);
  const p = { title: t.title, status: t.done ? 'completed' : 'needsAction' };
  const notes = c ? `Categoría: ${c.data.name}` : '';
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
const taskUI = { status: 'pending', cat: '' };
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
    const d = t.data, di = dueInfo(d.due, d.done);
    return `<li class="task ${d.done ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" ${d.done ? 'checked' : ''} aria-label="Marcar como hecha">
      <span class="t-title">${esc(d.title)}</span>
      ${catChip(d.catId)}
      <span class="due ${di.cls}">${esc(di.text)}</span>
      <button class="icon-btn" data-act="edit" aria-label="Editar tarea" title="Editar">✎</button>
    </li>`;
  }).join('');
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
$('#task-list').addEventListener('click', async e => {
  const li = e.target.closest('.task'); if (!li) return;
  const it = items.find(x => x.id === li.dataset.id); if (!it) return;
  if (e.target.matches('input[type=checkbox]')) {
    try {
      await put('task', { ...it.data, done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null }, it.id);
      renderTasks(); gSync(it.id);
    } catch { renderTasks(); }
  } else if (e.target.closest('[data-act=edit]') || e.target.closest('.t-title')) {
    openEditor({
      title: 'Editar tarea',
      fields: [
        { key: 'title', label: 'Tarea', value: it.data.title, required: true },
        { key: 'due', label: 'Fecha', type: 'date', value: it.data.due },
        { key: 'catId', label: 'Categoría', type: 'select', value: it.data.catId || '', options: catFieldOptions() },
      ],
      onSave: async v => {
        if (!v.title.trim()) return false;
        try { await put('task', { ...it.data, title: v.title.trim(), due: v.due, catId: v.catId }, it.id); } catch { return false; }
        renderTasks(); gSync(it.id);
      },
      onDelete: async () => { const g = it.data.gtask; await remove(it.id); renderTasks(); gDelete(g); },
    });
  }
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

/* ---------- LINKS ---------- */
const linkUI = { cat: '', q: '' };
function normUrl(raw) {
  let u = String(raw).trim(); if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return ['http:', 'https:', 'mailto:'].includes(x.protocol) ? x.href : null; } catch { return null; }
}
const hostOf = u => { try { return new URL(u).host.replace(/^www\./, '') || u; } catch { return u; } };

function renderLinks() {
  if (linkUI.cat && !catById(linkUI.cat)) linkUI.cat = '';
  $('#link-cats').innerHTML = chipFilters(linkUI.cat);
  const q = norm(linkUI.q);
  const list = ofKind('link').filter(l =>
    (!linkUI.cat || l.data.catId === linkUI.cat) &&
    (!q || norm(l.data.title + ' ' + l.data.url + ' ' + (catById(l.data.catId)?.data.name || '')).includes(q))
  ).sort((a, b) => a.data.title.localeCompare(b.data.title, 'es'));
  $('#link-grid').innerHTML = list.map(l => `
    <div class="card link-card" data-id="${l.id}">
      <a class="l-main" href="${esc(l.data.url)}" target="_blank" rel="noopener noreferrer">
        <span class="l-title">${esc(l.data.title)}</span>
        <span class="l-host">${esc(hostOf(l.data.url))}</span>
      </a>
      <div class="l-foot">${catChip(l.data.catId) || '<span></span>'}
        <button class="icon-btn" data-act="edit" aria-label="Editar link" title="Editar">✎</button></div>
    </div>`).join('');
  const empty = $('#link-empty');
  empty.hidden = list.length > 0;
  empty.textContent = ofKind('link').length === 0 ? 'Todavía no hay links. Agregá el primero arriba.' : 'No hay links con este filtro.';
}
$('#link-form').addEventListener('submit', async e => {
  e.preventDefault();
  const url = normUrl($('#link-url').value);
  if (!url) { toast('La URL no es válida'); return; }
  const catId = $('#link-cat').value === '__new' ? '' : $('#link-cat').value;
  try {
    await put('link', { title: $('#link-title').value.trim(), url, catId });
    $('#link-title').value = ''; $('#link-url').value = ''; $('#link-title').focus();
    renderLinks();
  } catch { /* put() ya avisó */ }
});
$('#link-search').addEventListener('input', e => { linkUI.q = e.target.value; renderLinks(); });
$('#link-cats').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { linkUI.cat = b.dataset.c; renderLinks(); } });
$('#link-grid').addEventListener('click', e => {
  const btn = e.target.closest('[data-act=edit]'); if (!btn) return;
  const it = items.find(x => x.id === btn.closest('.link-card').dataset.id); if (!it) return;
  openEditor({
    title: 'Editar link',
    fields: [
      { key: 'title', label: 'Nombre', value: it.data.title, required: true },
      { key: 'url', label: 'URL', value: it.data.url, required: true, max: 2000 },
      { key: 'catId', label: 'Categoría', type: 'select', value: it.data.catId || '', options: catFieldOptions() },
    ],
    onSave: async v => {
      const url = normUrl(v.url); if (!url) { toast('La URL no es válida'); return false; }
      try { await put('link', { ...it.data, title: v.title.trim(), url, catId: v.catId }, it.id); } catch { return false; }
      renderLinks();
    },
    onDelete: async () => { await remove(it.id); renderLinks(); },
  });
});

/* ---------- NOTAS ---------- */
const noteUI = { id: null, mode: 'split', q: '' };
const notes = () => ofKind('note');
const noteTitle = n => (n.data.title || '').trim() || 'Sin título';

function renderNoteList() {
  const q = norm(noteUI.q);
  const list = notes().filter(n => !q || norm(n.data.title + ' ' + n.data.body).includes(q))
    .sort((a, b) => (b.data.updated || '').localeCompare(a.data.updated || ''));
  $('#note-list').innerHTML = list.map(n => `
    <li><button class="note-item ${n.id === noteUI.id ? 'on' : ''}" data-id="${n.id}">
      <span class="n-title">${esc(noteTitle(n))}</span>
      <span class="n-snip">${esc((n.data.body || '').replace(/[#*`>\-\n]+/g, ' ').trim().slice(0, 70)) || 'Vacía'}</span>
    </button></li>`).join('') || `<li class="empty small-text">${notes().length ? 'Sin resultados' : 'Aún no hay notas'}</li>`;
}
function showNote() {
  const n = items.find(x => x.id === noteUI.id && x.kind === 'note');
  $('#note-main').hidden = !n; $('#note-none').hidden = !!n;
  if (!n) return;
  $('#note-title').value = n.data.title || '';
  $('#note-body').value = n.data.body || '';
  $('#note-state').textContent = '';
  renderMd(n.data.body || '', $('#note-preview'));
  applyNoteMode();
}
function applyNoteMode() {
  $('.notes-body').dataset.mode = noteUI.mode;
  $('#md-tools').hidden = noteUI.mode === 'view';
  $$('#note-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === noteUI.mode));
}
function renderNotes() {
  if (noteUI.id && !items.some(x => x.id === noteUI.id)) noteUI.id = null;
  if (!noteUI.id && notes().length) noteUI.id = notes().sort((a, b) => (b.data.updated || '').localeCompare(a.data.updated || ''))[0].id;
  renderNoteList(); showNote();
}
const saveNote = debounce(async () => {
  const n = items.find(x => x.id === noteUI.id); if (!n) return;
  const data = { ...n.data, title: $('#note-title').value, body: $('#note-body').value, updated: new Date().toISOString() };
  try { await put('note', data, n.id); $('#note-state').textContent = 'Guardado'; renderNoteList(); }
  catch { $('#note-state').textContent = 'Error al guardar'; }
}, 600);
const onNoteInput = () => {
  $('#note-state').textContent = 'Guardando…';
  renderMd($('#note-body').value, $('#note-preview'));
  // actualiza en memoria al instante para no perder cambios al cambiar de nota
  const n = items.find(x => x.id === noteUI.id);
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
$('#note-list').addEventListener('click', e => {
  const b = e.target.closest('.note-item'); if (!b) return;
  saveNote.flush(); noteUI.id = b.dataset.id; renderNoteList(); showNote();
});
$('#note-new').addEventListener('click', async () => {
  saveNote.flush();
  try {
    const it = await put('note', { title: '', body: '', updated: new Date().toISOString() });
    noteUI.q = ''; $('#note-search').value = ''; noteUI.id = it.id; noteUI.mode = 'split';
    renderNoteList(); showNote(); $('#note-title').focus();
  } catch { /* put() ya avisó */ }
});
$('#note-del').addEventListener('click', async () => {
  const n = items.find(x => x.id === noteUI.id); if (!n) return;
  if (!confirm(`¿Borrar la nota "${noteTitle(n)}"?`)) return;
  await remove(n.id); noteUI.id = null; renderNotes();
});
window.addEventListener('beforeunload', () => saveNote.flush());

/* ---------- navegación ---------- */
const TABS = { tareas: renderTasks, config: renderConfig, links: renderLinks, notas: renderNotes };
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

/* ---------- arranque ---------- */
async function startApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  $('#mode-badge').textContent = useSB ? 'Nube' : 'Local';
  $('#mode-badge').title = useSB ? 'Datos guardados en Supabase' : 'Datos guardados solo en este navegador. Usá Exportar para hacer copias.';
  $('#btn-logout').hidden = !useSB;
  try { items = await store().load(); } catch (e) { toast('Error al cargar datos: ' + (e.message || e)); items = []; }
  await migrateLegacyCats();
  updateGoogleUI();
  route();
}

async function init() {
  if (!useSB) { await startApp(); return; }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  $('#btn-logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  const { data: { session } } = await sb.auth.getSession();
  if (session) { await startApp(); return; }
  $('#login').hidden = false;
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault(); $('#login-error').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
    if (error) { $('#login-error').textContent = 'Email o contraseña incorrectos.'; return; }
    await startApp();
  });
}
init();
})();
