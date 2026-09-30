package com.sari.ide.bridge

import java.io.File

/**
 * Small optional Rust layer. Kotlin remains the owner of Android lifecycle and storage APIs.
 * The app remains functional when the native library is unavailable (for example on an
 * unsupported ABI or a local build without the Rust toolchain).
 */
object NativeCore {
    private var loaded = false

    init {
        try {
            System.loadLibrary("sari_native_core")
            loaded = true
        } catch (_: UnsatisfiedLinkError) {
            loaded = false
        }
    }

    fun isAvailable(): Boolean = loaded

    fun sha256(file: File): String? {
        if (!loaded || !file.isFile) return null
        return try { nativeSha256(file.canonicalPath) } catch (_: Exception) { null }
    }

    private external fun nativeSha256(path: String): String
}
