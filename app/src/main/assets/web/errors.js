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
    ['RuntimeError', /(?:RuntimeError|Segmentation fault|SIGSEGV|SIGABRT):?\s*([^\n]*)/i]
  ];

  function parseError(stderr = '', stdout = '', exitCode = 1, filePath = '') {
    if (Number(exitCode) === 0) return null;

    const raw = `${stderr}\n${stdout}`;

    let type = 'RuntimeError';
    let message =
      stderr.trim() ||
      stdout.trim() ||
      `Process exited with code ${exitCode}`;

    let match = null;

    for (const [name, pattern] of patterns) {
      const found = pattern.exec(raw);

      if (found) {
        type = name;
        match = found;
        message = found[1] || found[2] || message;
        break;
      }
    }

    const location =
      /(?:File\s+["']([^"']+)["'],\s*line\s+(\d+)|([\w./-]+):(\d+)(?::\d+)?)/i.exec(raw);

    const module =
      type === 'ModuleNotFoundError'
        ? match &&
          (match[2] ||
            (match[1] || '').match(/["']([^"']+)["']/)?.[1])
        : null;

    let suggestion = '';

    if (type === 'NameError' && /prin/.test(message)) {
      suggestion = 'Did you mean print?';
    } else if (
      type === 'ModuleNotFoundError' ||
      type === 'ImportError'
    ) {
      suggestion = module
        ? `Install or configure the required package: ${module}`
        : 'Install or configure the required runtime/package.';
    } else if (type === 'CompilationError') {
      suggestion =
        'Check the highlighted source line and required headers or libraries.';
    }

    return {
      type,
      message: message.replace(/^.*?:\s*/, ''),
      file: location
        ? location[1] || location[3] || filePath
        : filePath,
      line: location ? location[2] || location[4] || '' : '',
      module,
      suggestion,
      exitCode: Number(exitCode),
      rawStderr: stderr,
      rawStdout: stdout,
      raw
    };
  }

  function escape(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      c =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[c]
    );
  }

  function renderErrorCard(error) {
    const card = document.createElement('div');
    card.className = 'error-card';

    card.innerHTML = `
      <div class="error-header">
        <span class="error-icon">⚠</span>
        <strong>Runtime Error</strong>
      </div>

      <div class="error-kind">${escape(error.type)}</div>

      <div class="error-message">
        ${escape(error.message)}
      </div>

      ${
        error.file
          ? `<div class="error-detail">
               File: <code>${escape(
                 error.file.split('/').pop()
               )}</code>
             </div>`
          : ''
      }

      ${
        error.line
          ? `<div class="error-detail">
               Line: <code>${escape(error.line)}</code>
             </div>`
          : ''
      }

      ${
        error.module
          ? `<div class="error-detail">
               Module: <code>${escape(error.module)}</code>
             </div>`
          : ''
      }

      ${
        error.suggestion
          ? `<div class="error-suggestion">
               Suggestion: ${escape(error.suggestion)}
             </div>`
          : ''
      }
    `;

    return card;
  }

  /*
   * Only the program's actual stdout is shown.
   * Execution metadata is removed:
   *   $ python3 ...
   *   $ node ...
   *   -- compile OK --
   *   Process finished ...
   *   /storage/emulated/0/SARIProjects/...
   */
  function sanitizeOutput(value = '') {
    return String(value)
      .split('\n')
      .filter(
        line =>
          !/^\s*\$\s*(python|python3|node|bash|clang\+?|javac|kotlinc)\b/i.test(
            line
          )
      )
      .filter(line => !line.includes('-- compile OK --'))
      .map(line =>
        line
          .replace(
            /\/storage\/emulated\/0\/SARIProjects\/[^\s"']*/g,
            ''
          )
          .replace(
            /\/data\/data\/com\.termux\/files[^\s"']*/g,
            ''
          )
      )
      .filter(line => line.trim() !== '')
      .join('\n')
      .trim();
  }

  return {
    parseError,
    renderErrorCard,
    sanitizeOutput
  };
})();


/*
 * Full-screen Program Output.
 *
 * Important:
 * - Does NOT modify icons.
 * - Does NOT use the old bottom Console Output when Run is pressed.
 * - Shows only actual program stdout on successful execution.
 * - Technical metadata is kept out of the normal output.
 */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const outputScreen = document.querySelector('#outputScreen');

    if (!outputScreen || typeof runFile !== 'function') {
      return;
    }

    const programOutput = document.querySelector('#programOutput');
    const outputError = document.querySelector('#outputError');
    const outputFinished = document.querySelector('#outputFinished');
    const outputWelcome = document.querySelector('#outputWelcome');

    const outputStdin = document.querySelector('#outputStdin');

    const outStatus = document.querySelector('#outStatus');
    const outStop = document.querySelector('#outStop');
    const outTitle = document.querySelector('#outTitle');

    const outBack = document.querySelector('#outBack');
    const outRerun = document.querySelector('#outRerun');
    const outCopy = document.querySelector('#outCopy');
    const outClear = document.querySelector('#outClear');
    const outDetails = document.querySelector('#outDetails');

    const detailsPanel =
      document.querySelector('#outputDetailsPanel');

    const detailExitCode =
      document.querySelector('#detailExitCode');

    const detailCommand =
      document.querySelector('#detailCommand');

    const detailPath =
      document.querySelector('#detailPath');

    const detailStderr =
      document.querySelector('#detailStderr');

    let lastRun = null;
    let running = false;

    function showOutputScreen() {
      outputScreen.hidden = false;

      const ide = document.querySelector('#ide');
      const home = document.querySelector('#home');

      if (ide) ide.hidden = true;
      if (home) home.hidden = true;
    }

    function resetOutput() {
      if (programOutput) {
        programOutput.textContent = '';
      }

      if (outputError) {
        outputError.textContent = '';
        outputError.hidden = true;
      }

      if (outputFinished) {
        outputFinished.hidden = true;
      }

      if (outputWelcome) {
        outputWelcome.hidden = true;
      }

      if (detailsPanel) {
        detailsPanel.hidden = true;
        detailsPanel.open = false;
      }

      if (detailExitCode) {
        detailExitCode.textContent = '';
      }

      if (detailCommand) {
        detailCommand.textContent = '';
      }

      if (detailPath) {
        detailPath.textContent = '';
      }

      if (detailStderr) {
        detailStderr.textContent = '';
      }
    }

    function setRunning(value) {
      running = value;

      if (outStatus) {
        outStatus.hidden = !value;
        outStatus.textContent = value ? 'running' : '';
      }

      if (outStop) {
        outStop.hidden = !value;
      }
    }

    function renderResult(result, filePath, command) {
      const stdout = result?.stdout || '';
      const stderr = result?.stderr || '';
      const exitCode = Number(result?.exitCode ?? 1);

      const cleanOutput =
        errorParser.sanitizeOutput(stdout);

      /*
       * SUCCESS:
       * show ONLY actual application output.
       */
      if (programOutput) {
        programOutput.textContent = cleanOutput;
        programOutput.scrollTop = programOutput.scrollHeight;
      }

      /*
       * FAILURE:
       * show a useful error instead of hiding it.
       */
      if (exitCode !== 0) {
        const parsed = errorParser.parseError(
          stderr,
          stdout,
          exitCode,
          filePath
        );

        if (outputError) {
          outputError.textContent = '';

          if (parsed) {
            outputError.appendChild(
              errorParser.renderErrorCard(parsed)
            );
          } else {
            outputError.textContent =
              stderr.trim() ||
              stdout.trim() ||
              `Process exited with code ${exitCode}`;
          }

          outputError.hidden = false;
        }
      }

      /*
       * Technical information exists only internally/details.
       * It is NOT shown in normal program output.
       */
      if (detailExitCode) {
        detailExitCode.textContent = String(exitCode);
      }

      if (detailCommand) {
        detailCommand.textContent = command || '';
      }

      if (detailPath) {
        detailPath.textContent = filePath || '';
      }

      if (detailStderr) {
        detailStderr.textContent = stderr;
      }

      /*
       * Never display "✓ Finished".
       */
      if (outputFinished) {
        outputFinished.hidden = true;
      }
    }

    const originalRunFile = window.runFile;

    window.runFile = async function(filePath, lang) {
      lastRun = { filePath, lang };

      resetOutput();
      showOutputScreen();

      if (outTitle) {
        outTitle.textContent =
          filePath.split('/').pop();
      }

      if (lang === 'html' || lang === 'htm') {
        return originalRunFile.call(
          this,
          filePath,
          lang
        );
      }

      setRunning(true);

      try {
        const command =
          typeof buildRunCommand === 'function'
            ? buildRunCommand(filePath, lang)
            : '';

        if (!command) {
          throw new Error(
            'No run command for language: ' + lang
          );
        }

        const stdin =
          outputStdin &&
          outputStdin.value.trim()
            ? outputStdin.value
            : null;

        /*
         * Direct execution.
         * We do NOT call the old console rendering path.
         */
        const result = await call('termux.run', {
          project,
          path: '',
          command,
          stdin
        });

        renderResult(
          result,
          filePath,
          command
        );
      } catch (e) {
        if (outputError) {
          outputError.textContent =
            e?.message || String(e);

          outputError.hidden = false;
        }
      } finally {
        setRunning(false);
      }
    };


    /*
     * Existing OUTPUT icons.
     * No new icons are created and no existing icon is replaced.
     */
    if (outBack) {
      outBack.onclick = () => {
        outputScreen.hidden = true;

        const ide = document.querySelector('#ide');
        if (ide) ide.hidden = false;
      };
    }

    if (outRerun) {
      outRerun.onclick = () => {
        if (lastRun) {
          window.runFile(
            lastRun.filePath,
            lastRun.lang
          );
        }
      };
    }

    if (outCopy) {
      outCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(
            programOutput
              ? programOutput.textContent
              : ''
          );

          if (typeof toast === 'function') {
            toast('Copied');
          }
        } catch (_) {
          if (typeof toast === 'function') {
            toast('Copy failed');
          }
        }
      };
    }

    if (outClear) {
      outClear.onclick = resetOutput;
    }

    if (outDetails) {
      outDetails.onclick = () => {
        if (!detailsPanel) return;

        detailsPanel.hidden = false;
        detailsPanel.open =
          !detailsPanel.open;
      };
    }

    if (outStop) {
      outStop.onclick = () => {
        /*
         * Termux execution cannot be hard-killed by this UI path,
         * but we stop showing it as active.
         */
        running = false;

        if (typeof activeConsoleSessionId !== 'undefined') {
          activeConsoleSessionId = -1;
        }

        setRunning(false);
      };
    }

    if (outputStdin) {
      outputStdin.addEventListener(
        'keydown',
        e => {
          if (e.key === 'Enter') {
            e.preventDefault();

            if (lastRun) {
              window.runFile(
                lastRun.filePath,
                lastRun.lang
              );
            }
          }
        }
      );
    }
  }, 0);
});
