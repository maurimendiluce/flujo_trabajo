(() => {
'use strict';

/* ---------- utilidades ---------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); }));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hue = s => { let h = 0; for (const c of String(s)) h = (h*31 + c.charCodeAt(0)) % 360; return h; };
const catChip = c => c ? `<span class="chip" style="--h:${hue(c.toLowerCase())}">${esc(c)}</span>` : '';
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = () => { clearTimeout(t); fn(); }; return f; };

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200);
}

/* ---------- markdown seguro ---------- */
function renderMd(md, target) {
  if (!window.marked || !window.DOMPurify) {
    target.innerHTML = `<pre>${esc(md)}</pre>`; return;
  }
  const html = DOMPurify.sanitize(marked.parse(md || '', { gfm: true, breaks: false }), { ADD_ATTR: ['target'] });
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
// Cada elemento: { id, kind: 'task'|'link'|'note'|'config', data: {...} }
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
  if (i >= 0) items[i] = it; else items.push(it);
  try { await store().save(it); }
  catch (e) { console.error(e); toast('No se pudo guardar: ' + (e.message || e)); throw e; }
  return it;
}
async function remove(id) {
  items = items.filter(x => x.id !== id);
  try { await store().del(id); } catch (e) { console.error(e); toast('No se pudo borrar: ' + (e.message || e)); }
}

/* ---------- diálogo genérico ---------- */
const dlg = $('#dlg');
function openEditor({ title, fields, onSave, onDelete }) {
  $('#dlg-title').textContent = title;
  $('#dlg-fields').innerHTML = fields.map(f => `
    <label>${esc(f.label)}
      <input name="${f.key}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"
        ${f.list ? `list="${f.list}"` : ''} ${f.required ? 'required' : ''} maxlength="${f.max || 200}">
    </label>`).join('');
  $('#dlg-del').hidden = !onDelete;
  dlg.onsubmit = null;
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

function allCats(kind) {
  const set = new Map();
  ofKind(kind).forEach(i => { const c = (i.data.cat || '').trim(); if (c) set.set(c.toLowerCase(), c); });
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

function renderTasks() {
  const cats = allCats('task');
  $('#cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  if (taskUI.cat && !cats.some(c => c.toLowerCase() === taskUI.cat.toLowerCase())) taskUI.cat = '';
  $('#task-cats').innerHTML = cats.length
    ? `<button class="chip all ${taskUI.cat ? '' : 'on'}" data-c="">Todas</button>` +
      cats.map(c => `<button class="chip ${taskUI.cat.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="--h:${hue(c.toLowerCase())}" data-c="${esc(c)}">${esc(c)}</button>`).join('')
    : '';
  $$('#task-status button').forEach(b => b.classList.toggle('on', b.dataset.v === taskUI.status));

  let list = tasks().filter(t => {
    if (taskUI.status === 'pending' && t.data.done) return false;
    if (taskUI.status === 'done' && !t.data.done) return false;
    if (taskUI.cat && (t.data.cat || '').toLowerCase() !== taskUI.cat.toLowerCase()) return false;
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
      ${catChip(d.cat)}
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
  await put('task', { title, due: $('#task-due').value, cat: $('#task-cat').value.trim(), done: false, created: new Date().toISOString() });
  $('#task-title').value = ''; $('#task-title').focus();
  renderTasks();
});
$('#task-status').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { taskUI.status = b.dataset.v; renderTasks(); } });
$('#task-cats').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { taskUI.cat = b.dataset.c; renderTasks(); } });
$('#task-list').addEventListener('click', async e => {
  const li = e.target.closest('.task'); if (!li) return;
  const it = items.find(x => x.id === li.dataset.id); if (!it) return;
  if (e.target.matches('input[type=checkbox]')) {
    await put('task', { ...it.data, done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null }, it.id);
    renderTasks();
  } else if (e.target.closest('[data-act=edit]') || e.target.closest('.t-title')) {
    openEditor({
      title: 'Editar tarea',
      fields: [
        { key: 'title', label: 'Tarea', value: it.data.title, required: true },
        { key: 'due', label: 'Fecha', type: 'date', value: it.data.due },
        { key: 'cat', label: 'Categoría', value: it.data.cat, list: 'cat-list', max: 40 },
      ],
      onSave: async v => { if (!v.title.trim()) return false; await put('task', { ...it.data, title: v.title.trim(), due: v.due, cat: v.cat.trim() }, it.id); renderTasks(); },
      onDelete: async () => { await remove(it.id); renderTasks(); },
    });
  }
});

/* ---------- CONFIGURACIÓN ---------- */
const cfgItem = () => ofKind('config')[0];
const cfgMd = () => cfgItem()?.data.md ?? window.CONFIG_SEED ?? '';
function renderConfig() {
  renderMd(cfgMd(), $('#cfg-view'));
}
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
  await put('config', { md: $('#cfg-editor').value }, cfgItem()?.id);
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
  const cats = allCats('link');
  $('#link-cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  if (linkUI.cat && !cats.some(c => c.toLowerCase() === linkUI.cat.toLowerCase())) linkUI.cat = '';
  $('#link-cats').innerHTML = cats.length
    ? `<button class="chip all ${linkUI.cat ? '' : 'on'}" data-c="">Todas</button>` +
      cats.map(c => `<button class="chip ${linkUI.cat.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="--h:${hue(c.toLowerCase())}" data-c="${esc(c)}">${esc(c)}</button>`).join('')
    : '';
  const q = norm(linkUI.q);
  const list = ofKind('link').filter(l =>
    (!linkUI.cat || (l.data.cat || '').toLowerCase() === linkUI.cat.toLowerCase()) &&
    (!q || norm(l.data.title + ' ' + l.data.url + ' ' + (l.data.cat || '')).includes(q))
  ).sort((a, b) => a.data.title.localeCompare(b.data.title, 'es'));
  $('#link-grid').innerHTML = list.map(l => `
    <div class="card link-card" data-id="${l.id}">
      <a class="l-main" href="${esc(l.data.url)}" target="_blank" rel="noopener noreferrer">
        <span class="l-title">${esc(l.data.title)}</span>
        <span class="l-host">${esc(hostOf(l.data.url))}</span>
      </a>
      <div class="l-foot">${catChip(l.data.cat) || '<span></span>'}
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
  await put('link', { title: $('#link-title').value.trim(), url, cat: $('#link-cat').value.trim() });
  $('#link-title').value = ''; $('#link-url').value = ''; $('#link-title').focus();
  renderLinks();
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
      { key: 'cat', label: 'Categoría', value: it.data.cat, list: 'link-cat-list', max: 40 },
    ],
    onSave: async v => {
      const url = normUrl(v.url); if (!url) { toast('La URL no es válida'); return false; }
      await put('link', { ...it.data, title: v.title.trim(), url, cat: v.cat.trim() }, it.id); renderLinks();
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
$('#note-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { noteUI.mode = b.dataset.v; applyNoteMode(); } });
$('#note-search').addEventListener('input', e => { noteUI.q = e.target.value; renderNoteList(); });
$('#note-list').addEventListener('click', e => {
  const b = e.target.closest('.note-item'); if (!b) return;
  saveNote.flush(); noteUI.id = b.dataset.id; renderNoteList(); showNote();
});
$('#note-new').addEventListener('click', async () => {
  saveNote.flush();
  const it = await put('note', { title: '', body: '', updated: new Date().toISOString() });
  noteUI.q = ''; $('#note-search').value = ''; noteUI.id = it.id; noteUI.mode = 'split';
  renderNoteList(); showNote(); $('#note-title').focus();
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
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + tab);
  $$('.tabs a').forEach(a => { const on = a.dataset.tab === tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  TABS[tab]();
}
window.addEventListener('hashchange', route);

/* ---------- exportar / importar ---------- */
$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'flujo-trabajo', version: 1, exported: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `flujo-trabajo-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#btn-import').onclick = () => $('#file-import').click();
$('#file-import').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const arr = Array.isArray(j) ? j : j.items;
    const ok = Array.isArray(arr) && arr.every(i => i && i.id && ['task','link','note','config'].includes(i.kind) && typeof i.data === 'object');
    if (!ok) throw new Error('formato inválido');
    if (!confirm(`Esto REEMPLAZA todos tus datos actuales por los ${arr.length} elementos del archivo. ¿Continuar?`)) return;
    await store().replaceAll(arr); items = arr; route(); toast('Datos importados');
  } catch (err) { toast('No se pudo importar: ' + err.message); }
};

/* ---------- arranque ---------- */
async function startApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  $('#mode-badge').textContent = useSB ? 'Nube' : 'Local';
  $('#mode-badge').title = useSB ? 'Datos guardados en Supabase' : 'Datos guardados solo en este navegador. Usá Exportar para hacer copias.';
  $('#btn-logout').hidden = !useSB;
  try { items = await store().load(); } catch (e) { toast('Error al cargar datos: ' + (e.message || e)); items = []; }
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
