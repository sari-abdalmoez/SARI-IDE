'use strict';
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const icoEl = (name, cls) => { const s = el('span', 'icowrap' + (cls ? ' ' + cls : '')); s.innerHTML = iconSvg(name); return s; };

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
function busy(text, fn) {
  $('#busyText').textContent = text; $('#busy').hidden = false;
  return Promise.resolve().then(fn).finally(() => { $('#busy').hidden = true; });
}

// ---------- streaming output from De Linux ----------
// Each streaming message: {id, stream:true, line, isErr, sessionId}
// We only display lines whose sessionId matches the current console session.
let activeConsoleSessionId = -1;
window._onNativeStream = function(msg) {
  try {
    const obj = typeof msg === 'string' ? JSON.parse(msg) : msg;
    if (!obj.stream) return;
    if (obj.sessionId !== undefined && obj.sessionId !== -1 && obj.sessionId !== activeConsoleSessionId) return;
    consoleWrite(obj.line || '', !!obj.isErr);
  } catch(e) { /* ignore malformed */ }
};

// ---------- state ----------
let project = null, tabs = [], active = -1, clip = null, saveTimer = null;
const expanded = new Set(['']);
const cache = new Map();
let fontSize = +localStorage.getItem('fontSize') || 14;
let autoSave = localStorage.getItem('autoSave') !== 'off';
let isAndroidProject = false;
applyFont();
document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';
let deLinuxStatus = {};

// ---------- UI helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200);
}
const fail = e => toast((e && e.message) || String(e));

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
    if (it.icon) { b.textContent = ''; b.append(icoEl(it.icon), el('span', '', it.label)); }
    b.onclick = () => { closeSheet(); it.fn(); };
    box.appendChild(b);
  });
  $('#sheetWrap').hidden = false;
}
function closeSheet() { $('#sheetWrap').hidden = true; }
$('#sheetWrap').onclick = e => { if (e.target.id === 'sheetWrap') closeSheet(); };
function applyFont() { document.documentElement.style.setProperty('--font', fontSize + 'px'); }
function showScreen(id) { document.querySelectorAll('#githubScreen,#runDetail,#settingsScreen,#termuxScreen').forEach(s => s.hidden = true); $(id).hidden = false; }
function closeScreens() { document.querySelectorAll('#githubScreen,#runDetail,#settingsScreen,#termuxScreen').forEach(s => s.hidden = true); }

// ---------- home ----------
async function showHome() {
  await saveAll().catch(fail);
  closeScreens();
  project = null; tabs = []; active = -1; clip = null;
  $('#ide').hidden = true; $('#home').hidden = false;
  try {
    const list = await call('listProjects');
    const box = $('#projects'); box.textContent = '';
    $('#homeEmpty').hidden = list.length > 0;
    list.forEach(p => {
      const card = el('div', 'card-item');
      const t = el('div', 't');
      t.append(el('div', '', p.name), el('div', '', (p.language || 'project') + ' \u00b7 ' + new Date(p.modified).toLocaleDateString()));
      t.onclick = () => openProject(p.name);
      const m = el('button', 'ic sm'); m.appendChild(icoEl('more-vert'));
      m.onclick = () => sheet([
        { label: 'Open', icon: 'folder-open', fn: () => openProject(p.name) },
        { label: 'Rename', icon: 'file', fn: () => renameProject(p.name) },
        { label: 'Duplicate', icon: 'copy', fn: () => call('duplicateProject', { name: p.name }).then(showHome).catch(fail) },
        { label: 'Delete', icon: 'trash', danger: true, fn: () => deleteProject(p.name) },
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
let projectLang = '';
async function openProject(name) {
  project = name; tabs = []; active = -1; clip = null; projectLang = '';
  expanded.clear(); expanded.add(''); cache.clear();
  closeScreens(); closeConsole();
  $('#home').hidden = true; $('#ide').hidden = false; $('#ide').classList.remove('open');
  $('#projName').textContent = name;
  renderTabs(); showActive();
  call('delinux.status').then(s => { deLinuxStatus = s; }).catch(() => {});
  try {
    await refreshTree();
    detectAndroidProject();
    const meta = JSON.parse(await call('readFile', { project, path: '.sari/project.json' }));
    projectLang = meta.language || '';
    if (meta.run) await openFile(meta.run);
  } catch (e) { /* project may have no run file */ }
}
function detectAndroidProject() {
  const root = cache.get('') || [];
  isAndroidProject = root.some(it => it.dir && it.name === 'app') && root.some(it => !it.dir && /^settings\.gradle/.test(it.name));
  $('#btnBuild').style.display = isAndroidProject ? '' : 'none';
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
      row.append(icoEl(it.dir ? (open ? 'folder-open' : 'folder') : 'file'), el('span', 'n', it.name));
      const m = el('span', 'm'); m.appendChild(icoEl('more-vert'));
      m.onclick = e => { e.stopPropagation(); entryMenu(p, it.dir); };
      row.appendChild(m);
      let lpTimer = null, lpFired = false, sx = 0, sy = 0;
      row.addEventListener('pointerdown', e => {
        lpFired = false; sx = e.clientX; sy = e.clientY;
        lpTimer = setTimeout(() => { lpFired = true; row.classList.add('longpress'); if (navigator.vibrate) navigator.vibrate(15); entryMenu(p, it.dir); }, 480);
      });
      const cancelLp = () => { clearTimeout(lpTimer); row.classList.remove('longpress'); };
      row.addEventListener('pointermove', e => { if (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) cancelLp(); });
      row.addEventListener('pointerup', cancelLp);
      row.addEventListener('pointercancel', cancelLp);
      row.onclick = async () => {
        if (lpFired) return;
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
  items.push({ label: 'Open', icon: 'folder-open', fn: () => isDir ? null : openFile(p) });
  if (isDir) items.push(
    { label: 'New file here', icon: 'file-plus', fn: () => newEntry('createFile', p) },
    { label: 'New folder here', icon: 'folder-plus', fn: () => newEntry('createDir', p) });
  items.push(
    { label: 'Move', icon: 'folder-open', fn: () => moveEntry(p) },
    { label: 'Copy', icon: 'copy', fn: () => { clip = { path: p, mode: 'copy' }; toast('Copied \u2014 open a folder\'s menu and choose Paste here'); } },
    { label: 'Rename', icon: 'file', fn: () => renameEntry(p) });
  if (isDir && clip) items.push({ label: 'Paste here', icon: 'download', fn: () => paste(p) });
  items.push({ label: 'Delete', icon: 'trash', danger: true, fn: () => deleteEntry(p) });
  sheet(items);
}
async function newEntry(op, dir = '') {
  const name = await modal({ title: op === 'createFile' ? 'New file' : 'New folder', value: '', ok: 'Create' });
  if (!name || !name.trim()) return;
  try {
    const path = await call(op, { project, dir, name: name.trim() });
    if (dir) expanded.add(dir);
    await refreshTree(); detectAndroidProject();
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
async function moveEntry(p) {
  const allDirs = ['(project root)'];
  (function collect(dir) { (cache.get(dir) || []).forEach(it => { if (it.dir) { const full = dir ? dir + '/' + it.name : it.name; allDirs.push(full); collect(full); } }); })('');
  const r = await modal({ title: 'Move "' + p.split('/').pop() + '" to', value: '', options: allDirs, ok: 'Move' });
  if (!r) return;
  const dest = r.choice === '(project root)' ? '' : r.choice;
  try {
    const np = await call('move', { project, path: p, destDir: dest });
    tabs.forEach(t => { if (t.path === p || t.path.startsWith(p + '/')) t.path = np + t.path.slice(p.length); });
    expanded.add(dest); renderTabs(); await refreshTree();
  } catch (e) { fail(e); }
}
async function deleteEntry(p) {
  if (!await modal({ title: 'Delete "' + p.split('/').pop() + '"?', ok: 'Delete' })) return;
  try {
    await call('delete', { project, path: p });
    for (let i = tabs.length - 1; i >= 0; i--) if (tabs[i].path === p || tabs[i].path.startsWith(p + '/')) removeTab(i, true);
    await refreshTree(); detectAndroidProject();
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
    sheet(res.slice(0, 30).map(p => ({ label: p, icon: 'file', fn: () => openFile(p) })));
  } catch (e) { fail(e); }
}
async function importFiles() {
  try { const names = await busy('Importing\u2026', () => call('importFiles', { project, dir: '' })); if (names && names.length) { await refreshTree(); toast('Imported ' + names.length + ' file(s)'); } } catch (e) { fail(e); }
}
async function importFolder() {
  try { const name = await busy('Importing folder\u2026', () => call('importFolder', { project, dir: '' })); if (name) { await refreshTree(); toast('Imported "' + name + '"'); } } catch (e) { fail(e); }
}

// ---------- editor ----------
const ed = $('#ed'), gutter = $('#gutter');
function updateGutter() {
  const n = ed.value.split('\n').length;
  let s = ''; for (let i = 1; i <= n; i++) s += i + '\n';
  gutter.textContent = s; gutter.scrollTop = ed.scrollTop;
}
function updateStatus() {
  const t = tabs[active];
  $('#stFile').textContent = t ? t.path + (t.dirty ? ' \u2022' : '') : '';
  if (!t) return $('#stPos').textContent = '';
  const before = ed.value.slice(0, ed.selectionStart).split('\n');
  $('#stPos').textContent = 'Ln ' + before.length + ', Col ' + (before[before.length - 1].length + 1);
}
function showActive() {
  const t = tabs[active]; $('#empty').hidden = !!t; ed.value = t ? t.content : ''; ed.disabled = !t;
  updateGutter(); updateStatus();
}
function renderTabs() {
  const box = $('#tabs'); box.textContent = '';
  tabs.forEach((t, i) => {
    const d = el('div', 'tab' + (i === active ? ' on' : ''));
    d.append(el('span', '', t.path.split('/').pop()));
    if (t.dirty) d.append(el('span', 'dot', '\u25cf'));
    const x = el('span', 'x'); x.appendChild(icoEl('close'));
    x.onclick = e => { e.stopPropagation(); removeTab(i); };
    d.append(x); d.onclick = () => activate(i); box.appendChild(d);
  });
}
function activate(i) { active = i; renderTabs(); showActive(); }
async function openFile(path) {
  const i = tabs.findIndex(t => t.path === path); if (i >= 0) return activate(i);
  try { const content = await call('readFile', { project, path }); tabs.push({ path, content, dirty: false }); activate(tabs.length - 1); } catch (e) { fail(e); }
}
async function removeTab(i, discard = false) {
  const t = tabs[i]; if (t.dirty && !discard) await saveTab(t);
  tabs.splice(i, 1);
  if (active >= tabs.length) active = tabs.length - 1;
  if (i < active) active--;
  renderTabs(); showActive();
}
async function saveTab(t) {
  if (!t || !t.dirty) return;
  try { await call('writeFile', { project, path: t.path, content: t.content }); t.dirty = false; renderTabs(); updateStatus(); } catch (e) { fail(e); throw e; }
}
async function saveAll() { for (const t of tabs) await saveTab(t); }
async function manualSave() { try { await saveAll(); toast('Saved'); } catch (e) { /* toast shown */ } }

ed.addEventListener('input', () => {
  const t = tabs[active]; if (!t) return;
  t.content = ed.value;
  if (!t.dirty) { t.dirty = true; renderTabs(); }
  updateGutter(); updateStatus();
  if (autoSave) { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveTab(t).catch(() => {}), 1500); }
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
document.querySelectorAll('#keys [data-ins]').forEach(b => { b.addEventListener('pointerdown', e => e.preventDefault()); b.onclick = () => insert(b.dataset.ins); });
$('#kUndo').onclick = () => { ed.focus(); document.execCommand('undo'); };
$('#kRedo').onclick = () => { ed.focus(); document.execCommand('redo'); };
$('#kUndo').addEventListener('pointerdown', e => e.preventDefault());
$('#kRedo').addEventListener('pointerdown', e => e.preventDefault());

// ---- search / replace / go to line ----
let searchHits = [], searchIdx = -1;
function doSearch(showReplace) {
  if (!tabs[active]) return toast('Open a file first');
  $('#findBar').hidden = false;
  $('#fbReplace').hidden = !showReplace; $('#fbReplaceOne').hidden = !showReplace; $('#fbReplaceAll').hidden = !showReplace;
  $('#fbFind').focus(); recomputeHits();
}
function recomputeHits() {
  const q = $('#fbFind').value; searchHits = [];
  if (q) { const v = ed.value; let i = 0; while ((i = v.indexOf(q, i)) !== -1) { searchHits.push(i); i += q.length; } }
  searchIdx = searchHits.length ? 0 : -1;
  $('#fbCount').textContent = searchHits.length ? (searchIdx + 1) + '/' + searchHits.length : '0/0';
  jumpToHit();
}
function jumpToHit() {
  if (searchIdx < 0) return;
  const q = $('#fbFind').value, pos = searchHits[searchIdx];
  ed.focus(); ed.setSelectionRange(pos, pos + q.length);
  const lineNo = ed.value.slice(0, pos).split('\n').length;
  ed.scrollTop = Math.max(0, (lineNo - 4) * parseFloat(getComputedStyle(ed).lineHeight));
  updateStatus();
}
$('#fbFind').addEventListener('input', recomputeHits);
$('#fbNext').onclick = () => { if (searchHits.length) { searchIdx = (searchIdx + 1) % searchHits.length; $('#fbCount').textContent = (searchIdx + 1) + '/' + searchHits.length; jumpToHit(); } };
$('#fbPrev').onclick = () => { if (searchHits.length) { searchIdx = (searchIdx - 1 + searchHits.length) % searchHits.length; $('#fbCount').textContent = (searchIdx + 1) + '/' + searchHits.length; jumpToHit(); } };
$('#fbReplaceOne').onclick = () => { if (searchIdx < 0) return; const q = $('#fbFind').value, r = $('#fbReplace').value, pos = searchHits[searchIdx]; ed.setSelectionRange(pos, pos + q.length); insert(r); recomputeHits(); };
$('#fbReplaceAll').onclick = () => { const q = $('#fbFind').value, r = $('#fbReplace').value; if (!q) return; ed.value = ed.value.split(q).join(r); ed.dispatchEvent(new Event('input')); recomputeHits(); toast('Replaced all'); };
$('#fbClose').onclick = () => { $('#findBar').hidden = true; searchHits = []; };
async function goToLine() {
  const v = await modal({ title: 'Go to line', value: '' }); if (!v) return;
  const n = parseInt(v, 10); if (!n || !tabs[active]) return;
  const lines = ed.value.split('\n'); let pos = 0;
  for (let i = 0; i < Math.min(n - 1, lines.length); i++) pos += lines[i].length + 1;
  ed.focus(); ed.setSelectionRange(pos, pos);
  ed.scrollTop = Math.max(0, (n - 4) * parseFloat(getComputedStyle(ed).lineHeight)); updateStatus();
}
$('#btnEditorMenu').onclick = () => sheet([
  { label: 'Search', icon: 'search', fn: () => doSearch(false) },
  { label: 'Search & Replace', icon: 'search', fn: () => doSearch(true) },
  { label: 'Go to line', icon: 'more-horiz', fn: goToLine },
  { label: 'Console Output', icon: 'console', fn: openConsole },
  { label: 'Termux Terminal', icon: 'terminal', fn: openTerminal },
  { label: 'GitHub', icon: 'github', fn: openGithubScreen },
  { label: 'De Linux runtimes', icon: 'settings', fn: openSettings },
  { label: 'Auto-save: ' + (autoSave ? 'On' : 'Off'), icon: 'check', fn: () => { autoSave = !autoSave; localStorage.setItem('autoSave', autoSave ? 'on' : 'off'); toast('Auto-save ' + (autoSave ? 'on' : 'off')); } },
  { label: 'Toggle theme', icon: 'settings', fn: () => { const d = document.documentElement, n = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = n; localStorage.setItem('theme', n); } },
  { label: 'Close project', icon: 'back', fn: showHome },
]);

// ============================================================
// Console Output — session-aware, NO cross-run contamination
// ============================================================
let consoleBusy = false;
let lastRunLang = null, lastRunFile = null;
// Each call to runFile increments this. Output callbacks check it matches before writing.
let currentRunId = 0;
const CONSOLE_MAX_CHARS = 200000;
function openConsole() { $('#consolePanel').hidden = false; }
function closeConsole() { $('#consolePanel').hidden = true; }
$('#btnConsole').onclick = () => { $('#consolePanel').hidden ? openConsole() : closeConsole(); };
$('#cClose').onclick = closeConsole;
$('#cClear').onclick = () => { $('#consoleOutput').textContent = ''; };
$('#cCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#consoleOutput').textContent); toast('Copied'); } catch (e) { toast('Copy failed'); } };
$('#cStop').onclick = () => {
  // Mark this runId as expired so no further output from it renders
  activeConsoleSessionId = -1;
  currentRunId++;
  setConsoleRunning(false);
  consoleWrite('\n[Stopped — command may still be running in Termux]', true);
};
$('#consoleRerun').onclick = () => { if (lastRunFile && lastRunLang && project) runFile(lastRunFile, lastRunLang); };

function consoleWrite(text, isErr = false) {
  const box = $('#consoleOutput');
  const line = el('div', isErr ? 'cerr' : '');
  line.textContent = text;
  box.appendChild(line);
  while (box.textContent.length > CONSOLE_MAX_CHARS) { if (!box.firstChild) break; box.removeChild(box.firstChild); }
  box.scrollTop = box.scrollHeight;
}
function consoleClear(label) {
  // Reset session guard so no in-flight callbacks from a previous run can write here
  activeConsoleSessionId = -1;
  const box = $('#consoleOutput'); box.textContent = '';
  if (label) { const h = el('div', 'chead', label); box.appendChild(h); }
}
function setConsoleRunning(on) {
  consoleBusy = on;
  const badge = $('#consoleStatus'); badge.hidden = !on; badge.textContent = on ? 'running' : '';
  $('#btnConsole').classList.toggle('running', on);
  $('#cStop').hidden = !on; $('#consoleRerun').hidden = on;
}

// ---------- run / build ----------
const ext = p => (p.split('.').pop() || '').toLowerCase();
function guessLang(path) {
  const e = ext(path);
  return {
    py: 'python',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    sh: 'bash', bash: 'bash',
    c: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
    java: 'java',
    kt: 'kotlin', kts: 'kotlin',
    rs: 'rust',
    go: 'go',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    php: 'php',
    rb: 'ruby',
    lua: 'lua',
    dart: 'dart',
    pl: 'perl', pm: 'perl',
    html: 'html', htm: 'html'
  }[e] || '';
}

async function run() {
  if (!project) return;
  try { await saveAll(); } catch (e) { return; }
  const t = tabs[active];
  if (!t) return toast('Open a file to run.');
  const lang = guessLang(t.path) || projectLang;
  if (!lang) return toast('Cannot detect language for ' + t.path);
  await runFile(t.path, lang);
}

async function runFile(filePath, lang) {
  lastRunFile = filePath; lastRunLang = lang;

  if (lang === 'html' || lang === 'htm') { previewHtml(filePath); return; }

  // Verify the exact compiler/runtime required by this source file.
  try {
    const runtime = await call('languages.check', { id: lang });
    if (!runtime || !runtime.ok) {
      const name = runtime && runtime.label ? runtime.label : lang;
      const detail = runtime && (runtime.error || runtime.version)
        ? ': ' + (runtime.error || runtime.version)
        : '';
      toast(name + ' is not installed' + detail);
      openSettings();
      return;
    }
  } catch (e) {
    toast('Cannot verify ' + lang + ': ' + e.message);
    return;
  }

  // Increment the runId FIRST — any pending callbacks from an old run will see a stale id
  // and be silently dropped (the streaming handler checks activeConsoleSessionId).
  activeConsoleSessionId = ++currentRunId;

  // Clear the console BEFORE the new run starts — ensures no old output is visible.
  const sessionLabel = lang.toUpperCase() + ': ' + filePath.split('/').pop();
  consoleClear('$ Run ' + filePath);
  openConsole(); setConsoleRunning(true);

  try {
    const stdin = $('#consoleStdin').value || null;
    // Build the command appropriate for this language
    const cmd = buildRunCommand(filePath, lang);
    if (!cmd) { consoleWrite('No run command for language: ' + lang, true); setConsoleRunning(false); return; }
    consoleWrite('$ ' + cmd, false);
    // Capture this run's id; if another run starts while this await is in flight it will
    // increment currentRunId and subsequent consoleWrite calls here will be dropped.
    const myRunId = activeConsoleSessionId;
    const r = await call('termux.run', { project, path: '', command: cmd, stdin });
    // Only write result if this is still the current run
    if (myRunId !== activeConsoleSessionId) return;
    if (r.stdout && r.stdout.trim()) consoleWrite(r.stdout.trimEnd(), false);
    if (r.stderr && r.stderr.trim()) consoleWrite(r.stderr.trimEnd(), true);
    consoleWrite('\nProcess finished with exit code ' + r.exitCode, r.exitCode !== 0);
  } catch (e) {
    if (activeConsoleSessionId === currentRunId)
      consoleWrite('error: ' + e.message, true);
  } finally {
    if (activeConsoleSessionId === currentRunId) setConsoleRunning(false);
  }
}

/**
 * Returns the shell command to run the given source file through Termux.
 * File paths within the command use ~/storage/shared/... (Termux's view),
 * constructed from the relative filePath within the current project.
 */
function shellQuote(v) {
  return "'" + String(v).replace(/'/g, "'\\''") + "'";
}

/**
 * One runner per language.
 * Compiled languages use their own compiler and write temporary executables
 * inside Termux private storage. Interpreted languages use their interpreter.
 */
function buildRunCommand(filePath, lang) {
  const termuxProjectBase = '/storage/emulated/0/SARIProjects/' + project;
  const termuxFile = termuxProjectBase + '/' + filePath;
  const qFile = shellQuote(termuxFile);
  const stamp = Date.now();

  const tmpRoot = '/data/data/com.termux/files/usr/tmp';
  const tmpBin = tmpRoot + '/sari_run_' + stamp;
  const qBin = shellQuote(tmpBin);

  const cleanupBin = "; status=$?; rm -f " + qBin + "; exit $status";

  switch (lang) {
    case 'python':
      return "python3 " + qFile;

    case 'javascript':
      return "node " + qFile;

    case 'typescript': {
      const tmpDir = tmpRoot + '/sari_ts_' + stamp;
      const qDir = shellQuote(tmpDir);
      const base = filePath.split('/').pop().replace(/\.(tsx?|mts|cts)$/i, '');
      const qBase = shellQuote(base + '.js');

      return "mkdir -p " + qDir +
        " && tsc " + qFile +
        " --target ES2020 --module commonjs --outDir " + qDir +
        " </dev/null 2>&1 && echo '-- compile OK --' && " +
        "jsout=$(find " + qDir + " -type f -name " + qBase + " -print -quit); " +
        "[ -n \"$jsout\" ] || { echo 'TypeScript output not found' >&2; exit 1; }; " +
        "node \"$jsout\"; status=$?; rm -rf " + qDir + "; exit $status";
    }

    case 'bash':
      return "bash " + qFile;

    case 'c':
      return "clang " + qFile +
        " -O2 -o " + qBin +
        " </dev/null 2>&1 && echo '-- compile OK --' && " +
        qBin + cleanupBin;

    case 'cpp':
      return "clang++ " + qFile +
        " -O2 -std=c++17 -o " + qBin +
        " </dev/null 2>&1 && echo '-- compile OK --' && " +
        qBin + cleanupBin;

    case 'rust': {
      const cargoFile = termuxProjectBase + '/Cargo.toml';
      const qCargo = shellQuote(cargoFile);

      return "[ -f " + qCargo + " ] && " +
        "cd " + shellQuote(termuxProjectBase) +
        " && cargo run || " +
        "(rustc " + qFile +
        " -O -o " + qBin +
        " </dev/null 2>&1 && echo '-- compile OK --' && " +
        qBin + cleanupBin + ")";
    }

    case 'go': {
      const goMod = termuxProjectBase + '/go.mod';
      const qGoMod = shellQuote(goMod);

      return "[ -f " + qGoMod + " ] && " +
        "cd " + shellQuote(termuxProjectBase) +
        " && go run . || " +
        "(go build -o " + qBin + " " + qFile +
        " </dev/null 2>&1 && echo '-- compile OK --' && " +
        qBin + cleanupBin + ")";
    }

    case 'java': {
      const cls = filePath.split('/').pop().replace(/\.java$/i, '');
      const tmpDir = tmpRoot + '/sari_java_' + stamp;
      const qDir = shellQuote(tmpDir);
      const qClassName = shellQuote(cls);

      return "mkdir -p " + qDir +
        " && find " + shellQuote(termuxProjectBase) +
        " -type f -name '*.java' -print0 | " +
        "xargs -0 javac -d " + qDir +
        " </dev/null 2>&1 && echo '-- compile OK --' && " +
        "pkgname=$(sed -nE 's/^[[:space:]]*package[[:space:]]+([^;[:space:]]+)[[:space:]]*;.*/\\1/p' " +
        qFile + " | head -n1); " +
        "mainclass=" + qClassName + "; " +
        "[ -n \"$pkgname\" ] && mainclass=\"$pkgname.$mainclass\"; " +
        "java -cp " + qDir + " \"$mainclass\"; " +
        "status=$?; rm -rf " + qDir + "; exit $status";
    }

    case 'kotlin': {
      const tmpJar = tmpRoot + '/sari_kotlin_' + stamp + '.jar';
      const qJar = shellQuote(tmpJar);

      return "kotlinc " + qFile +
        " -include-runtime -d " + qJar +
        " </dev/null 2>&1 && echo '-- compile OK --' && " +
        "java -jar " + qJar +
        "; status=$?; rm -f " + qJar + "; exit $status";
    }

    case 'php':
      return "php " + qFile;

    case 'ruby':
      return "ruby " + qFile;

    case 'lua':
      return "(command -v lua5.4 || command -v lua) >/dev/null 2>&1 && " +
        "LUA=$(command -v lua5.4 || command -v lua); \"$LUA\" " + qFile;

    case 'dart':
      return "dart run " + qFile;

    case 'perl':
      return "perl " + qFile;

    case 'html':
      return null;

    default:
      return null;
  }
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
      try { const src = await call('readFile', { project, path: norm(j.rel) }); html = html.replace(j.tag, () => j.css ? '<style>' + src + '</style>' : '<script>' + src.replace(/<\/script/gi, '<\\/script') + '</script>'); } catch (e) { }
    }
    $('#frame').srcdoc = html; $('#preview').hidden = false;
  } catch (e) { fail(e); }
}

async function build() {
  if (!project) return;
  if (!isAndroidProject) { toast('This project has no app/ + settings.gradle — it cannot produce an APK.'); return; }
  const st = await call('github.status').catch(() => ({ connected: false }));
  if (!st.connected) { toast('Connect GitHub first to build with Actions'); return openGithubScreen(); }
  if (!await modal({ title: 'Build with GitHub Actions', text: 'Pushes "' + project + '" to ' + st.repo + ' (' + st.branch + ') and triggers android-build.yml.', ok: 'Push & Build' })) return;
  try {
    const count = await busy('Pushing project\u2026', () => call('github.pushAll', { project, message: 'Update ' + project + ' via SARI IDE' }));
    toast('Pushed ' + count + ' file(s)');
    const run = await busy('Starting workflow\u2026', () => call('github.triggerWorkflow', { workflowFile: 'android-build.yml', ref: st.branch }));
    openGithubScreen();
    if (run && run.id) openRunDetail(run.id); else refreshGithubRuns();
  } catch (e) { fail(e); }
}

// ---------- top-level buttons ----------
$('#btnNewProject').onclick = newProject;
$('#btnDrawer').onclick = () => $('#ide').classList.toggle('open');
$('#scrim').onclick = () => $('#ide').classList.remove('open');
$('#btnRun').onclick = run;
$('#btnBuild').onclick = build;
$('#btnSave').onclick = manualSave;
$('#btnNewFile').onclick = () => newEntry('createFile', '');
$('#btnNewDir').onclick = () => newEntry('createDir', '');
$('#btnImportFile').onclick = importFiles;
$('#btnImportFolder').onclick = importFolder;
$('#btnFind').onclick = findFile;
$('#btnRefresh').onclick = () => refreshTree().catch(fail);
$('#btnClosePreview').onclick = () => { $('#preview').hidden = true; $('#frame').srcdoc = ''; };
$('#btnGithubHome').onclick = openGithubScreen;
$('#btnSettingsHome').onclick = openSettings;
$('#btnGithubDrawer').onclick = openGithubScreen;
$('#btnSettingsDrawer').onclick = openSettings;

document.addEventListener('keydown', e => {
  if (!e.ctrlKey || $('#ide').hidden) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); manualSave(); }
  else if (k === 'p' && !e.shiftKey) { e.preventDefault(); findFile(); }
  else if (k === 'f') { e.preventDefault(); doSearch(false); }
  else if (k === 'h') { e.preventDefault(); doSearch(true); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll().catch(() => {}); });

// ============================================================
// GitHub screen
// ============================================================
function openGithubScreen() {
  showScreen('#githubScreen'); $('#ghProjName').textContent = project || '(none)'; refreshGithubStatus();
}
$('#ghBack').onclick = closeScreens;
$('#ghRefresh').onclick = () => refreshGithubStatus();
async function refreshGithubStatus() {
  try {
    const st = await call('github.status');
    $('#ghDisconnected').hidden = st.connected; $('#ghConnected').hidden = !st.connected;
    if (st.connected) { $('#ghStatusLine').textContent = 'Connected as ' + st.username; $('#ghRepoLine').textContent = st.repo + ' \u00b7 branch ' + st.branch; refreshGithubRuns(); }
  } catch (e) { fail(e); }
}
$('#ghConnect').onclick = async () => {
  const username = $('#ghUser').value.trim(), token = $('#ghToken').value, repo = $('#ghRepo').value.trim(), branch = $('#ghBranch').value.trim();
  if (!username || !token || !repo) return toast('Username, token and repository are required');
  try { await busy('Connecting\u2026', () => call('github.connect', { username, token, repo, branch })); $('#ghToken').value = ''; toast('Connected'); refreshGithubStatus(); } catch (e) { fail(e); }
};
$('#ghDisconnect').onclick = async () => { if (!await modal({ title: 'Disconnect GitHub?', ok: 'Disconnect' })) return; await call('github.disconnect'); refreshGithubStatus(); };
$('#ghImportRepo').onclick = async () => {
  const name = await modal({ title: 'Import repository as project', text: 'Creates a new local project and pulls every file.', value: '' });
  if (!name || !name.trim()) return;
  try { const res = await busy('Importing\u2026', () => call('github.importRepo', { project: name.trim() })); toast('Imported ' + res.imported + ' file(s)'); closeScreens(); await openProject(res.project); } catch (e) { fail(e); }
};
$('#ghBrowse').onclick = async () => {
  try {
    const files = await busy('Loading\u2026', () => call('github.listRepoFiles'));
    if (!files.length) return toast('Repository is empty');
    sheet(files.slice(0, 200).map(f => ({ label: f.path, icon: 'file', fn: () => {
      if (!project) return toast('Open a project first');
      busy('Pulling ' + f.path + '\u2026', () => call('github.pull', { project, path: f.path })).then(() => refreshTree()).then(() => toast('Pulled ' + f.path)).catch(fail);
    }})));
  } catch (e) { fail(e); }
};
$('#ghPullAll').onclick = async () => {
  if (!project) return toast('Open a project first');
  if (!await modal({ title: 'Pull all files?', text: 'Overwrites local files with the repository\u2019s versions.', ok: 'Pull' })) return;
  try { const n = await busy('Pulling\u2026', () => call('github.pullAll', { project })); await refreshTree(); toast('Pulled ' + n + ' file(s)'); } catch (e) { fail(e); }
};
$('#ghPushAll').onclick = async () => {
  if (!project) return toast('Open a project first');
  const msg = await modal({ title: 'Commit message', value: 'Update ' + project + ' via SARI IDE' }); if (msg === null) return;
  try { await saveAll(); const n = await busy('Pushing\u2026', () => call('github.pushAll', { project, message: msg })); toast('Pushed ' + n + ' file(s)'); } catch (e) { fail(e); }
};
$('#ghBranches').onclick = async () => {
  try { const list = await busy('Loading\u2026', () => call('github.listBranches')); sheet([...list.map(b => ({ label: b, icon: 'branch', fn: () => toast('Reconnect with branch "' + b + '" to switch') })), { label: '+ Create branch\u2026', icon: 'plus', fn: createBranch }]); } catch (e) { fail(e); }
};
async function createBranch() { const name = await modal({ title: 'New branch name', value: '' }); if (!name) return; try { await busy('Creating\u2026', () => call('github.createBranch', { name: name.trim(), from: 'main' })); toast('Branch "' + name + '" created'); } catch (e) { fail(e); } }
$('#ghTrigger').onclick = async () => {
  if (!project) return toast('Open the project first');
  if (!await modal({ title: 'Push & trigger build', text: 'Pushes "' + project + '" then dispatches android-build.yml.', ok: 'Go' })) return;
  try {
    const n = await busy('Pushing\u2026', () => call('github.pushAll', { project, message: 'Update ' + project + ' via SARI IDE' }));
    toast('Pushed ' + n + ' file(s)');
    const run = await busy('Starting workflow\u2026', () => call('github.triggerWorkflow', { workflowFile: 'android-build.yml', ref: '' }));
    if (run && run.id) openRunDetail(run.id); else refreshGithubRuns();
  } catch (e) { fail(e); }
};
async function refreshGithubRuns() {
  try {
    const runs = await call('github.listRuns'); const box = $('#ghRuns'); box.textContent = '';
    runs.slice(0, 10).forEach(r => {
      const item = el('div', 'run-item'); const t = el('div', 't');
      t.append(el('div', '', '#' + r.run_number + ' \u2014 ' + (r.display_title || r.name || 'build')));
      t.append(el('div', 'muted', new Date(r.created_at).toLocaleString()));
      const badge = el('span', 'badge ' + badgeClass(r), badgeText(r));
      item.append(t, badge); item.onclick = () => openRunDetail(r.id); box.appendChild(item);
    });
  } catch (e) { /* not fatal */ }
}
function badgeClass(r) { if (r.status !== 'completed') return 'run'; return r.conclusion === 'success' ? 'ok' : 'fail'; }
function badgeText(r) { return r.status !== 'completed' ? r.status : r.conclusion; }

let ghRunId = null, pollTimer = null;
function openRunDetail(runId) {
  ghRunId = runId;
  clearInterval(pollTimer); pollTimer = setInterval(loadRunDetail, 6000);
}
$('#rdBack').onclick = () => { clearInterval(pollTimer); closeScreens(); openGithubScreen(); };
$('#rdRefresh').onclick = loadRunDetail;
async function loadRunDetail() {
  if (!ghRunId) return;
  try {
    const run = await call('github.getRun', { runId: ghRunId });
    const box = $('#rdStatus'); box.textContent = '';
    const t = el('div', 't'); t.append(el('div', '', 'Run #' + run.run_number), el('div', 'muted', run.status + (run.conclusion ? ' \u00b7 ' + run.conclusion : '')));
    box.append(t, el('span', 'badge ' + badgeClass(run), badgeText(run)));
    if (run.status === 'completed') {
      clearInterval(pollTimer);
      const logs = await call('github.getRunLogs', { runId: ghRunId }); $('#rdLogs').textContent = logs;
      const arts = await call('github.listArtifacts', { runId: ghRunId }); const abox = $('#rdArtifacts'); abox.textContent = '';
      if (run.conclusion === 'success' && arts.length) {
        abox.appendChild(el('div', 'sectionTitle', 'Artifacts'));
        arts.forEach(a => { const row = el('div', 'run-item'); row.append(el('div', 't', a.name + ' (' + Math.round(a.size_in_bytes / 1024) + ' KB)')); const dl = el('button', 'primary', 'Download'); dl.onclick = () => downloadArtifact(a.id); row.appendChild(dl); abox.appendChild(row); });
      }
    } else { $('#rdLogs').textContent = 'Build is ' + run.status + ' \u2014 logs appear once it completes.'; }
  } catch (e) { fail(e); }
}
async function downloadArtifact(artifactId) {
  if (!project) return toast('Open a project first');
  try {
    const res = await busy('Downloading\u2026', () => call('github.downloadArtifact', { project, artifactId }));
    if (res.apks && res.apks.length) { sheet(res.apks.map(p => ({ label: 'Install ' + p.split('/').pop(), icon: 'build', fn: () => call('github.installApk', { path: p }).catch(fail) }))); }
    else { toast('Downloaded to ' + res.extractedTo); }
  } catch (e) { fail(e); }
}

// ============================================================
// Settings / De Linux runtimes
// ============================================================
async function openSettings() {
  showScreen('#settingsScreen');
  const diag = await call('termux.diagnostics').catch(() => ({ installed: false, permission: false }));
  $('#stTermuxWarn').hidden = !!diag.installed;
  $('#stPermWarn').hidden = !diag.installed || !!diag.permission;
  const arch = await call('arch.info').catch(() => null);
  if (arch) { const abox = $('#archInfo'); if (abox) abox.textContent = 'Device: ' + arch.primaryAbi + ' (API ' + arch.apiLevel + ', ' + (arch.is64Bit ? '64-bit' : '32-bit') + ')'; }
  loadDeLinuxRuntimes();
}
$('#stBack').onclick = closeScreens;
$('#stTheme').onclick = () => { const d = document.documentElement, n = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = n; localStorage.setItem('theme', n); };
$('#stFontUp').onclick = () => { fontSize = Math.min(28, fontSize + 1); localStorage.setItem('fontSize', fontSize); applyFont(); };
$('#stFontDown').onclick = () => { fontSize = Math.max(10, fontSize - 1); localStorage.setItem('fontSize', fontSize); applyFont(); };

const RUNTIME_LABELS = { python: 'Python 3.11', cpp: 'C / C++ (clang)', javascript: 'Node.js', html: 'HTML (WebView)' };
async function loadDeLinuxRuntimes() {
  const box = $('#langList'); box.textContent = '';
  box.appendChild(el('p', 'muted small', 'Execution uses Termux as the backend. Install languages with pkg inside Termux Terminal, then use Run here.'));
  // Show what Termux has installed
  await loadLanguages(box);
}
async function verifyRuntime(id, label) {
  label.textContent = 'Verifying\u2026';
  try { const r = await call('delinux.verify', { id }); label.textContent = r.ok ? 'READY' : ('FAILED: ' + (r.error || '')); } catch (e) { label.textContent = 'Error: ' + e.message; }
}
async function installRuntime(id, btn, label) {
  if (id !== 'python') {
    toast('Install this language via Termux: pkg install ' + id);
    return;
  }
  btn.disabled = true; btn.textContent = 'See below\u2026';
  label.textContent = 'Install via Termux: pkg install python';
  toast('Open Termux Terminal and run: pkg install python');
}
async function loadLanguages(box) {
  try {
    const list = await call('languages.list');
    list.forEach(l => {
      const row = el('div', 'lang-item'); const t = el('div', 't'); t.append(el('div', '', l.label)); row.appendChild(t);
      if (l.installed) { t.append(el('div', 'muted', 'Termux: Installed')); if (l.hasPackages) { const pk = el('button', '', 'Packages'); pk.onclick = () => installPackages(l.id, l.label); row.appendChild(pk); } }
      else if (l.installable) { const b = el('button', '', 'Install via Termux'); b.onclick = () => installLanguageViaTermux(l.id, l.label, b); row.appendChild(b); }
      else { t.append(el('div', 'muted', 'not detected')); }
      box.appendChild(row);
    });
  } catch (e) { /* termux not available — skip */ }
}
async function installLanguageViaTermux(id, label, btn) {
  btn.disabled = true; btn.textContent = 'Installing\u2026';
  try { const r = await call('languages.install', { id }); toast(r.ok ? label + ' installed' : 'Install may have failed'); if (!r.ok) { openConsole(); if (r.stdout) consoleWrite(r.stdout); if (r.stderr) consoleWrite(r.stderr, true); } await loadDeLinuxRuntimes(); } catch (e) { fail(e); btn.disabled = false; btn.textContent = 'Install via Termux'; }
}
async function installPackages(id, label) {
  const pkgs = await modal({ title: label + ' packages', text: 'Space-separated', value: '' }); if (!pkgs || !pkgs.trim()) return;
  try { const r = await busy('Installing packages\u2026', () => call('languages.installPackages', { id, packages: pkgs.trim() })); if (r.ok) toast('Packages installed'); else { openConsole(); if (r.stdout) consoleWrite(r.stdout); if (r.stderr) consoleWrite(r.stderr, true); } } catch (e) { fail(e); }
}

// ============================================================
// Termux Terminal (real shell — separate from Console Output)
// ============================================================
function openTerminal() { showScreen('#termuxScreen'); }
$('#tmBack').onclick = closeScreens;
$('#tmClear').onclick = () => { $('#tmOutput').textContent = ''; };
function appendTerm(text) { const box = $('#tmOutput'); box.textContent += (box.textContent ? '\n' : '') + text; box.scrollTop = box.scrollHeight; }
async function termRun() {
  const cmd = $('#tmInput').value.trim(); if (!cmd) return;
  if (!project) { appendTerm('$ ' + cmd + '\n(open a project first so a working directory is set)'); return; }
  appendTerm('$ ' + cmd); $('#tmInput').value = '';
  try {
    const r = await call('termux.run', { project, path: '', command: cmd });
    if (r.stdout) appendTerm(r.stdout.replace(/\s+$/, ''));
    if (r.stderr) appendTerm(r.stderr.replace(/\s+$/, ''));
    appendTerm('Process finished with exit code ' + r.exitCode);
  } catch (e) { appendTerm('error: ' + e.message); }
}
$('#tmRun').onclick = termRun;
$('#tmInput').addEventListener('keydown', e => { if (e.key === 'Enter') termRun(); });

// ---------- back button ----------
window.sariBack = () => {
  if (!$('#modal').hidden) { $('#mCancel').click(); return true; }
  if (!$('#sheetWrap').hidden) { closeSheet(); return true; }
  if (!$('#findBar').hidden) { $('#fbClose').click(); return true; }
  if (!$('#preview').hidden) { $('#btnClosePreview').click(); return true; }
  if (!$('#consolePanel').hidden) { closeConsole(); return true; }
  if (!$('#runDetail').hidden) { $('#rdBack').click(); return true; }
  if (!$('#githubScreen').hidden) { closeScreens(); return true; }
  if (!$('#settingsScreen').hidden) { closeScreens(); return true; }
  if (!$('#termuxScreen').hidden) { closeScreens(); return true; }
  if (!$('#ide').hidden) {
    if ($('#ide').classList.contains('open')) { $('#ide').classList.remove('open'); return true; }
    showHome(); return true;
  }
  return false;
};
applyIcons(); showHome();
