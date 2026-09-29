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
function busy(text, fn) {
  $('#busyText').textContent = text; $('#busy').hidden = false;
  return Promise.resolve().then(fn).finally(() => { $('#busy').hidden = true; });
}

// ---------- state ----------
let project = null, tabs = [], active = -1, clip = null, saveTimer = null;
const expanded = new Set(['']);
const cache = new Map();
let fontSize = +localStorage.getItem('fontSize') || 14;
let autoSave = localStorage.getItem('autoSave') !== 'off';
applyFont();
document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';

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
let projectLang = '';
async function openProject(name) {
  project = name; tabs = []; active = -1; clip = null; projectLang = '';
  expanded.clear(); expanded.add(''); cache.clear();
  closeScreens();
  $('#home').hidden = true; $('#ide').hidden = false; $('#ide').classList.remove('open');
  $('#projName').textContent = name;
  renderTabs(); showActive();
  try {
    await refreshTree();
    const meta = JSON.parse(await call('readFile', { project, path: '.sari/project.json' }));
    projectLang = meta.language || '';
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
  items.push({ label: 'Open', fn: () => isDir ? null : openFile(p) });
  if (isDir) items.push(
    { label: 'New file here', fn: () => newEntry('createFile', p) },
    { label: 'New folder here', fn: () => newEntry('createDir', p) });
  items.push(
    { label: 'Move', fn: () => moveEntry(p) },
    { label: 'Copy', fn: () => { clip = { path: p, mode: 'copy' }; toast('Copied — open a folder\'s menu and choose Paste here'); } },
    { label: 'Rename', fn: () => renameEntry(p) });
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
async function importFiles() {
  try {
    const names = await busy('Importing…', () => call('importFiles', { project, dir: '' }));
    if (names && names.length) { await refreshTree(); toast('Imported ' + names.length + ' file(s)'); }
  } catch (e) { fail(e); }
}
async function importFolder() {
  try {
    const name = await busy('Importing folder…', () => call('importFolder', { project, dir: '' }));
    if (name) { await refreshTree(); toast('Imported "' + name + '"'); }
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
document.querySelectorAll('#keys [data-ins]').forEach(b => {
  b.addEventListener('pointerdown', e => e.preventDefault());
  b.onclick = () => insert(b.dataset.ins);
});
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
  $('#fbFind').focus();
  recomputeHits();
}
function recomputeHits() {
  const q = $('#fbFind').value;
  searchHits = [];
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
$('#fbReplaceOne').onclick = () => {
  if (searchIdx < 0) return;
  const q = $('#fbFind').value, r = $('#fbReplace').value, pos = searchHits[searchIdx];
  ed.setSelectionRange(pos, pos + q.length); insert(r); recomputeHits();
};
$('#fbReplaceAll').onclick = () => {
  const q = $('#fbFind').value, r = $('#fbReplace').value; if (!q) return;
  ed.value = ed.value.split(q).join(r); ed.dispatchEvent(new Event('input')); recomputeHits();
  toast('Replaced all');
};
$('#fbClose').onclick = () => { $('#findBar').hidden = true; searchHits = []; };
async function goToLine() {
  const v = await modal({ title: 'Go to line', value: '' }); if (!v) return;
  const n = parseInt(v, 10); if (!n || !tabs[active]) return;
  const lines = ed.value.split('\n');
  let pos = 0; for (let i = 0; i < Math.min(n - 1, lines.length); i++) pos += lines[i].length + 1;
  ed.focus(); ed.setSelectionRange(pos, pos);
  ed.scrollTop = Math.max(0, (n - 4) * parseFloat(getComputedStyle(ed).lineHeight));
  updateStatus();
}
$('#btnEditorMenu').onclick = () => sheet([
  { label: 'Search', fn: () => doSearch(false) },
  { label: 'Search & Replace', fn: () => doSearch(true) },
  { label: 'Go to line', fn: goToLine },
  { label: 'Auto-save: ' + (autoSave ? 'On (tap to turn off)' : 'Off (tap to turn on)'), fn: () => { autoSave = !autoSave; localStorage.setItem('autoSave', autoSave ? 'on' : 'off'); toast('Auto-save ' + (autoSave ? 'on' : 'off')); } },
]);

// ---------- run / build ----------
const ext = p => (p.split('.').pop() || '').toLowerCase();
const RUN_CMD = {
  python: f => `python3 '${f}'`,
  javascript: f => `node '${f}'`,
  bash: f => `bash '${f}'`,
  c: f => `clang '${f}' -O2 -o /data/data/com.termux/files/usr/tmp/sari_run && /data/data/com.termux/files/usr/tmp/sari_run`,
  cpp: f => `clang++ '${f}' -O2 -o /data/data/com.termux/files/usr/tmp/sari_run && /data/data/com.termux/files/usr/tmp/sari_run`,
  java: f => `javac '${f}' -d /data/data/com.termux/files/usr/tmp/sari_java && java -cp /data/data/com.termux/files/usr/tmp/sari_java ${f.split('/').pop().replace(/\\.java$/, '')}`,
  kotlin: f => `kotlinc '${f}' -include-runtime -d /data/data/com.termux/files/usr/tmp/sari_run.jar && java -jar /data/data/com.termux/files/usr/tmp/sari_run.jar`,
};
async function run() {
  if (!project) return;
  try { await saveAll(); } catch (e) { return; }
  const t = tabs[active];
  let htmlPath = t && ['html', 'htm'].includes(ext(t.path)) ? t.path : null;
  if (!htmlPath) {
    try { await call('readFile', { project, path: 'index.html' }); htmlPath = 'index.html'; } catch (e) { /* none */ }
  }
  if (htmlPath) return previewHtml(htmlPath);
  const lang = projectLang || (t ? guessLang(t.path) : '');
  const builder = RUN_CMD[lang];
  const file = (t ? t.path : null);
  if (!builder || !file) return toast('No runnable file for this language yet.');
  await runInTerminal(builder(file), 'Run: ' + file);
}
function guessLang(path) {
  const e = ext(path);
  return { py: 'python', js: 'javascript', sh: 'bash', c: 'c', cpp: 'cpp', cc: 'cpp', java: 'java', kt: 'kotlin' }[e] || '';
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
async function build() {
  if (!project) return;
  const st = await call('github.status').catch(() => ({ connected: false }));
  if (!st.connected) { toast('Connect GitHub first (🐙) to build with GitHub Actions'); return openGithubScreen(); }
  if (!await modal({ title: 'Build with GitHub Actions', text: 'This pushes every file in "' + project + '" to ' + st.repo + ' (' + st.branch + ') and triggers the Android build workflow.', ok: 'Push & Build' })) return;
  try {
    const count = await busy('Pushing project…', () => call('github.pushAll', { project, message: 'Update ' + project + ' via SARI IDE' }));
    toast('Pushed ' + count + ' file(s)');
    const run = await busy('Starting workflow…', () => call('github.triggerWorkflow', { workflowFile: 'android-build.yml', ref: st.branch }));
    openGithubScreen();
    if (run && run.id) openRunDetail(run.id); else refreshGithubRuns();
  } catch (e) { fail(e); }
}

// ---------- menus & shortcuts ----------
function moreMenu() {
  sheet([
    { label: 'Terminal', fn: openTerminal },
    { label: 'GitHub', fn: openGithubScreen },
    { label: 'Settings', fn: openSettings },
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
  showScreen('#githubScreen');
  $('#ghProjName').textContent = project || '(none — open a project first)';
  refreshGithubStatus();
}
$('#ghBack').onclick = closeScreens;
$('#ghRefresh').onclick = () => refreshGithubStatus();
async function refreshGithubStatus() {
  try {
    const st = await call('github.status');
    $('#ghDisconnected').hidden = st.connected;
    $('#ghConnected').hidden = !st.connected;
    if (st.connected) {
      $('#ghStatusLine').textContent = 'Connected as ' + st.username;
      $('#ghRepoLine').textContent = st.repo + ' · branch ' + st.branch;
      refreshGithubRuns();
    }
  } catch (e) { fail(e); }
}
$('#ghConnect').onclick = async () => {
  const username = $('#ghUser').value.trim(), token = $('#ghToken').value, repo = $('#ghRepo').value.trim(), branch = $('#ghBranch').value.trim();
  if (!username || !token || !repo) return toast('Username, token and repository are required');
  try {
    await busy('Connecting…', () => call('github.connect', { username, token, repo, branch }));
    $('#ghToken').value = '';
    toast('Connected'); refreshGithubStatus();
  } catch (e) { fail(e); }
};
$('#ghDisconnect').onclick = async () => {
  if (!await modal({ title: 'Disconnect GitHub?', ok: 'Disconnect' })) return;
  await call('github.disconnect'); refreshGithubStatus();
};
$('#ghPullAll').onclick = async () => {
  if (!project) return toast('Open a project first');
  if (!await modal({ title: 'Pull all files?', text: 'Overwrites local files with the repository\u2019s versions.', ok: 'Pull' })) return;
  try { const n = await busy('Pulling…', () => call('github.pullAll', { project })); await refreshTree(); toast('Pulled ' + n + ' file(s)'); } catch (e) { fail(e); }
};
$('#ghPushAll').onclick = async () => {
  if (!project) return toast('Open a project first');
  const msg = await modal({ title: 'Commit message', value: 'Update ' + project + ' via SARI IDE' }); if (msg === null) return;
  try { await saveAll(); const n = await busy('Pushing…', () => call('github.pushAll', { project, message: msg })); toast('Pushed ' + n + ' file(s)'); } catch (e) { fail(e); }
};
$('#ghBranches').onclick = async () => {
  try {
    const list = await busy('Loading branches…', () => call('github.listBranches'));
    sheet([...list.map(b => ({ label: b, fn: () => toast('Current branch stays "' + b + '" once selected via Connect') })),
      { label: '+ Create branch…', fn: createBranch }]);
  } catch (e) { fail(e); }
};
async function createBranch() {
  const name = await modal({ title: 'New branch name', value: '' }); if (!name) return;
  try { await busy('Creating…', () => call('github.createBranch', { name: name.trim(), from: 'main' })); toast('Branch "' + name + '" created'); } catch (e) { fail(e); }
}
$('#ghTrigger').onclick = async () => {
  try {
    const run = await busy('Starting workflow…', () => call('github.triggerWorkflow', { workflowFile: 'android-build.yml', ref: '' }));
    if (run && run.id) openRunDetail(run.id); else refreshGithubRuns();
  } catch (e) { fail(e); }
};
async function refreshGithubRuns() {
  try {
    const runs = await call('github.listRuns');
    const box = $('#ghRuns'); box.textContent = '';
    runs.slice(0, 10).forEach(r => {
      const item = el('div', 'run-item');
      const t = el('div', 't');
      t.append(el('div', '', '#' + r.run_number + ' — ' + (r.display_title || r.name || 'build')));
      t.append(el('div', 'muted', new Date(r.created_at).toLocaleString()));
      const badge = el('span', 'badge ' + badgeClass(r), badgeText(r));
      item.append(t, badge);
      item.onclick = () => openRunDetail(r.id);
      box.appendChild(item);
    });
  } catch (e) { /* not fatal */ }
}
function badgeClass(r) { if (r.status !== 'completed') return 'run'; return r.conclusion === 'success' ? 'ok' : 'fail'; }
function badgeText(r) { return r.status !== 'completed' ? r.status : r.conclusion; }

// ---- run detail ----
let currentRunId = null, pollTimer = null;
function openRunDetail(runId) {
  currentRunId = runId;
  showScreen('#runDetail');
  loadRunDetail();
  clearInterval(pollTimer);
  pollTimer = setInterval(loadRunDetail, 6000);
}
$('#rdBack').onclick = () => { clearInterval(pollTimer); closeScreens(); openGithubScreen(); };
$('#rdRefresh').onclick = loadRunDetail;
async function loadRunDetail() {
  if (!currentRunId) return;
  try {
    const run = await call('github.getRun', { runId: currentRunId });
    const box = $('#rdStatus'); box.textContent = '';
    const t = el('div', 't');
    t.append(el('div', '', 'Run #' + run.run_number), el('div', 'muted', run.status + (run.conclusion ? ' · ' + run.conclusion : '')));
    box.append(t, el('span', 'badge ' + badgeClass(run), badgeText(run)));
    if (run.status === 'completed') {
      clearInterval(pollTimer);
      const logs = await call('github.getRunLogs', { runId: currentRunId });
      $('#rdLogs').textContent = logs;
      const arts = await call('github.listArtifacts', { runId: currentRunId });
      const abox = $('#rdArtifacts'); abox.textContent = '';
      if (run.conclusion === 'success' && arts.length) {
        abox.appendChild(el('div', 'sectionTitle', 'Artifacts'));
        arts.forEach(a => {
          const row = el('div', 'run-item');
          row.append(el('div', 't', a.name + ' (' + Math.round(a.size_in_bytes / 1024) + ' KB)'));
          const dl = el('button', 'primary', 'Download');
          dl.onclick = () => downloadArtifact(a.id);
          row.appendChild(dl);
          abox.appendChild(row);
        });
      }
    } else {
      $('#rdLogs').textContent = 'Build is ' + run.status + ' — logs appear once it completes.';
    }
  } catch (e) { fail(e); }
}
async function downloadArtifact(artifactId) {
  if (!project) return toast('Open a project first');
  try {
    const res = await busy('Downloading artifact…', () => call('github.downloadArtifact', { project, artifactId }));
    if (res.apks && res.apks.length) {
      sheet(res.apks.map(p => ({ label: 'Install ' + p.split('/').pop(), fn: () => call('github.installApk', { path: p }).catch(fail) })));
    } else {
      toast('Downloaded to ' + res.extractedTo);
    }
  } catch (e) { fail(e); }
}

// ============================================================
// Settings / languages
// ============================================================
async function openSettings() {
  showScreen('#settingsScreen');
  const avail = await call('termux.available').catch(() => false);
  $('#stTermuxWarn').hidden = !!avail;
  loadLanguages();
}
$('#stBack').onclick = closeScreens;
$('#stTheme').onclick = () => { const d = document.documentElement, n = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = n; localStorage.setItem('theme', n); };
$('#stFontUp').onclick = () => { fontSize = Math.min(28, fontSize + 1); localStorage.setItem('fontSize', fontSize); applyFont(); };
$('#stFontDown').onclick = () => { fontSize = Math.max(10, fontSize - 1); localStorage.setItem('fontSize', fontSize); applyFont(); };
async function loadLanguages() {
  const box = $('#langList'); box.textContent = 'Checking installed languages…';
  try {
    const list = await call('languages.list');
    box.textContent = '';
    list.forEach(l => {
      const row = el('div', 'lang-item');
      row.append(el('div', 'ico', l.icon));
      const t = el('div', 't'); t.append(el('div', '', l.label));
      row.appendChild(t);
      if (l.installed) {
        t.append(el('div', 'muted', '✓ Installed'));
        if (l.hasPackages) { const pk = el('button', '', 'Packages'); pk.onclick = () => installPackages(l.id, l.label); row.appendChild(pk); }
      } else if (l.installable) {
        const b = el('button', 'primary', 'Install');
        b.onclick = () => installLanguage(l.id, l.label, b);
        row.appendChild(b);
      } else {
        t.append(el('div', 'muted', 'not detected'));
      }
      box.appendChild(row);
    });
  } catch (e) { box.textContent = ''; fail(e); }
}
async function installLanguage(id, label, btn) {
  btn.disabled = true; btn.textContent = 'Installing…';
  try {
    const r = await call('languages.install', { id });
    toast((r.ok ? label + ' installed' : 'Install may have failed — check output') );
    if (!r.ok) showLogSheet(r);
    await loadLanguages();
  } catch (e) { fail(e); btn.disabled = false; btn.textContent = 'Install'; }
}
async function installPackages(id, label) {
  const pkgs = await modal({ title: label + ' packages', text: 'Space-separated, e.g. numpy requests', value: '' });
  if (!pkgs || !pkgs.trim()) return;
  try {
    const r = await busy('Installing packages…', () => call('languages.installPackages', { id, packages: pkgs.trim() }));
    toast(r.ok ? 'Packages installed' : 'Install may have failed'); if (!r.ok) showLogSheet(r);
  } catch (e) { fail(e); }
}
function showLogSheet(r) {
  const text = (r.stdout || '') + '\n' + (r.stderr || '');
  openTerminalWithOutput(text || 'No output');
}

// ============================================================
// Terminal
// ============================================================
function openTerminal() { showScreen('#termuxScreen'); }
function openTerminalWithOutput(text) { openTerminal(); appendTerm(text); }
$('#tmBack').onclick = closeScreens;
$('#tmClear').onclick = () => { $('#tmOutput').textContent = ''; };
function appendTerm(text) {
  const box = $('#tmOutput');
  box.textContent += (box.textContent ? '\n' : '') + text;
  box.scrollTop = box.scrollHeight;
}
async function termRun() {
  const cmd = $('#tmInput').value.trim(); if (!cmd) return;
  if (!project) { appendTerm('$ ' + cmd + '\n(open a project first so a working directory is set)'); return; }
  appendTerm('$ ' + cmd);
  $('#tmInput').value = '';
  try {
    const r = await call('termux.run', { project, path: '', command: cmd });
    if (r.stdout) appendTerm(r.stdout.trimEnd());
    if (r.stderr) appendTerm(r.stderr.trimEnd());
    appendTerm('Process finished with exit code ' + r.exitCode);
  } catch (e) { appendTerm('error: ' + e.message); }
}
$('#tmRun').onclick = termRun;
$('#tmInput').addEventListener('keydown', e => { if (e.key === 'Enter') termRun(); });
async function runInTerminal(command, label) {
  openTerminal();
  appendTerm('$ ' + command);
  try {
    const r = await busy(label || 'Running…', () => call('termux.run', { project, path: '', command }));
    if (r.stdout) appendTerm(r.stdout.trimEnd());
    if (r.stderr) appendTerm(r.stderr.trimEnd());
    appendTerm('Process finished with exit code ' + r.exitCode);
  } catch (e) { appendTerm('error: ' + e.message); }
}

// ---------- back button ----------
window.sariBack = () => {
  if (!$('#modal').hidden) { $('#mCancel').click(); return true; }
  if (!$('#sheetWrap').hidden) { closeSheet(); return true; }
  if (!$('#findBar').hidden) { $('#fbClose').click(); return true; }
  if (!$('#preview').hidden) { $('#btnClosePreview').click(); return true; }
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

showHome();
