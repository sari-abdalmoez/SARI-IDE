package com.sari.ide.delinux

import android.content.Context
import com.sari.ide.exec.ExecutionManager
import com.sari.ide.exec.ExecutionSession
import com.sari.ide.exec.SessionStatus
import org.json.JSONObject
import java.io.File

/**
 * De Linux Executor — runs code using Android's ProcessBuilder without requiring Termux.
 *
 * Working directory for each run is always inside filesDir/delinux/workspace/{sessionId}/,
 * which is guaranteed accessible to the SARI IDE process. Project source files are symlinked
 * or resolved via absolute path so the runtime sees them correctly.
 */
class DeLinuxExecutor(private val context: Context) {

    private val runtime = DeLinuxRuntime(context)

    /**
     * Build the appropriate command for the given language + file, then run it through
     * the ExecutionManager's process engine.
     *
     * Returns a JSON summary; per-line output is delivered via [onLine].
     */
    suspend fun run(
        session: ExecutionSession,
        execManager: ExecutionManager,
        stdin: String? = null,
        onLine: suspend (sessionId: Long, isErr: Boolean, line: String) -> Unit
    ): JSONObject {
        return when (session.language) {
            "python" -> runPython(session, execManager, stdin, onLine)
            "c" -> runC(session, execManager, onLine)
            "cpp" -> runCpp(session, execManager, onLine)
            "javascript" -> runNode(session, execManager, stdin, onLine)
            "html" -> JSONObject().put("ok", true).put("useWebView", true)
                .put("message", "HTML files are previewed in the built-in WebView.")
            else -> JSONObject().put("ok", false)
                .put("error", "Language '${session.language}' is not yet supported by De Linux.")
        }
    }

    // ---- Python ----
    private suspend fun runPython(
        session: ExecutionSession, execManager: ExecutionManager,
        stdin: String?, onLine: suspend (Long, Boolean, String) -> Unit
    ): JSONObject {
        val python = runtime.findPython()
            ?: return JSONObject().put("ok", false).put("exitCode", -1)
                .put("error", "Python is not installed. Open Settings > Languages > Python > Install.")
        val srcFile = resolveSourceFile(session)
        if (!srcFile.exists()) return JSONObject().put("ok", false).put("error", "Source file not found: ${srcFile.absolutePath}")

        val cmd = buildList {
            if (stdin != null) {
                // Pipe stdin via printf | python3 when the session has pre-supplied input
                add("/bin/sh"); add("-c")
                val escaped = stdin.replace("'", "'\\''")
                add("printf '%s\\n' '$escaped' | '${python.absolutePath}' '${srcFile.absolutePath}'")
            } else {
                add(python.absolutePath); add(srcFile.absolutePath)
            }
        }
        return execManager.runProcess(session, cmd, runtime.buildEnv(), onLine)
    }

    // ---- C ----
    private suspend fun runC(
        session: ExecutionSession, execManager: ExecutionManager,
        onLine: suspend (Long, Boolean, String) -> Unit
    ): JSONObject {
        val clang = runtime.findClangC()
            ?: return JSONObject().put("ok", false).put("exitCode", -1)
                .put("error", "clang (C compiler) is not available. Install Termux and run: pkg install clang")
        val srcFile = resolveSourceFile(session)
        if (!srcFile.exists()) return JSONObject().put("ok", false).put("error", "Source file not found")
        val outBin = File(session.workDir, "program")

        // Compile
        session.status = SessionStatus.COMPILING
        onLine(session.sessionId, false, "$ clang ${srcFile.name} -O2 -o program")
        val compileResult = execManager.runProcess(
            session,
            listOf(clang.absolutePath, srcFile.absolutePath, "-O2", "-o", outBin.absolutePath),
            runtime.buildEnv(), onLine
        )
        if (!compileResult.optBoolean("ok")) return compileResult

        if (!outBin.exists()) return JSONObject().put("ok", false).put("error", "Linker produced no output binary")
        outBin.setExecutable(true)
        onLine(session.sessionId, false, "Compilation successful.\n$ ./program")
        return execManager.runProcess(session, listOf(outBin.absolutePath), runtime.buildEnv(), onLine)
    }

    // ---- C++ ----
    private suspend fun runCpp(
        session: ExecutionSession, execManager: ExecutionManager,
        onLine: suspend (Long, Boolean, String) -> Unit
    ): JSONObject {
        val clangxx = runtime.findClang()
            ?: return JSONObject().put("ok", false).put("exitCode", -1)
                .put("error", "clang++ (C++ compiler) is not available. Install Termux and run: pkg install clang")
        val srcFile = resolveSourceFile(session)
        if (!srcFile.exists()) return JSONObject().put("ok", false).put("error", "Source file not found")
        val outBin = File(session.workDir, "program")

        session.status = SessionStatus.COMPILING
        onLine(session.sessionId, false, "$ clang++ ${srcFile.name} -O2 -o program")
        val compileResult = execManager.runProcess(
            session,
            listOf(clangxx.absolutePath, srcFile.absolutePath, "-O2", "-o", outBin.absolutePath, "-lstdc++"),
            runtime.buildEnv(), onLine
        )
        if (!compileResult.optBoolean("ok")) return compileResult

        if (!outBin.exists()) return JSONObject().put("ok", false).put("error", "Linker produced no output binary")
        outBin.setExecutable(true)
        onLine(session.sessionId, false, "Compilation successful.\n$ ./program")
        return execManager.runProcess(session, listOf(outBin.absolutePath), runtime.buildEnv(), onLine)
    }

    // ---- JavaScript ----
    private suspend fun runNode(
        session: ExecutionSession, execManager: ExecutionManager,
        stdin: String?, onLine: suspend (Long, Boolean, String) -> Unit
    ): JSONObject {
        val node = runtime.findNode()
            ?: return JSONObject().put("ok", false).put("exitCode", -1)
                .put("error", "Node.js is not available. Install Termux and run: pkg install nodejs")
        val srcFile = resolveSourceFile(session)
        if (!srcFile.exists()) return JSONObject().put("ok", false).put("error", "Source file not found")

        val cmd = if (stdin != null) {
            val escaped = stdin.replace("'", "'\\''")
            listOf("/bin/sh", "-c", "printf '%s\\n' '$escaped' | '${node.absolutePath}' '${srcFile.absolutePath}'")
        } else {
            listOf(node.absolutePath, srcFile.absolutePath)
        }
        return execManager.runProcess(session, cmd, runtime.buildEnv(), onLine)
    }

    /**
     * Resolves the source file to an absolute File in the project.
     * We reference the original project file directly by absolute path — no need to copy
     * files into the workspace dir, because our ProcessBuilder can reference any path.
     * The workspace dir (session.workDir) is only used as the process cwd and for build artefacts.
     */
    private fun resolveSourceFile(session: ExecutionSession): File {
        // filePath is relative to the project root
        val projectsRoot = File(context.filesDir, "delinux").parentFile!!
            .parentFile!!.let { File(it, "SARIProjects/${session.project}") }
        // Try external projects root first
        val external = File(
            android.os.Environment.getExternalStorageDirectory(),
            "SARIProjects/${session.project}/${session.filePath}"
        )
        if (external.exists()) return external
        return File(projectsRoot, session.filePath)
    }
}
