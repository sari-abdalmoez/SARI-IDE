package com.sari.ide.core

import android.util.Log

/**
 * JNI wrapper for the Rust native library (libsari_native.so).
 * Used for file hashing (GitHub change-detection) and fast directory scanning.
 * Falls back to pure-Kotlin implementations if the native library is not available
 * (e.g. ABI mismatch, CI build without Rust toolchain).
 */
object NativeFileOps {
    private var nativeAvailable = false

    init {
        try {
            System.loadLibrary("sari_native")
            nativeAvailable = true
        } catch (e: UnsatisfiedLinkError) {
            Log.w("NativeFileOps", "libsari_native.so not available — using Kotlin fallbacks. ${e.message}")
        }
    }

    /** SHA-256 hex digest of a file; uses native Rust implementation when available. */
    fun hashFile(path: String): String {
        return if (nativeAvailable) {
            try { nativeHashFile(path) } catch (e: Exception) { hashFileKotlin(path) }
        } else {
            hashFileKotlin(path)
        }
    }

    /** Fast recursive directory scan returning JSON string; uses native when available. */
    fun scanDirectory(path: String, maxDepth: Int = 8): String {
        return if (nativeAvailable) {
            try { nativeScanDirectory(path, maxDepth) } catch (e: Exception) { scanDirectoryKotlin(path, maxDepth) }
        } else {
            scanDirectoryKotlin(path, maxDepth)
        }
    }

    // ---- native declarations (only called when nativeAvailable == true) ----
    @JvmStatic private external fun nativeHashFile(path: String): String
    @JvmStatic private external fun nativeScanDirectory(path: String, maxDepth: Int): String

    // ---- pure-Kotlin fallbacks ----
    private fun hashFileKotlin(path: String): String {
        return try {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            java.io.File(path).inputStream().use { ins ->
                val buf = ByteArray(65536)
                var n: Int
                while (ins.read(buf).also { n = it } != -1) digest.update(buf, 0, n)
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (e: Exception) { "" }
    }

    private fun scanDirectoryKotlin(path: String, maxDepth: Int): String {
        val root = java.io.File(path)
        if (!root.exists()) return "[]"
        val sb = StringBuilder("[")
        var first = true
        fun walk(dir: java.io.File, depth: Int) {
            if (depth > maxDepth) return
            dir.listFiles()?.sortedWith(compareBy({ !it.isDirectory }, { it.name }))?.forEach { f ->
                if (!first) sb.append(',')
                first = false
                val rel = f.absolutePath.removePrefix(root.absolutePath).trimStart('/')
                sb.append("{\"path\":\"${rel.replace("\"", "\\\"")}\",\"dir\":${f.isDirectory},\"size\":${f.length()}}")
                if (f.isDirectory) walk(f, depth + 1)
            }
        }
        walk(root, 0)
        sb.append(']')
        return sb.toString()
    }
}
