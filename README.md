# SARI IDE
Mobile-first IDE for Android. Phase 1: WebView UI, project manager, file manager, basic editor.

Build: push to GitHub → Actions → artifact `apk-debug` (ZIP containing `app-debug.apk`).
Toolchain: JDK 17, Gradle 8.7, AGP 8.5.2, Kotlin 1.9.24, compileSdk/targetSdk 34, minSdk 24.
Local build (if Gradle 8.7 is installed): `gradle :app:assembleDebug`.
