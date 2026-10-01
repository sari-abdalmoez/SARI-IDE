'use strict';

// ============================================================
// Error Parser and Cleaner
// Detects common runtime/compile errors and formats them cleanly
// ============================================================

const errorParser = (() => {
  // Error detection patterns
  const ERROR_PATTERNS = {
    // Python errors
    SyntaxError: {
      pattern: /SyntaxError:\s*([^\n]+)(?:\n\s*File\s+"([^"]+)",\s*line\s+(\d+))?/i,
      type: 'SyntaxError',
      extract: (match) => ({
        message: match[1] || 'Syntax error',
        file: match[2] || 'unknown',
        line: match[3] || '?',
      }),
    },
    NameError: {
      pattern: /NameError:\s*([^\n]+)/i,
      type: 'NameError',
      extract: (match) => ({
        message: match[1] || 'Name error',
        suggestion: extractSuggestion(match[1]),
      }),
    },
    TypeError: {
      pattern: /TypeError:\s*([^\n]+)/i,
      type: 'TypeError',
      extract: (match) => ({
        message: match[1] || 'Type error',
      }),
    },
    ValueError: {
      pattern: /ValueError:\s*([^\n]+)/i,
      type: 'ValueError',
      extract: (match) => ({
        message: match[1] || 'Value error',
      }),
    },
    ImportError: {
      pattern: /ImportError:\s*([^\n]+)/i,
      type: 'ImportError',
      extract: (match) => ({
        message: match[1] || 'Import error',
      }),
    },
    ModuleNotFoundError: {
      pattern: /ModuleNotFoundError:\s*([^\n]+)|No module named ['"]([^'"]+)['"]/i,
      type: 'ModuleNotFoundError',
      extract: (match) => {
        const message = match[1] || `No module named '${match[2]}'`;
        return {
          message,
          module: match[2],
          suggestion: match[2] ? `Try installing: pip install ${match[2]}` : null,
        };
      },
    },
    FileNotFoundError: {
      pattern: /FileNotFoundError:\s*([^\n]+)|No such file or directory:\s*['"]?([^'"]+)['"]?/i,
      type: 'FileNotFoundError',
      extract: (match) => ({
        message: match[1] || `File not found: ${match[2]}`,
        file: match[2],
      }),
    },
    PermissionError: {
      pattern: /PermissionError:\s*([^\n]+)/i,
      type: 'PermissionError',
      extract: (match) => ({
        message: match[1] || 'Permission denied',
      }),
    },
    IndentationError: {
      pattern: /IndentationError:\s*([^\n]+)(?:\n\s*File\s+"([^"]+)",\s*line\s+(\d+))?/i,
      type: 'IndentationError',
      extract: (match) => ({
        message: match[1] || 'Indentation error',
        file: match[2],
        line: match[3],
      }),
    },
    AttributeError: {
      pattern: /AttributeError:\s*([^\n]+)/i,
      type: 'AttributeError',
      extract: (match) => ({
        message: match[1] || 'Attribute error',
      }),
    },
    ZeroDivisionError: {
      pattern: /ZeroDivisionError:\s*([^\n]+)/i,
      type: 'ZeroDivisionError',
      extract: (match) => ({
        message: match[1] || 'Division by zero',
      }),
    },
    RuntimeError: {
      pattern: /RuntimeError:\s*([^\n]+)/i,
      type: 'RuntimeError',
      extract: (match) => ({
        message: match[1] || 'Runtime error',
      }),
    },

    // C/C++ Compilation Errors
    CompilationError: {
      pattern: /error:\s*([^\n]+)(?:\n\s*at\s+([^:\s]+):(\d+))?/i,
      type: 'CompilationError',
      extract: (match) => ({
        message: match[1] || 'Compilation error',
        file: match[2],
        line: match[3],
      }),
    },
    UndefinedReference: {
      pattern: /undefined reference to\s+[`']([^'`]+)[`']/i,
      type: 'UndefinedReference',
      extract: (match) => ({
        message: `Undefined reference to '${match[1]}'`,
        symbol: match[1],
        suggestion: 'Check that all libraries are linked and symbols are defined',
      }),
    },
    NoSuchFileOrDirectory: {
      pattern: /([^:]+):\s*No such file or directory/i,
      type: 'FileNotFoundError',
      extract: (match) => ({
        message: `File not found: ${match[1]}`,
        file: match[1],
      }),
    },
    IncludeNotFound: {
      pattern: /fatal error:\s*([^:\n]+):\s*No such file or directory/i,
      type: 'IncludeNotFound',
      extract: (match) => ({
        message: `Header file not found: ${match[1]}`,
        file: match[1],
        suggestion: 'Check the #include path or install the required library',
      }),
    },

    // Java/Kotlin Errors
    JavaCompilationError: {
      pattern: /error:\s*([^\n]+)\s+at\s+(\S+):(\d+)/i,
      type: 'JavaCompilationError',
      extract: (match) => ({
        message: match[1],
        file: match[2],
        line: match[3],
      }),
    },

    // Generic Runtime Crash
    SegmentationFault: {
      pattern: /Segmentation fault|SIGSEGV/i,
      type: 'SegmentationFault',
      extract: () => ({
        message: 'Segmentation fault (memory access violation)',
        suggestion: 'Check array bounds, pointer dereferences, and memory management',
      }),
    },
    AbortSignal: {
      pattern: /Aborted|SIGABRT/i,
      type: 'AbortSignal',
      extract: () => ({
        message: 'Process aborted',
      }),
    },
  };

  function extractSuggestion(message) {
    // NameError suggestions
    if (message.includes('prin')) return 'Did you mean `print`?';
    if (message.includes('str(')) return 'Did you mean `str()`?';
    if (message.includes('len(')) return 'Did you mean `len()`?';
    if (message.includes('range(')) return 'Did you mean `range()`?';
    if (message.includes('input(')) return 'Did you mean `input()`?';
    if (message.includes('int(')) return 'Did you mean `int()`?';
    if (message.includes('float(')) return 'Did you mean `float()`?';
    if (message.includes('list(')) return 'Did you mean `list()`?';
    if (message.includes('dict(')) return 'Did you mean `dict()`?';
    if (message.includes('set(')) return 'Did you mean `set()`?';
    return null;
  }

  function parseError(stderr, stdout, exitCode) {
    if (exitCode === 0) return null; // No error
    if (!stderr && !stdout) return null; // No output

    const combined = stderr + '\n' + stdout;

    // Try each error pattern
    for (const [key, errorDef] of Object.entries(ERROR_PATTERNS)) {
      const match = errorDef.pattern.exec(combined);
      if (match) {
        return {
          type: errorDef.type,
          ...errorDef.extract(match),
          exitCode,
          rawStderr: stderr,
          rawStdout: stdout,
          rawCombined: combined,
        };
      }
    }

    // Generic error fallback
    return {
      type: 'RuntimeError',
      message: stderr || stdout || `Process exited with code ${exitCode}`,
      exitCode,
      rawStderr: stderr,
      rawStdout: stdout,
      rawCombined: combined,
    };
  }

  function renderErrorCard(error) {
    if (!error) return '';

    const card = el('div', 'error-card');
    card.innerHTML = `
      <div class="error-header">
        <span class="error-icon">⚠️</span>
        <span class="error-type">${error.type}</span>
      </div>
      <div class="error-message">${escapeHtml(error.message)}</div>
      ${error.file ? `<div class="error-detail">File: <code>${escapeHtml(error.file)}</code></div>` : ''}
      ${error.line ? `<div class="error-detail">Line: <code>${escapeHtml(error.line)}</code></div>` : ''}
      ${error.module ? `<div class="error-detail">Module: <code>${escapeHtml(error.module)}</code></div>` : ''}
      ${error.symbol ? `<div class="error-detail">Symbol: <code>${escapeHtml(error.symbol)}</code></div>` : ''}
      ${error.suggestion ? `<div class="error-suggestion">💡 ${escapeHtml(error.suggestion)}</div>` : ''}
    `;
    return card;
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
  }

  function sanitizeOutput(output, filePath) {
    // Hide Termux internal paths and commands
    const projectPrefix = '/storage/emulated/0/SARIProjects/';
    const shortName = filePath.split('/').pop();

    return output
      .split('\n')
      .map(line => {
        // Hide full storage paths
        if (line.includes(projectPrefix)) {
          return line.replace(new RegExp(projectPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'project/');
        }
        // Hide temporary compilation binaries
        if (line.includes('sari_run_') || line.includes('sari_java_') || line.includes('sari_kotlin_')) {
          return '';
        }
        // Hide compilation success markers from our build system
        if (line.includes('-- compile OK --')) {
          return '';
        }
        // Hide /data/data paths
        if (line.includes('/data/data/com.termux/files')) {
          return line.replace(/\/data\/data\/com\.termux\/files[^ \t]*/g, '[tmp]');
        }
        return line;
      })
      .filter(line => line.trim())
      .join('\n');
  }

  return {
    parseError,
    renderErrorCard,
    sanitizeOutput,
    ERROR_PATTERNS,
  };
})();
