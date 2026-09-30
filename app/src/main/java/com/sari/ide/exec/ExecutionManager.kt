package com.sari.ide.exec

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicLong

/**
 * Manages execution sessions: creates them, routes execution to the correct backend,
 * cancels stale sessions, and ensures output from old sessions never reaches new consoles.
 */
class ExecutionManager(private val context: Context, private val projectsRoot: File) {

    private val sessionCounter = AtomicLong(0)
    @Volatile private var currentSession: ExecutionSession? = null

    /** Base directory for all De Linux runtime workspace dirs (NOT Termux, NOT scoped storage). */
    private val workspaceBase: File get() = File(context.filesDir, "delinux/workspace").also { it.mkdirs() }

    fun newSession(project: String, filePath: String, language: String): ExecutionSession {
        // Cancel any currently running session first (old callbacks are then ignored by sessionId check).
        currentSession?.let { if (it.isActive) it.cancel() }
        // Clean up old workspace dirs from previous sessions (keep last 3).
        trimWorkspaces()
        val id = sessionCounter.incrementAndGet()
        val wd = File(workspaceBase, "s$id").also { it.mkdirs() }
        val session = ExecutionSession(
            sessionId = id,
            project = project,
            filePath = filePath,
            language = language,
            workDir = wd
        )
        currentSession = session
        return session
    }

    /** Session is still the active one (i.e. no newer session has started). */
    fun isCurrentSession(sessionId: Long) = currentSession?.sessionId == sessionId

    fun currentSessionId(): Long = currentSession?.sessionId ?: -1

    fun cancelCurrentSession() { currentSession?.cancel() }

    private fun trimWorkspaces() {
        val dirs = workspaceBase.listFiles()?.sortedBy { it.name } ?: return
        if (dirs.size > 6) dirs.take(dirs.size - 6).forEach { it.deleteRecursively() }
    }

    /**
     * Runs the given command using Android ProcessBuilder (no Termux required).
     * The environment is built from De Linux's runtime directories.
     * Calls [onLine] for each stdout/stderr line, but only if [session] is still current.
     */
    suspend fun runProcess(
        session: ExecutionSession,
        cmd: List<String>,
        env: Map<String, String> = emptyMap(),
        onLine: suspend (sessionId: Long, isErr: Boolean, line: String) -> Unit
    ): JSONObject = withContext(Dispatchers.IO) {
        val pb = ProcessBuilder(cmd)
            .directory(session.workDir)
            .redirectErrorStream(false)

        val fullEnv = pb.environment()
        fullEnv.putAll(env)

        var process: Process? = null
        return@withContext try {
            process = pb.start()
            session.process = process
            session.status = SessionStatus.RUNNING

            val stdoutLines = StringBuilder()
            val stderrLines = StringBuilder()

            val stdoutThread = Thread {
                process.inputStream.bufferedReader().use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        val l = line!!
                        stdoutLines.appendLine(l)
                        if (!session.cancelled.get() && isCurrentSession(session.sessionId)) {
                            kotlinx.coroutines.runBlocking { onLine(session.sessionId, false, l) }
                        }
                    }
                }
            }.also { it.isDaemon = true; it.start() }

            val stderrThread = Thread {
                process.errorStream.bufferedReader().use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        val l = line!!
                        stderrLines.appendLine(l)
                        if (!session.cancelled.get() && isCurrentSession(session.sessionId)) {
                            kotlinx.coroutines.runBlocking { onLine(session.sessionId, true, l) }
                        }
                    }
                }
            }.also { it.isDaemon = true; it.start() }

            val exitCode = process.waitFor()
            stdoutThread.join(3000)
            stderrThread.join(3000)

            session.exitCode = exitCode
            session.status = if (exitCode == 0) SessionStatus.COMPLETED else SessionStatus.FAILED

            JSONObject()
                .put("sessionId", session.sessionId)
                .put("stdout", stdoutLines.toString().trimEnd())
                .put("stderr", stderrLines.toString().trimEnd())
                .put("exitCode", exitCode)
                .put("ok", exitCode == 0)
        } catch (e: Exception) {
            session.status = SessionStatus.FAILED
            JSONObject()
                .put("sessionId", session.sessionId)
                .put("stdout", "")
                .put("stderr", e.message ?: "Process error")
                .put("exitCode", -1)
                .put("ok", false)
        } finally {
            try { process?.destroy() } catch (_: Exception) {}
        }
    }

    fun info(): JSONObject {
        val s = currentSession
        return JSONObject()
            .put("currentSessionId", s?.sessionId ?: -1)
            .put("status", s?.status?.name ?: "IDLE")
            .put("project", s?.project ?: "")
            .put("file", s?.filePath ?: "")
    }
}
