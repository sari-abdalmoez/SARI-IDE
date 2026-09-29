# SARI IDE

Mobile-first IDE for Android: project/file manager, code editor, GitHub repository + Actions
integration, and a real Termux-backed Run/Build/package-install pipeline.

## Build
Push to GitHub → Actions runs `android-build.yml` automatically → download the `apk-debug`
artifact (a ZIP containing `app-debug.apk`).
Toolchain: JDK 17, Gradle 8.7, AGP 8.5.2, Kotlin 1.9.24, compileSdk/targetSdk 34, minSdk 24.

## Two different terminals — by design
- **Console Output** (the ">_" icon in the editor bar) is SARI IDE's own output panel. It shows
  what happens when you press **Run**: compiler stdout/stderr, the program's own stdout/stderr,
  and the exit code — like the output pane in Pydroid. It is *not* a shell.
- **Termux Terminal** (from the editor's overflow menu) is a real shell session piped into your
  actual installed Termux app via the same RUN_COMMAND channel. Use it for ad-hoc commands,
  `pkg`/`pip`/`npm` work, or anything Console Output doesn't cover.
Both ultimately execute through Termux's RUN_COMMAND plugin API, but they're presented as the
two distinct tools requested — one is "my program's output", the other is "a real Termux shell".

## Required one-time device setup for full functionality
1. **File access** — grant "All files access" when prompted so projects live at
   `/storage/emulated/0/SARIProjects`, a path both SARI IDE and Termux can reach. Without it the
   app still works, but Termux run/build/package features are unavailable.
2. **Termux** — install Termux from F-Droid or its GitHub releases (not the outdated Play Store
   build). Run `termux-setup-storage` once inside Termux.
3. **Termux RUN_COMMAND** — add `allow-external-apps=true` to `~/.termux/termux.properties`,
   then `termux-reload-settings`. The **first time** SARI IDE runs a command it will pop Android's
   runtime permission dialog for `com.termux.permission.RUN_COMMAND` — allow it. (Declaring the
   permission in the manifest alone is not enough; Termux marks it `dangerous`, so it must be
   granted at runtime, which SARI IDE now requests automatically.)
4. **GitHub** — create a Personal Access Token with `repo` and `workflow` scopes, then connect
   from the GitHub screen.

## What changed in this pass (root causes, not just symptoms)
- **Every Termux command reporting exit code -1**: the result receiver was reading flat intent
  extras (`RUN_COMMAND_RESULT_STDOUT`, etc.), but Termux actually delivers the result inside a
  single `"result"` Bundle extra (the same format Termux:Tasker/Termux:API use). The receiver now
  unpacks that Bundle, so real stdout/stderr/exit codes come through. Combined with this: the
  RUN_COMMAND permission is now requested at runtime (it wasn't before, silently failing calls),
  and the command service is started with `startForegroundService` on Android 8+.
- **Language "Installed" status was never actually verified**: install now runs `pkg install`,
  then re-probes with the same `--version`-style command used to detect the language, and only
  reports Installed if that probe succeeds. Failed installs open Console Output with the real
  Termux stdout/stderr instead of a generic message.
- **GitHub 404 on Trigger Build**: GitHub's workflow-dispatch endpoint 404s if the target branch
  doesn't exist yet, or if the workflow file isn't present on the branch — both true for a repo
  that was connected but never pushed to. `triggerWorkflow` now checks both first and raises a
  specific, actionable message; the GitHub screen's "Push & trigger build" button now pushes the
  project before dispatching, matching the intended Import → Edit → Push → Build flow.
- **Binary files were corrupted by GitHub pull/push**: they went through a UTF-8 string round
  trip. Pull/push/import now transfer raw bytes end-to-end.
- **Emoji icons replaced**: every UI icon is now an inline SVG (stroke-based, single family,
  `currentColor`, consistent sizing) defined in `icons.js`, since the interface is WebView-hosted
  HTML rather than native Android views (true `.xml` vector drawables aren't applicable inside a
  WebView) — inline SVG is the equivalent for this UI layer: vector, theme-aware, no emoji-font
  dependency.

## New in this pass
- Folder import already preserved structure; this pass adds **GitHub → Import as new project**
  (pulls an entire connected repo into a brand-new local project) and **GitHub → Browse files**
  (lists every file in the repo, tap one to pull it into the current project).
- Console Output panel: stdout/stderr/exit code, Clear, Copy, a bounded buffer (~200 KB), and an
  optional stdin field (piped in up front via `printf | command`, since RUN_COMMAND has no live
  interactive channel — see limitation below).
- Build button now hides itself on projects with no `app/` + `settings.gradle*` (i.e. not an
  Android project), so APK controls don't appear where they can't apply.

## Known technical limits (real, not glossed over)
- RUN_COMMAND runs a command to completion and returns one stdout/stderr/exit-code result; there
  is no live-streaming terminal and no true interactive stdin mid-run. The Console panel's stdin
  field pipes input in *before* the command starts, which covers simple `input()`-at-the-top
  scripts but not a program that prompts interactively partway through.
- GitHub Actions log retrieval uses the per-job plain-text log endpoint (last ~4000 characters for
  a failed job), not the full log archive.
- "Branches" lets you view/create branches but switching the *active* branch is done by
  reconnecting with that branch name (there's no separate branch-switch call in this pass).
- I could not run `./gradlew :app:assembleDebug` in this environment (no network/Android SDK
  available here); I did static checks instead (brace balance, expression-body/return sweep,
  cross-checked every HTML id and icon name against its JS references). Send me the Actions log if
  something still fails to compile and I'll fix it directly.
