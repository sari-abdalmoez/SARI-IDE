plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sari.ide"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.sari.ide"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "0.3.1"
        ndk {
            // Only arm64 + x86_64 for modern devices; add armeabi-v7a if needed for older hardware
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // Pre-built Rust .so files are placed here by the GitHub Actions workflow
    sourceSets["main"].jniLibs.srcDirs("src/main/jniLibs")
}

// ---- Rust native build task ----
// This task is invoked by the GitHub Actions workflow (or locally if cargo-ndk is installed).
// It places libsari_native.so into app/src/main/jniLibs/{abi}/.
// The Gradle build itself does NOT invoke cargo; the CI workflow does it as a separate step.
// If you want to build locally: `cargo ndk -t arm64-v8a -o app/src/main/jniLibs build --release`
// from the repository root (requires: cargo-ndk + Android NDK).

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
