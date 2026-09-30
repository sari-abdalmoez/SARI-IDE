package com.sari.ide.core

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

data class ExecutionSession(
    val sessionId: String,
    val projectId: String,
    val fileId: String,
    val language: String,
    val runtime: String,
    val workingDirectory: File,
    val startTime: Long = System.currentTimeMillis()
)

class ExecutionManager(
    private val context: Context,
    private val projects: ProjectManager
) {
    private val scope = kotlinx.coroutines.CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val processes = ConcurrentHashMap<String, Process>()
    private val jobs = ConcurrentHashMap<String, Job>()
    private val results = ConcurrentHashMap<String, JSONObject>()
    private val stopped = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val root = File(context.filesDir, "de-linux/workspaces").apply { mkdirs() }

    suspend fun start(projectId: String, fileId: String, language: String, stdin: String?): JSONObject {
        val sessionId = UUID.randomUUID().toString()
        val workspace = File(root, sessionId).apply { mkdirs() }
        val session = ExecutionSession(sessionId, projectId, fileId, language, "De Linux", workspace)

        try {
            val projectDir = projects.dir(projectId)
            withContext(Dispatchers.IO) {
                projectDir.copyRecursively(workspace, overwrite = true)
            }
            val target = PathGuard.resolve(workspace, fileId)
            require(target.isFile) { "Execution file not found: $fileId" }

            val command = DeLinuxRuntime(context).command(language, target, workspace)
            if (command == null) {
                val r = base(session, "UNSUPPORTED")
                    .put("stdout", "")
                    .put("stderr", "De Linux runtime for $language is not installed on this device.")
                    .put("exitCode", -1)
                results[sessionId] = r
                workspace.deleteRecursively()
                return r
            }

            val process = ProcessBuilder(command)
                .directory(workspace)
                .redirectErrorStream(false)
                .start()
            processes[sessionId] = process

            jobs[sessionId] = scope.launch {
                try {
                    if (stdin != null) {
                        process.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(stdin) }
                    } else process.outputStream.close()

                    // Read both pipes concurrently to avoid deadlocks on large output.
                    val outJob = launch {
                        val out = process.inputStream.bufferedReader(Charsets.UTF_8).readText()
                        results.computeIfAbsent(sessionId) { base(session, "RUNNING") }
                            .put("stdout", bounded(out))
                    }
                    val errJob = launch {
                        val err = process.errorStream.bufferedReader(Charsets.UTF_8).readText()
                        results.computeIfAbsent(sessionId) { base(session, "RUNNING") }
                            .put("stderr", bounded(err))
                    }

                    val exited = process.waitFor(120, TimeUnit.SECONDS)
                    if (stopped.contains(sessionId)) {
                        outJob.join(); errJob.join()
                        results[sessionId] = base(session, "STOPPED")
                            .put("stdout", results[sessionId]?.optString("stdout", "") ?: "")
                            .put("stderr", (results[sessionId]?.optString("stderr", "") ?: "") + "\nExecution stopped.")
                            .put("exitCode", -1)
                    } else if (!exited) {
                        process.destroyForcibly()
                        outJob.join(); errJob.join()
                        results[sessionId] = base(session, "TIMEOUT")
                            .put("stdout", results[sessionId]?.optString("stdout", "") ?: "")
                            .put("stderr", (results[sessionId]?.optString("stderr", "") ?: "") + "\nExecution timed out.")
                            .put("exitCode", -1)
                    } else {
                        outJob.join(); errJob.join()
                        val prior = results[sessionId]
                        results[sessionId] = base(session, if (process.exitValue() == 0) "FINISHED" else "FAILED")
                            .put("stdout", prior?.optString("stdout", "") ?: "")
                            .put("stderr", prior?.optString("stderr", "") ?: "")
                            .put("exitCode", process.exitValue())
                    }
                } catch (e: Exception) {
                    results[sessionId] = base(session, "FAILED")
                        .put("stdout", results[sessionId]?.optString("stdout", "") ?: "")
                        .put("stderr", e.message ?: e.javaClass.simpleName)
                        .put("exitCode", -1)
                } finally {
                    processes.remove(sessionId)
                    jobs.remove(sessionId)
                    workspace.deleteRecursively()
                }
            }

            return base(session, "RUNNING")
        } catch (e: Exception) {
            workspace.deleteRecursively()
            throw e
        }
    }

    suspend fun run(projectId: String, fileId: String, language: String, stdin: String?): JSONObject {
        val started = start(projectId, fileId, language, stdin)
        if (started.optString("status") != "RUNNING") return started
        val id = started.getString("sessionId")
        while (true) {
            val p = poll(id)
            if (p.optString("status") != "RUNNING") return p
            delay(100)
        }
    }

    fun poll(sessionId: String): JSONObject =
        results[sessionId] ?: JSONObject()
            .put("sessionId", sessionId)
            .put("status", if (processes.containsKey(sessionId)) "RUNNING" else "UNKNOWN")

    fun stop(sessionId: String): Boolean {
        val p = processes[sessionId] ?: return false
        stopped.add(sessionId)
        p.destroy()
        if (p.isAlive) p.destroyForcibly()
        results.compute(sessionId) { _, old ->
            (old ?: JSONObject().put("sessionId", sessionId))
                .put("status", "STOPPED")
                .put("exitCode", -1)
                .put("stderr", (old?.optString("stderr", "") ?: "") + "\nExecution stopped.")
        }
        jobs.remove(sessionId)?.cancel()
        return true
    }

    fun status(): JSONObject = DeLinuxRuntime(context).status()

    private fun base(s: ExecutionSession, status: String) = JSONObject()
        .put("sessionId", s.sessionId)
        .put("projectId", s.projectId)
        .put("fileId", s.fileId)
        .put("language", s.language)
        .put("runtime", s.runtime)
        .put("workingDirectory", s.workingDirectory.absolutePath)
        .put("startTime", s.startTime)
        .put("status", status)

    private fun bounded(s: String): String {
        val max = 200_000
        return if (s.length <= max) s else "…(truncated)…\n" + s.takeLast(max)
    }
}
