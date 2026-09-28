'use strict';
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };

// ---------- native bridge ----------
const pending = new Map();
let seq = 0;
if (typeof SariNative !== 'undefined') {
  SariNative.onmessage = e => {
    const r = JSON.parse(e.data), p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    r.ok ? p.res(r.data) : p.rej(new Error(r.error));
  };
}
function call(op, args = {}) {
  return new Promise((res, rej) => {
    if (typeof SariNative === 'undefined') return rej(new Error('Native bridge unavailable'));
    const id = ++seq;
    pending.set(id, { res, rej });
    SariNative.postMessage(JSON.stringify({ id, op, args }));
  });
}

// ---------- state ----------
let project = null, tabs = [], active = -1, clip = null, saveTimer = null;
const expanded = new Set(['']);
const cache = new Map();
let fontSize = +localStorage.getItem('fontSize') || 14;
applyFont();
document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';

// ---------- UI helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2800);
}
const fail = e => toast(e.message || String(e));

function modal({ title, text = '', value = null, options = null, ok = 'OK' }) {
  return new Promise(resolve => {
    $('#mTitle').textContent = title;
    $('#mText').textContent = text; $('#mText').hidden = !text;
    const inp = $('#mInput'), sel = $('#mSelect');
    inp.hidden = value === null; sel.hidden = !options;
    if (value !== null) inp.value = value;
    if (options) { sel.textContent = ''; options.forEach(o => { const op = el('option', '', o); op.value = o; sel.appendChild(op); }); }
    $('#mOk').textContent = ok;
    $('#modal').hidden = false;
    if (value !== null) setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const done = v => { $('#modal').hidden = true; $('#mOk').onclick = $('#mCancel').onclick = inp.onkeydown = null; resolve(v); };
    $('#mOk').onclick = () => done(options ? { name: inp.value, choice: sel.value } : (value !== null ? inp.value : true));
    $('#mCancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') $('#mOk').click(); };
  });
}

function sheet(items) {
  const box = $('#sheet'); box.textContent = '';
  items.forEach(it => {
    const b = el('button', it.danger ? 'danger' : '', it.label);
    b.onclick = () => { closeSheet(); it.fn(); };
    box.appendChild(b);
  });
  $('#sheetWrap').hidden = false;
}
function closeSheet() { $('#sheetWrap').hidden = true; }
$('#sheetWrap').onclick = e => { if (e.target.id === 'sheetWrap') closeSheet(); };

function applyFont() { document.documentElement.style.setProperty('--font', fontSize + 'px'); }

// ---------- home ----------
async function showHome() {
  await saveAll().catch(fail);
  project = null; tabs = []; active = -1; clip = null;
  $('#ide').hidden = true; $('#home').hidden = false;
  try {
    const list = await call('listProjects');
    const box = $('#projects'); box.textContent = '';
    $('#homeEmpty').hidden = list.length > 0;
    list.forEach(p => {
      const card = el('div', 'card-item');
      const t = el('div', 't');
      t.append(el('div', '', p.name), el('div', '', (p.language || 'project') + ' · ' + new Date(p.modified).toLocaleDateString()));
      t.onclick = () => openProject(p.name);
      const m = el('button', 'ic', '⋮');
      m.onclick = () => sheet([
        { label: 'Open', fn: () => openProject(p.name) },
        { label: 'Rename', fn: () => renameProject(p.name) },
        { label: 'Duplicate', fn: () => call('duplicateProject', { name: p.name }).then(showHome).catch(fail) },
        { label: 'Delete', danger: true, fn: () => deleteProject(p.name) },
      ]);
      card.append(t, m); box.appendChild(card);
    });
  } catch (e) { fail(e); }
}
async function newProject() {
  const r = await modal({ title: 'New project', value: '', options: ['python', 'javascript', 'html', 'c', 'cpp', 'java', 'kotlin', 'bash', 'empty'], ok: 'Create' });
  if (!r || !r.name.trim()) return;
  try { const n = await call('createProject', { name: r.name.trim(), template: r.choice }); await openProject(n); } catch (e) { fail(e); }
}
async function renameProject(name) {
  const v = await modal({ title: 'Rename project', value: name }); if (!v) return;
  call('renameProject', { name, newName: v.trim() }).then(showHome).catch(fail);
}
async function deleteProject(name) {
  if (!await modal({ title: 'Delete "' + name + '"?', text: 'This permanently deletes the project and all its files.', ok: 'Delete' })) return;
  call('deleteProject', { name }).then(showHome).catch(fail);
}

// ---------- project / explorer ----------
async function openProject(name) {
  project = name; tabs = []; active = -1; clip = null;
  expanded.clear(); expanded.add(''); cache.clear();
  $('#home').hidden = true; $('#ide').hidden = false; $('#ide').classList.remove('open');
  $('#projName').textContent = name;
  renderTabs(); showActive();
  try {
    await refreshTree();
    const meta = JSON.parse(await call('readFile', { project, path: '.sari/project.json' }));
    if (meta.run) await openFile(meta.run);
  } catch (e) { /* project may have no run file */ }
}
async function refreshTree() {
  for (const d of [...expanded]) {
    try { cache.set(d, await call('listDir', { project, path: d })); }
    catch (e) { expanded.delete(d); cache.delete(d); }
  }
  renderTree();
}
function renderTree() {
  const box = $('#tree'); box.textContent = '';
  (function walk(dir, depth) {
    (cache.get(dir) || []).forEach(it => {
      const p = dir ? dir + '/' + it.name : it.name;
      const row = el('div', 'row');
      row.style.paddingInlineStart = (8 + depth * 14) + 'px';
      const open = expanded.has(p);
      row.append(el('span', '', it.dir ? (open ? '▾ 📂' : '▸ 📁') : '📄'), el('span', 'n', it.name));
      const m = el('span', 'm', '⋮');
      m.onclick = e => { e.stopPropagation(); entryMenu(p, it.dir); };
      row.appendChild(m);
      row.onclick = async () => {
        if (!it.dir) { openFile(p); if (innerWidth <= 700) $('#ide').classList.remove('open'); return; }
        if (open) expanded.delete(p); else expanded.add(p);
        try { if (!open) cache.set(p, await call('listDir', { project, path: p })); } catch (e) { fail(e); }
        renderTree();
      };
      box.appendChild(row);
      if (it.dir && open) walk(p, depth + 1);
    });
  })('', 0);
}
function entryMenu(p, isDir) {
  const items = [];
  if (isDir) items.push(
    { label: 'New file here', fn: () => newEntry('createFile', p) },
    { label: 'New folder here', fn: () => newEntry('createDir', p) });
  items.push(
    { label: 'Rename', fn: () => renameEntry(p) },
    { label: 'Copy', fn: () => { clip = { path: p, mode: 'copy' }; toast('Copied'); } },
    { label: 'Cut', fn: () => { clip = { path: p, mode: 'move' }; toast('Cut'); } });
  if (isDir && clip) items.push({ label: 'Paste here', fn: () => paste(p) });
  items.push({ label: 'Delete', danger: true, fn: () => deleteEntry(p) });
  sheet(items);
}
async function newEntry(op, dir = '') {
  const name = await modal({ title: op === 'createFile' ? 'New file' : 'New folder', value: '', ok: 'Create' });
  if (!name || !name.trim()) return;
  try {
    const path = await call(op, { project, dir, name: name.trim() });
    if (dir) expanded.add(dir);
    await refreshTree();
    if (op === 'createFile') await openFile(path);
  } catch (e) { fail(e); }
}
async function renameEntry(p) {
  const old = p.split('/').pop();
  const name = await modal({ title: 'Rename', value: old }); if (!name || name === old) return;
  try {
    const np = await call('rename', { project, path: p, newName: name.trim() });
    tabs.forEach(t => { if (t.path === p || t.path.startsWith(p + '/')) t.path = np + t.path.slice(p.length); });
    if (expanded.delete(p)) expanded.add(np);
    renderTabs(); await refreshTree();
  } catch (e) { fail(e); }
}
async function deleteEntry(p) {
  if (!await modal({ title: 'Delete "' + p.split('/').pop() + '"?', ok: 'Delete' })) return;
  try {
    await call('delete', { project, path: p });
    for (let i = tabs.length - 1; i >= 0; i--) if (tabs[i].path === p || tabs[i].path.startsWith(p + '/')) removeTab(i, true);
    await refreshTree();
  } catch (e) { fail(e); }
}
async function paste(dir) {
  if (!clip) return;
  try {
    await call(clip.mode, { project, path: clip.path, destDir: dir });
    if (clip.mode === 'move') { tabs = tabs.filter(t => !(t.path === clip.path || t.path.startsWith(clip.path + '/'))); clip = null; active = Math.min(active, tabs.length - 1); renderTabs(); showActive(); }
    expanded.add(dir); await refreshTree();
  } catch (e) { fail(e); }
}
async function findFile() {
  const q = await modal({ title: 'Find file', value: '', ok: 'Search' }); if (!q) return;
  try {
    const res = await call('search', { project, query: q });
    if (!res.length) return toast('No matches');
    sheet(res.slice(0, 30).map(p => ({ label: p, fn: () => openFile(p) })));
  } catch (e) { fail(e); }
}

// ---------- editor ----------
const ed = $('#ed'), gutter = $('#gutter');
function updateGutter() {
  const n = ed.value.split('\n').length;
  let s = ''; for (let i = 1; i <= n; i++) s += i + '\n';
  gutter.textContent = s;
  gutter.scrollTop = ed.scrollTop;
}
function updateStatus() {
  const t = tabs[active];
  $('#stFile').textContent = t ? t.path + (t.dirty ? ' •' : '') : '';
  if (!t) return $('#stPos').textContent = '';
  const before = ed.value.slice(0, ed.selectionStart).split('\n');
  $('#stPos').textContent = 'Ln ' + before.length + ', Col ' + (before[before.length - 1].length + 1);
}
function showActive() {
  const t = tabs[active];
  $('#empty').hidden = !!t;
  ed.value = t ? t.content : '';
  ed.disabled = !t;
  updateGutter(); updateStatus();
}
function renderTabs() {
  const box = $('#tabs'); box.textContent = '';
  tabs.forEach((t, i) => {
    const d = el('div', 'tab' + (i === active ? ' on' : ''));
    d.append(el('span', '', t.path.split('/').pop()));
    if (t.dirty) d.append(el('span', 'dot', '●'));
    const x = el('span', 'x', '✕');
    x.onclick = e => { e.stopPropagation(); removeTab(i); };
    d.append(x);
    d.onclick = () => activate(i);
    box.appendChild(d);
  });
}
function activate(i) { active = i; renderTabs(); showActive(); }
async function openFile(path) {
  const i = tabs.findIndex(t => t.path === path);
  if (i >= 0) return activate(i);
  try {
    const content = await call('readFile', { project, path });
    tabs.push({ path, content, dirty: false });
    activate(tabs.length - 1);
  } catch (e) { fail(e); }
}
async function removeTab(i, discard = false) {
  const t = tabs[i];
  if (t.dirty && !discard) await saveTab(t);
  tabs.splice(i, 1);
  if (active >= tabs.length) active = tabs.length - 1;
  if (i < active) active--;
  renderTabs(); showActive();
}
async function saveTab(t) {
  if (!t || !t.dirty) return;
  try { await call('writeFile', { project, path: t.path, content: t.content }); t.dirty = false; renderTabs(); updateStatus(); }
  catch (e) { fail(e); throw e; }
}
async function saveAll() { for (const t of tabs) await saveTab(t); }
async function manualSave() { try { await saveAll(); toast('Saved'); } catch (e) { /* toast shown */ } }

ed.addEventListener('input', () => {
  const t = tabs[active]; if (!t) return;
  t.content = ed.value;
  if (!t.dirty) { t.dirty = true; renderTabs(); }
  updateGutter(); updateStatus();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => saveTab(t).catch(() => {}), 1500);
});
ed.addEventListener('scroll', () => { gutter.scrollTop = ed.scrollTop; });
ed.addEventListener('keyup', updateStatus);
ed.addEventListener('click', updateStatus);
function insert(text) { ed.focus(); if (!document.execCommand('insertText', false, text)) ed.setRangeText(text, ed.selectionStart, ed.selectionEnd, 'end'); ed.dispatchEvent(new Event('input')); }
ed.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); insert('    '); }
  else if (e.key === 'Enter' && !e.ctrlKey) {
    e.preventDefault();
    const pos = ed.selectionStart, v = ed.value;
    const ls = v.lastIndexOf('\n', pos - 1) + 1;
    const indent = (v.slice(ls, pos).match(/^[ \t]*/) || [''])[0];
    const prev = v[pos - 1];
    insert('\n' + indent + ('{[(:'.includes(prev) ? '    ' : ''));
  }
});
document.querySelectorAll('#keys [data-ins]').forEach(b => {
  b.addEventListener('pointerdown', e => e.preventDefault());
  b.onclick = () => insert(b.dataset.ins);
});
$('#kUndo').onclick = () => { ed.focus(); document.execCommand('undo'); };
$('#kRedo').onclick = () => { ed.focus(); document.execCommand('redo'); };
$('#kUndo').addEventListener('pointerdown', e => e.preventDefault());
$('#kRedo').addEventListener('pointerdown', e => e.preventDefault());

// ---------- run / build ----------
const ext = p => (p.split('.').pop() || '').toLowerCase();
async function run() {
  if (!project) return;
  try { await saveAll(); } catch (e) { return; }
  const t = tabs[active];
  let htmlPath = t && ['html', 'htm'].includes(ext(t.path)) ? t.path : null;
  if (!htmlPath) {
    try { await call('readFile', { project, path: 'index.html' }); htmlPath = 'index.html'; } catch (e) { /* none */ }
  }
  if (htmlPath) return previewHtml(htmlPath);
  toast('Running this language needs the Termux backend (Phase 3).');
}
async function previewHtml(path) {
  try {
    let html = await call('readFile', { project, path });
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const norm = rel => { const out = []; (dir + rel).split('/').forEach(s => { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }); return out.join('/'); };
    const jobs = [];
    for (const m of html.matchAll(/<link[^>]*href=["']([^"':]+\.css)["'][^>]*>/gi)) jobs.push({ tag: m[0], rel: m[1], css: true });
    for (const m of html.matchAll(/<script[^>]*src=["']([^"':]+\.js)["'][^>]*>\s*<\/script>/gi)) jobs.push({ tag: m[0], rel: m[1], css: false });
    for (const j of jobs) {
      try {
        const src = await call('readFile', { project, path: norm(j.rel) });
        html = html.replace(j.tag, () => j.css ? '<style>' + src + '</style>' : '<script>' + src.replace(/<\/script/gi, '<\\/script') + '</script>');
      } catch (e) { /* leave tag as is */ }
    }
    $('#frame').srcdoc = html;
    $('#preview').hidden = false;
  } catch (e) { fail(e); }
}
function build() {
  toast('Local and cloud builds arrive in Phases 4 and 7.');
}

// ---------- menus & shortcuts ----------
function moreMenu() {
  sheet([
    { label: 'Font size +', fn: () => { fontSize = Math.min(28, fontSize + 1); localStorage.setItem('fontSize', fontSize); applyFont(); } },
    { label: 'Font size −', fn: () => { fontSize = Math.max(10, fontSize - 1); localStorage.setItem('fontSize', fontSize); applyFont(); } },
    { label: 'Toggle light / dark theme', fn: () => { const d = document.documentElement, n = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = n; localStorage.setItem('theme', n); } },
    { label: 'Close project', fn: showHome },
  ]);
}
$('#btnNewProject').onclick = newProject;
$('#btnDrawer').onclick = () => $('#ide').classList.toggle('open');
$('#scrim').onclick = () => $('#ide').classList.remove('open');
$('#btnRun').onclick = run;
$('#btnBuild').onclick = build;
$('#btnSave').onclick = manualSave;
$('#btnMore').onclick = moreMenu;
$('#btnNewFile').onclick = () => newEntry('createFile', '');
$('#btnNewDir').onclick = () => newEntry('createDir', '');
$('#btnFind').onclick = findFile;
$('#btnRefresh').onclick = () => refreshTree().catch(fail);
$('#btnClosePreview').onclick = () => { $('#preview').hidden = true; $('#frame').srcdoc = ''; };

document.addEventListener('keydown', e => {
  if (!e.ctrlKey || $('#ide').hidden) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); manualSave(); }
  else if (k === 'p' && !e.shiftKey) { e.preventDefault(); findFile(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll().catch(() => {}); });

window.sariBack = () => {
  if (!$('#modal').hidden) { $('#mCancel').click(); return true; }
  if (!$('#sheetWrap').hidden) { closeSheet(); return true; }
  if (!$('#preview').hidden) { $('#btnClosePreview').click(); return true; }
  if (!$('#ide').hidden) {
    if ($('#ide').classList.contains('open')) { $('#ide').classList.remove('open'); return true; }
    showHome(); return true;
  }
  return false;
};

showHome();
