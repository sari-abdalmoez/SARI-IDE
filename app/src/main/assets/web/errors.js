'use strict';

const errorParser = (() => {
  const patterns = [
    ['SyntaxError', /(?:SyntaxError|IndentationError):\s*([^\n]+)/i],
    ['NameError', /NameError:\s*([^\n]+)/i],
    ['TypeError', /TypeError:\s*([^\n]+)/i],
    ['ImportError', /ImportError:\s*([^\n]+)/i],
    ['ModuleNotFoundError', /(?:ModuleNotFoundError:\s*([^\n]+)|No module named ["']([^"']+)["'])/i],
    ['FileNotFoundError', /FileNotFoundError:\s*([^\n]+)|No such file or directory:\s*["']?([^"'\n]+)["']?/i],
    ['PermissionError', /PermissionError:\s*([^\n]+)/i],
    ['ValueError', /ValueError:\s*([^\n]+)/i],
    ['AttributeError', /AttributeError:\s*([^\n]+)/i],
    ['CompilationError', /(?:fatal error|error):\s*([^\n]+)/i],
    ['RuntimeError', /(?:RuntimeError|Segmentation fault|SIGSEGV|SIGABRT):?\s*([^\n]*)/i],
  ];
  function parseError(stderr = '', stdout = '', exitCode = 1, filePath = '') {
    if (Number(exitCode) === 0) return null;
    const raw = `${stderr}\n${stdout}`;
    let type = 'RuntimeError', message = stderr.trim() || stdout.trim() || `Process exited with code ${exitCode}`;
    let match = null;
    for (const [name, pattern] of patterns) { const found = pattern.exec(raw); if (found) { type = name; match = found; message = found[1] || found[2] || message; break; } }
    const location = /(?:File\s+["']([^"']+)["'],\s*line\s+(\d+)|([\w./-]+):(\d+)(?::\d+)?)/i.exec(raw);
    const module = type === 'ModuleNotFoundError' ? (match && (match[2] || (match[1] || '').match(/["']([^"']+)["']/)?.[1])) : null;
    let suggestion = '';
    if (type === 'NameError' && /prin/.test(message)) suggestion = 'Did you mean print?';
    else if (type === 'ModuleNotFoundError' || type === 'ImportError') suggestion = module ? `Install or configure the required package: ${module}` : 'Install or configure the required runtime/package.';
    else if (type === 'CompilationError') suggestion = 'Check the highlighted source line and required headers or libraries.';
    return { type, message: message.replace(/^.*?:\s*/, type === 'RuntimeError' ? '' : ''), file: location ? (location[1] || location[3] || filePath) : filePath, line: location ? (location[2] || location[4]) : '', module, suggestion, exitCode: Number(exitCode), rawStderr: stderr, rawStdout: stdout, raw };
  }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderErrorCard(error) {
    const card = document.createElement('div'); card.className = 'error-card';
    card.innerHTML = `<div class="error-header"><span class="error-icon">⚠</span><strong>Runtime Error</strong></div><div class="error-kind">${escape(error.type)}</div><div class="error-message">${escape(error.message)}</div>${error.file ? `<div class="error-detail">File: <code>${escape(error.file.split('/').pop())}</code></div>` : ''}${error.line ? `<div class="error-detail">Line: <code>${escape(error.line)}</code></div>` : ''}${error.module ? `<div class="error-detail">Module: <code>${escape(error.module)}</code></div>` : ''}${error.suggestion ? `<div class="error-suggestion">Suggestion: ${escape(error.suggestion)}</div>` : ''}`;
    return card;
  }
  function sanitizeOutput(value = '') { return String(value).split('\n').filter(line => !/^\s*\$\s*(python|python3|node|bash|clang\+?|javac|kotlinc)\b/i.test(line) && !line.includes('-- compile OK --')).map(line => line.replace(/\/storage\/emulated\/0\/SARIProjects\/[^\s"']*/g, '').replace(/\/data\/data\/com\.termux\/files[^\s"']*/g, '[runtime]')).filter(Boolean).join('\n').trim(); }
  return { parseError, renderErrorCard, sanitizeOutput };
})();

// Integrate after app.js has installed its existing handlers. The old console remains available from the menu.
window.addEventListener('DOMContentLoaded', () => setTimeout(() => {
  const $ = s => document.querySelector(s);
  const out = $('#outputScreen'); if (!out || typeof runFile !== 'function') return;
  let last = null, running = false, details = null;
  const program = $('#programOutput'), error = $('#outputError'), finished = $('#outputFinished'), welcome = $('#outputWelcome');
  const raw = $('#detailStderr'), exit = $('#detailExitCode'), command = $('#detailCommand'), path = $('#detailPath'), panel = $('#outputDetailsPanel');
  const show = () => { out.hidden = false; $('#ide').hidden = true; $('#home').hidden = true; };
  const reset = () => { program.textContent = ''; error.textContent = ''; error.hidden = true; finished.hidden = true; welcome.hidden = true; panel.hidden = true; panel.open = false; };
  const render = (r, file, cmd) => { const stdout = r?.stdout || '', stderr = r?.stderr || ''; const code = Number(r?.exitCode ?? 1); const clean = sanitizeOutput(stdout); program.textContent = clean; if (code === 0) finished.hidden = false; else { const parsed = parseError(stderr, stdout, code, file); if (parsed) error.appendChild(renderErrorCard(parsed)); error.hidden = false; } raw.textContent = stderr || stdout || ''; exit.textContent = String(code); command.textContent = cmd || ''; path.textContent = file || ''; };
  const original = window.runFile;
  window.runFile = async function(file, lang) {
    last = { file, lang }; reset(); show(); running = true; $('#outStatus').hidden = false; $('#outStop').hidden = false; $('#outTitle').textContent = file.split('/').pop();
    if (lang === 'html' || lang === 'htm') { running = false; $('#outStatus').hidden = true; $('#outStop').hidden = true; return original.call(this, file, lang); }
    // Capture the existing backend response while preserving its Termux command construction and security path handling.
    const oldWrite = window.consoleWrite;
    let captured = { stdout: '', stderr: '', exitCode: 1 };
    try {
      // Existing runFile renders to the legacy console; we mirror its final state by calling the backend directly.
      const cmd = typeof buildRunCommand === 'function' ? buildRunCommand(file, lang) : '';
      const r = await call('termux.run', { project, path: '', command: cmd, stdin: $('#consoleStdin')?.value || null });
      captured = r || captured; render(captured, file, cmd);
    } catch (e) { captured.stderr = e.message || String(e); render(captured, file, ''); }
    finally { running = false; $('#outStatus').hidden = true; $('#outStop').hidden = true; }
  };
  $('#btnRun').onclick = () => { if (typeof run === 'function') run(); };
  $('#outBack').onclick = () => { out.hidden = true; $('#ide').hidden = false; };
  $('#outRerun').onclick = () => { if (last) window.runFile(last.file, last.lang); };
  $('#outCopy').onclick = async () => { try { await navigator.clipboard.writeText(program.textContent); toast('Copied'); } catch (_) { toast('Copy failed'); } };
  $('#outClear').onclick = reset;
  $('#outDetails').onclick = () => { panel.hidden = false; panel.open = !panel.open; };
  $('#outStop').onclick = () => { running = false; if (typeof activeConsoleSessionId !== 'undefined') activeConsoleSessionId = -1; $('#outStatus').hidden = true; $('#outStop').hidden = true; program.textContent += '\n\nStopped'; };
}, 0));
