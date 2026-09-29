# SARI IDE

Mobile-first IDE for Android: project/file manager, code editor, GitHub repository + Actions integration, and Termux-backed run/build/package-install.

## Build
Push to GitHub → Actions runs automatically → artifact `apk-debug` (ZIP containing `app-debug.apk`).
Toolchain: JDK 17, Gradle 8.7, AGP 8.5.2, Kotlin 1.9.24, compileSdk/targetSdk 34, minSdk 24.

## Required one-time device setup for full functionality
1. **File access** — on first launch SARI IDE asks (via a toast + Settings) for "All files access" so
   projects live at `/storage/emulated/0/SARIProjects`, a location both SARI IDE and Termux can reach.
   Without it, SARI IDE still works, but Termux run/build/package features are unavailable (projects
   stay in app-private storage that Termux cannot see).
2. **Termux** — install Termux from F-Droid or its GitHub releases (not the outdated Play Store build).
   Inside Termux run `termux-setup-storage` once and grant its storage/all-files prompt so it can reach
   the same `/storage/emulated/0/SARIProjects` path.
3. **Termux RUN_COMMAND** — add `allow-external-apps=true` to `~/.termux/termux.properties` in Termux,
   then `termux-reload-settings`. The first time SARI IDE runs a command, Android will also ask you to
   grant SARI IDE the "RUN_COMMAND" permission for Termux — allow it.
4. **GitHub** — create a Personal Access Token (classic or fine-grained) with `repo` and `workflow`
   scopes, then connect it from the 🐙 GitHub screen. The token is stored only in this device's
   Android Keystore-backed encrypted storage; it is never written into a project or committed.

## Known technical limits
- Termux's RUN_COMMAND plugin API runs each command to completion and returns stdout/stderr/exit code
  in one shot; there's no live-streaming terminal output and a truly interactive REPL isn't supported.
- Background execution is limited to what Android's modern background-service rules allow once SARI IDE
  itself is no longer in the foreground; long builds are best triggered via GitHub Actions instead.
- GitHub Actions log retrieval uses the per-job plain-text log endpoint (tail of the last ~4000
  characters for failed jobs) rather than downloading and parsing the full logs archive.
- "All files access" is a sensitive Android permission; the app remains fully usable without it, just
  without Termux-backed run/build.
