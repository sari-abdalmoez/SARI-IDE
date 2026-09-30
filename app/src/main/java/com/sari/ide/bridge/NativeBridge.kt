package com.sari.ide.bridge

import android.content.Context
import com.sari.ide.core.ApkInstaller
import com.sari.ide.core.ArtifactManager
import com.sari.ide.core.DocumentImporter
import com.sari.ide.core.FileManager
import com.sari.ide.core.GitHubService
import com.sari.ide.core.LanguageManager
import com.sari.ide.core.NativeFileOps
import com.sari.ide.core.ProjectManager
import com.sari.ide.core.SecureStore
import com.sari.ide.delinux.ArchitectureManager
import com.sari.ide.delinux.DeLinuxExecutor
import com.sari.ide.delinux.DeLinuxRuntime
import com.sari.ide.exec.ExecutionManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlinx.coroutines.channels.Channel

/**
 * Message protocol: {"id":1,"op":"opName","args":{...}}
 * Response:         {"id":1,"ok":true,"data":...}
 *              or   {"id":1,"ok":false,"error":"..."}
 *
 * Streaming ops additionally post {"id":1,"stream":true,"line":"...","isErr":false,"sessionId":N}
 * messages via the [streamChannel] before the final response.
 */
class NativeBridge(
    private val context: Context,
    private val projectsRoot: File,
    private val picker: DocumentPicker,
    private val system: SystemActions,
    /** Channel used to push streaming output lines back to the WebView. */
    val streamChannel: Channel<String> = Channel(Channel.UNLIMITED)
) {
    private val projects = ProjectManager(projectsRoot)
    private val secureStore = SecureStore(context)
    private val github = GitHubService(secureStore)
    val execManager = ExecutionManager(context, projectsRoot)
    private val deLinuxExecutor = DeLinuxExecutor(context)
    private val deLinuxRuntime = DeLinuxRuntime(context)

    suspend fun handle(raw: String): String {
        var id: Any = JSONObject.NULL
        return try {
            val req = JSONObject(raw)
            id = req.opt("id") ?: JSONObject.NULL
            val a = req.optJSONObject("args") ?: JSONObject()
            val data = dispatch(req.getString("op"), a, id)
            JSONObject().put("id", id).put("ok", true).put("data", data).toString()
        } catch (e: Exception) {
            JSONObject().put("id", id).put("ok", false)
                .put("error", e.message ?: e.javaClass.simpleName).toString()
        }
    }

    private fun fm(a: JSONObject) = FileManager(projects.dir(a.getString("project")))

    /**
     * Translates an absolute shared-storage path that SARI IDE sees
     *   (/storage/emulated/0/SARIProjects/...)
     * to the equivalent path that Termux sees through its ~/storage/shared symlink
     *   (/data/data/com.termux/files/home/storage/shared/SARIProjects/...)
     *
     * Termux's RunCommandService uses the cwd directly as a filesystem path; if the
     * cwd is under /storage/emulated/0/ (which is accessible to SARI IDE via
     * MANAGE_EXTERNAL_STORAGE) Termux's service cannot create/cd to it without the
     * corresponding symlinked path.
     */
    private fun toTermuxPath(absPath: String): String {
        val sharedRoot = "/storage/emulated/0/"
        val termuxShared = "/data/data/com.termux/files/home/storage/shared/"
        return if (absPath.startsWith(sharedRoot)) termuxShared + absPath.removePrefix(sharedRoot)
        else absPath
    }

    private suspend fun dispatch(op: String, a: JSONObject, reqId: Any): Any {
        return when (op) {
        // ---- projects ----
        "listProjects" -> projects.list()
        "createProject" -> projects.create(a.getString("name"), a.getString("template"))
        "renameProject" -> projects.rename(a.getString("name"), a.getString("newName"))
        "duplicateProject" -> projects.duplicate(a.getString("name"))
        "deleteProject" -> { projects.delete(a.getString("name")); true }

        // ---- files ----
        "listDir" -> fm(a).list(a.optString("path", ""))
        "readFile" -> fm(a).read(a.getString("path"))
        "writeFile" -> { fm(a).write(a.getString("path"), a.getString("content")); true }
        "createFile" -> fm(a).createFile(a.optString("dir", ""), a.getString("name"))
        "createDir" -> fm(a).createDir(a.optString("dir", ""), a.getString("name"))
        "rename" -> fm(a).rename(a.getString("path"), a.getString("newName"))
        "delete" -> { fm(a).delete(a.getString("path")); true }
        "copy" -> fm(a).copy(a.getString("path"), a.optString("destDir", ""))
        "move" -> fm(a).move(a.getString("path"), a.optString("destDir", ""))
        "search" -> fm(a).search(a.getString("query"))

        // ---- import from device storage ----
        "importFiles" -> {
            val dir = projects.dir(a.getString("project"))
            val target = if (a.optString("dir", "").isEmpty()) dir else File(dir, a.getString("dir"))
            val uris = picker.pickFiles()
            if (uris.isEmpty()) JSONArray() else JSONArray(DocumentImporter.importFiles(context, uris, target))
        }
        "importFolder" -> {
            val dir = projects.dir(a.getString("project"))
            val target = if (a.optString("dir", "").isEmpty()) dir else File(dir, a.getString("dir"))
            val uri = picker.pickFolder() ?: return JSONObject.NULL
            DocumentImporter.importFolder(context, uri, target)
        }

        // ---- native file ops (Rust-accelerated with Kotlin fallback) ----
        "native.hashFile" -> {
            val dir = projects.dir(a.getString("project"))
            val f = com.sari.ide.core.PathGuard.resolve(dir, a.getString("path"))
            NativeFileOps.hashFile(f.absolutePath)
        }
        "native.scanDir" -> {
            val dir = projects.dir(a.getString("project"))
            val target = if (a.optString("path", "").isEmpty()) dir else com.sari.ide.core.PathGuard.resolve(dir, a.getString("path"))
            JSONArray(NativeFileOps.scanDirectory(target.absolutePath, a.optInt("maxDepth", 8)))
        }

        // ---- architecture info ----
        "arch.info" -> ArchitectureManager.info()

        // ---- storage ----
        "storage.status" -> JSONObject().put("shared", system.hasSharedStorageAccess())
        "storage.requestAccess" -> { system.openAllFilesAccessSettings(); true }

        // ---- De Linux runtime management ----
        "delinux.status" -> deLinuxRuntime.statusAll()
        "delinux.verify" -> {
            when (a.getString("id")) {
                "python" -> deLinuxRuntime.verifyPython()
                "cpp" -> deLinuxRuntime.verifyCpp()
                "javascript" -> deLinuxRuntime.verifyNode()
                "html" -> JSONObject().put("ok", true).put("status", "READY")
                else -> JSONObject().put("ok", false).put("error", "Unknown runtime")
            }
        }
        "delinux.install" -> {
            when (a.getString("id")) {
                "python" -> deLinuxRuntime.installPython { progress ->
                    // Stream progress lines back to the UI
                    val msg = JSONObject().put("id", reqId).put("stream", true)
                        .put("line", progress).put("isErr", false).put("sessionId", -1)
                    streamChannel.trySend(msg.toString())
                }
                else -> JSONObject().put("ok", false).put("error", "Auto-install only available for Python. For C/C++ and Node.js, install Termux and run: pkg install clang nodejs")
            }
        }

        // ---- De Linux code execution (no Termux required) ----
        "delinux.run" -> {
            val lang = a.getString("language")
            val filePath = a.getString("filePath")
            val project = a.getString("project")
            val stdin = if (a.has("stdin") && !a.isNull("stdin")) a.getString("stdin") else null
            val session = execManager.newSession(project, filePath, lang)
            val result = deLinuxExecutor.run(session, execManager, stdin) { sessionId, isErr, line ->
                // Only send if this session is still the current one
                if (execManager.isCurrentSession(sessionId)) {
                    val msg = JSONObject().put("id", reqId).put("stream", true)
                        .put("line", line).put("isErr", isErr).put("sessionId", sessionId)
                    streamChannel.trySend(msg.toString())
                }
            }
            result.put("sessionId", session.sessionId)
            result
        }
        "delinux.stop" -> { execManager.cancelCurrentSession(); JSONObject().put("cancelled", true) }
        "delinux.sessionInfo" -> execManager.info()

        // ---- Termux Terminal (optional, advanced) — NOT the default Run path ----
        "termux.available" -> TermuxBridge.isInstalled(context)
        "termux.diagnostics" -> JSONObject()
            .put("installed", TermuxBridge.isInstalled(context))
            .put("permission", TermuxBridge.hasPermission(context))
        "termux.run" -> {
            val projectDir = projects.dir(a.getString("project"))
            val subPath = a.optString("path", "")
            val absPath = if (subPath.isEmpty()) projectDir.absolutePath else File(projectDir, subPath).canonicalPath
            // Translate /storage/emulated/0/SARIProjects/... → the Termux-accessible
            // ~/storage/shared/SARIProjects/... path so Termux can use it as cwd/file arg.
            val termuxCwd = toTermuxPath(absPath)
            val stdin = if (a.has("stdin") && !a.isNull("stdin")) a.getString("stdin") else null
            val rawCmd = a.getString("command")
            // Also translate any absolute project paths that appear inside the command itself
            val translatedCmd = rawCmd.replace(projectDir.absolutePath, toTermuxPath(projectDir.absolutePath))
            TermuxBridge.run(context, translatedCmd, termuxCwd, a.optLong("timeoutMs", 120_000), stdin)
        }

        // ---- languages (via Termux — for the Termux Terminal path only) ----
        "languages.list" -> LanguageManager.list(context)
        "languages.install" -> LanguageManager.install(context, a.getString("id"))
        "languages.installPackages" -> LanguageManager.installPackages(context, a.getString("id"), a.getString("packages"))

        // ---- GitHub account ----
        "github.connect" -> github.connect(a.getString("username"), a.getString("token"), a.getString("repo"), a.optString("branch", ""))
        "github.status" -> github.status()
        "github.disconnect" -> { github.disconnect(); true }
        "github.listBranches" -> github.listBranches()
        "github.createBranch" -> github.createBranch(a.getString("name"), a.getString("from"))

        // ---- GitHub repository content ----
        "github.listRepoFiles" -> github.listRepoFiles()
        "github.importRepo" -> {
            val name = a.getString("project")
            projects.create(name, "empty")
            val fileManager = FileManager(projects.dir(name))
            val files = github.listRepoFiles()
            var count = 0
            for (i in 0 until files.length()) {
                val path = files.getJSONObject(i).getString("path")
                try { fileManager.writeBytes(path, github.pullFileBytes(path)); count++ } catch (e: Exception) { /* skip unreadable entries */ }
            }
            JSONObject().put("project", name).put("imported", count)
        }
        "github.pull" -> { fm(a).writeBytes(a.getString("path"), github.pullFileBytes(a.getString("path"))); true }
        "github.pullAll" -> {
            val files = github.listRepoFiles()
            var count = 0
            for (i in 0 until files.length()) {
                val path = files.getJSONObject(i).getString("path")
                try { fm(a).writeBytes(path, github.pullFileBytes(path)); count++ } catch (e: Exception) { }
            }
            count
        }
        "github.push" -> github.pushFile(a.getString("path"), fm(a).readBytes(a.getString("path")), a.optString("message", "Update ${a.getString("path")} via SARI IDE"))
        "github.pushAll" -> {
            val fileManager = fm(a)
            val message = a.optString("message", "Update project via SARI IDE")
            var count = 0
            for (path in fileManager.allFiles()) {
                try { github.pushFile(path, fileManager.readBytes(path), message); count++ } catch (e: Exception) { }
            }
            count
        }
        "github.pushChanged" -> {
            // Optimized push: only push files whose hash differs from a client-supplied map
            val fileManager = fm(a)
            val knownHashes = a.optJSONObject("hashes") ?: JSONObject()
            val message = a.optString("message", "Update project via SARI IDE")
            var count = 0
            for (path in fileManager.allFiles()) {
                try {
                    val f = com.sari.ide.core.PathGuard.resolve(projects.dir(a.getString("project")), path)
                    val localHash = NativeFileOps.hashFile(f.absolutePath)
                    val knownHash = knownHashes.optString(path, "")
                    if (localHash.isNotEmpty() && localHash == knownHash) continue // unchanged
                    github.pushFile(path, fileManager.readBytes(path), message); count++
                } catch (e: Exception) { }
            }
            count
        }
        "github.deleteFile" -> { github.deleteFile(a.getString("path"), a.optString("message", "Delete ${a.getString("path")} via SARI IDE")); true }

        // ---- GitHub Actions ----
        "github.triggerWorkflow" -> github.triggerWorkflow(a.optString("workflowFile", "android-build.yml"), a.optString("ref", ""))
        "github.listRuns" -> github.listRuns()
        "github.getRun" -> github.getRun(a.getLong("runId"))
        "github.getRunLogs" -> github.getRunLogSummary(a.getLong("runId"))
        "github.listArtifacts" -> github.listArtifacts(a.getLong("runId"))
        "github.downloadArtifact" -> {
            val bytes = github.downloadArtifactZip(a.getLong("artifactId"))
            val dir = projects.dir(a.getString("project"))
            val dest = File(dir, ".sari/downloads/${a.getLong("artifactId")}")
            val apks = ArtifactManager.extractZip(bytes, dest)
            JSONObject().put("extractedTo", dest.absolutePath.removePrefix(projectsRoot.absolutePath + "/"))
                .put("apks", JSONArray(apks.map { it.absolutePath }))
        }
        "github.installApk" -> { ApkInstaller.install(context, File(a.getString("path"))); true }

        else -> throw IllegalArgumentException("Unknown operation: $op")
        }
    }
}
