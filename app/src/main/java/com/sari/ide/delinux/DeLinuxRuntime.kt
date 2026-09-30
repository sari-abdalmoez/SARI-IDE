package com.sari.ide.delinux

import android.content.Context
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * Manages download, installation, and verification of De Linux runtime components.
 *
 * De Linux runtimes are installed to:
 *   filesDir/delinux/usr/  (the "prefix" — bin/, lib/, include/, etc.)
 *
 * This directory is always accessible to the SARI IDE process (unlike Termux's private storage)
 * and does NOT depend on the Termux app being installed.
 *
 * Runtime sources:
 *   Python  — BeeWare's cpython-android-builds (pre-built CPython for Android ABI targets)
 *             https://github.com/beeware/cpython-android-builds/releases
 *   C/C++   — Requires clang pre-built for Android; very large (~200MB+). Currently flagged as
 *             UNSUPPORTED unless clang is detected in the environment, because bundling a full
 *             toolchain in an APK is impractical. The framework is in place for a future
 *             companion download or Termux-installed-clang detection.
 *   HTML    — Android's built-in WebView (no download needed).
 *   JS      — Detection of system Node.js or De Linux Node (framework in place).
 */
class DeLinuxRuntime(private val context: Context) {

    companion object {
        private const val TAG = "DeLinuxRuntime"
        // Real, public BeeWare cpython-android-builds release
        private const val PYTHON_VERSION = "3.11.8"
        private const val PYTHON_RELEASE_TAG = "3.11.8-r0"
        private const val PYTHON_BASE_URL =
            "https://github.com/beeware/cpython-android-builds/releases/download/$PYTHON_RELEASE_TAG"
    }

    /** Base prefix where all De Linux runtimes are installed. */
    val prefix: File get() = File(context.filesDir, "delinux/usr").also { it.mkdirs() }
    val binDir: File get() = File(prefix, "bin")
    val libDir: File get() = File(prefix, "lib")
    private val stateFile: File get() = File(context.filesDir, "delinux/state.json")

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(300, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    // ---- state persistence ----

    private fun loadState(): JSONObject = try {
        JSONObject(stateFile.readText())
    } catch (e: Exception) {
        JSONObject()
    }

    private fun saveState(state: JSONObject) {
        stateFile.parentFile?.mkdirs()
        stateFile.writeText(state.toString(2))
    }

    private fun setRuntimeState(id: String, status: String, detail: String = "") {
        val s = loadState()
        s.put(id, JSONObject().put("status", status).put("detail", detail).put("ts", System.currentTimeMillis()))
        saveState(s)
    }

    fun getRuntimeStatus(id: String): String {
        return loadState().optJSONObject(id)?.optString("status", "NOT_INSTALLED") ?: "NOT_INSTALLED"
    }

    fun statusAll(): JSONObject {
        val s = loadState()
        val result = JSONObject()
        for (id in listOf("python", "cpp", "html", "javascript")) {
            result.put(id, s.optJSONObject(id)?.optString("status", "NOT_INSTALLED") ?: "NOT_INSTALLED")
        }
        // HTML is always available via WebView
        result.put("html", "READY")
        return result
    }

    // ---- Python ----

    /** Download + install Python for the device's primary ABI. Returns a result JSON. */
    fun installPython(onProgress: (String) -> Unit): JSONObject {
        val abi = ArchitectureManager.abiTag()
        val abiUrlPart = when (abi) {
            "arm64" -> "aarch64"
            "arm" -> "armv7"
            "x86_64" -> "x86_64"
            "x86" -> "x86"
            else -> return errResult("Unsupported ABI: $abi")
        }
        val zipName = "cpython-$PYTHON_VERSION-$abiUrlPart-android-$PYTHON_RELEASE_TAG.zip"
        val url = "$PYTHON_BASE_URL/$zipName"

        setRuntimeState("python", "INSTALLING", "Downloading Python $PYTHON_VERSION for $abi")
        onProgress("Downloading Python $PYTHON_VERSION for $abi…")

        return try {
            val req = Request.Builder().url(url).build()
            http.newCall(req).execute().use { response ->
                if (!response.isSuccessful) {
                    setRuntimeState("python", "FAILED", "Download failed: HTTP ${response.code}")
                    return errResult("Download failed: HTTP ${response.code} from $url")
                }
                val bytes = response.body?.bytes() ?: return errResult("Empty response body")
                onProgress("Extracting Python…")
                val dest = File(context.filesDir, "delinux/python-dist")
                dest.deleteRecursively(); dest.mkdirs()
                extractZip(bytes, dest)
                // BeeWare layout has python3 binary at dist/python/bin/python3
                val pythonBin = findFirstMatching(dest, listOf("python3.11", "python3", "python"))
                if (pythonBin == null) {
                    setRuntimeState("python", "FAILED", "python3 binary not found in archive")
                    return errResult("python3 binary not found in downloaded archive")
                }
                pythonBin.setExecutable(true, false)
                // Symlink/copy to our prefix bin
                binDir.mkdirs()
                val target = File(binDir, "python3")
                if (target.exists()) target.delete()
                target.writeBytes(pythonBin.readBytes())
                target.setExecutable(true, false)
                onProgress("Verifying Python…")
                setRuntimeState("python", "VERIFYING")
                verifyPython()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Python install failed", e)
            setRuntimeState("python", "FAILED", e.message ?: "Unknown error")
            errResult("Python install failed: ${e.message}")
        }
    }

    fun verifyPython(): JSONObject {
        val python = findPython() ?: return run {
            setRuntimeState("python", "NOT_INSTALLED"); errResult("python3 binary not found")
        }
        return try {
            val versionResult = runQuick(listOf(python.absolutePath, "--version"))
            if (versionResult.first != 0) {
                setRuntimeState("python", "FAILED", versionResult.second)
                return errResult("python --version failed: ${versionResult.second}")
            }
            // Actually execute a tiny program to ensure the runtime works end-to-end
            val testResult = runQuick(listOf(python.absolutePath, "-c", "print('DeLinux-OK')"))
            if (testResult.first != 0 || !testResult.second.contains("DeLinux-OK")) {
                setRuntimeState("python", "FAILED", "Runtime test failed: ${testResult.second}")
                return errResult("Python runtime test failed: ${testResult.second}")
            }
            setRuntimeState("python", "READY", versionResult.second.trim())
            JSONObject().put("ok", true).put("version", versionResult.second.trim()).put("status", "READY")
        } catch (e: Exception) {
            setRuntimeState("python", "FAILED", e.message ?: "")
            errResult("Verification error: ${e.message}")
        }
    }

    /** Detect python3 binary: prefer our bundled one, then check common fallback locations. */
    fun findPython(): File? {
        val candidates = listOf(
            File(binDir, "python3"),
            File(binDir, "python3.11"),
            File(context.filesDir, "delinux/python-dist/python3"),
            // Termux python if available (fallback only — not the default)
            File("/data/data/com.termux/files/usr/bin/python3"),
        )
        return candidates.firstOrNull { it.exists() && it.canExecute() }
    }

    // ---- C/C++ ----

    /**
     * C/C++ toolchain (clang) for Android is ~200MB+. We detect if it's available from:
     * 1. Our own download (future; requires a CDN hosting pre-built clang for Android)
     * 2. The Termux-installed clang (secondary fallback, optional)
     * Status is UNSUPPORTED unless one of those is found.
     */
    fun verifyCpp(): JSONObject {
        val clang = findClang()
        if (clang == null) {
            setRuntimeState("cpp", "UNSUPPORTED", "clang++ not found")
            return JSONObject().put("ok", false).put("status", "UNSUPPORTED")
                .put("detail", "C/C++ toolchain (clang++) is not bundled because of its size (~200MB+). " +
                    "Install Termux and run: pkg install clang, then it will be detected automatically.")
        }
        return try {
            val vr = runQuick(listOf(clang.absolutePath, "--version"))
            if (vr.first != 0) {
                setRuntimeState("cpp", "FAILED", vr.second)
                return errResult("clang++ --version failed")
            }
            // Compile a real test program
            val testSrc = File(context.cacheDir, "delinux_cpp_test.cpp")
            testSrc.writeText("""
                #include <cstdio>
                int main() { puts("DeLinux-CPP-OK"); return 0; }
            """.trimIndent())
            val testBin = File(context.cacheDir, "delinux_cpp_test")
            val compileResult = runQuick(listOf(clang.absolutePath, testSrc.absolutePath, "-o", testBin.absolutePath))
            if (compileResult.first != 0) {
                setRuntimeState("cpp", "FAILED", compileResult.second)
                return errResult("Compilation test failed: ${compileResult.second}")
            }
            testBin.setExecutable(true)
            val runResult = runQuick(listOf(testBin.absolutePath))
            testSrc.delete(); testBin.delete()
            if (runResult.first != 0 || !runResult.second.contains("DeLinux-CPP-OK")) {
                setRuntimeState("cpp", "FAILED", runResult.second)
                return errResult("C++ runtime test failed: ${runResult.second}")
            }
            setRuntimeState("cpp", "READY", vr.second.trim())
            JSONObject().put("ok", true).put("status", "READY").put("version", vr.second.trim())
        } catch (e: Exception) {
            setRuntimeState("cpp", "FAILED", e.message ?: "")
            errResult("C++ verification error: ${e.message}")
        }
    }

    fun findClang(): File? {
        val candidates = listOf(
            File(binDir, "clang++"),
            File("/data/data/com.termux/files/usr/bin/clang++"),
        )
        return candidates.firstOrNull { it.exists() && it.canExecute() }
    }

    fun findClangC(): File? = listOf(
        File(binDir, "clang"),
        File("/data/data/com.termux/files/usr/bin/clang"),
    ).firstOrNull { it.exists() && it.canExecute() }

    // ---- JavaScript ----

    fun findNode(): File? = listOf(
        File(binDir, "node"),
        File("/data/data/com.termux/files/usr/bin/node"),
    ).firstOrNull { it.exists() && it.canExecute() }

    fun verifyNode(): JSONObject {
        val node = findNode() ?: return JSONObject().put("ok", false).put("status", "NOT_INSTALLED")
        return try {
            val vr = runQuick(listOf(node.absolutePath, "--version"))
            if (vr.first == 0) {
                setRuntimeState("javascript", "READY", vr.second.trim())
                JSONObject().put("ok", true).put("status", "READY").put("version", vr.second.trim())
            } else {
                setRuntimeState("javascript", "FAILED", vr.second)
                errResult("node --version failed")
            }
        } catch (e: Exception) {
            errResult("Node.js check error: ${e.message}")
        }
    }

    // ---- helpers ----

    fun buildEnv(): Map<String, String> {
        val existing = System.getenv().toMutableMap()
        val termuxUsr = "/data/data/com.termux/files/usr"
        val path = listOf(binDir.absolutePath, "$termuxUsr/bin", "/system/bin", "/system/xbin")
            .joinToString(":")
        existing["PATH"] = path
        existing["HOME"] = File(context.filesDir, "delinux/home").also { it.mkdirs() }.absolutePath
        existing["TMPDIR"] = context.cacheDir.absolutePath
        existing["LD_LIBRARY_PATH"] = "${libDir.absolutePath}:$termuxUsr/lib"
        return existing
    }

    private fun runQuick(cmd: List<String>, timeoutMs: Long = 30_000): Pair<Int, String> {
        val pb = ProcessBuilder(cmd)
            .redirectErrorStream(true)
            .directory(context.cacheDir)
        pb.environment().putAll(buildEnv())
        val proc = pb.start()
        val out = proc.inputStream.readBytes().toString(Charsets.UTF_8)
        val exited = proc.waitFor()
        return Pair(exited, out)
    }

    private fun extractZip(bytes: ByteArray, dest: File) {
        ZipInputStream(bytes.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val outFile = File(dest, entry.name).canonicalFile
                require(outFile.path.startsWith(dest.canonicalFile.path + File.separator) || outFile == dest) { "Unsafe zip entry" }
                if (entry.isDirectory) outFile.mkdirs()
                else { outFile.parentFile?.mkdirs(); outFile.outputStream().use { zis.copyTo(it) } }
                zis.closeEntry(); entry = zis.nextEntry
            }
        }
    }

    private fun findFirstMatching(dir: File, names: List<String>): File? {
        for (f in dir.walkTopDown()) {
            if (f.isFile && f.name in names) return f
        }
        return null
    }

    private fun errResult(msg: String) = JSONObject().put("ok", false).put("error", msg).put("status", "FAILED")
}
