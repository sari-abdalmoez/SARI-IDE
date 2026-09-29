package com.sari.ide.bridge

import android.content.Context
import com.sari.ide.core.ApkInstaller
import com.sari.ide.core.ArtifactManager
import com.sari.ide.core.DocumentImporter
import com.sari.ide.core.FileManager
import com.sari.ide.core.GitHubService
import com.sari.ide.core.LanguageManager
import com.sari.ide.core.ProjectManager
import com.sari.ide.core.SecureStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Message protocol between the WebView UI and native code.
 * Request : {"id":1,"op":"readFile","args":{...}}
 * Response: {"id":1,"ok":true,"data":...} or {"id":1,"ok":false,"error":"..."}
 * Every operation below is an explicit allow-list entry; there is no general shell access from JS.
 */
class NativeBridge(
    private val context: Context,
    private val projectsRoot: File,
    private val picker: DocumentPicker,
    private val system: SystemActions
) {
    private val projects = ProjectManager(projectsRoot)
    private val secureStore = SecureStore(context)
    private val github = GitHubService(secureStore)

    suspend fun handle(raw: String): String {
        var id: Any = JSONObject.NULL
        return try {
            val req = JSONObject(raw)
            id = req.opt("id") ?: JSONObject.NULL
            val a = req.optJSONObject("args") ?: JSONObject()
            val data = dispatch(req.getString("op"), a)
            JSONObject().put("id", id).put("ok", true).put("data", data).toString()
        } catch (e: Exception) {
            JSONObject().put("id", id).put("ok", false)
                .put("error", e.message ?: e.javaClass.simpleName).toString()
        }
    }

    private fun fm(a: JSONObject) = FileManager(projects.dir(a.getString("project")))

    private suspend fun dispatch(op: String, a: JSONObject): Any = when (op) {
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

        // ---- storage ----
        "storage.status" -> JSONObject().put("shared", system.hasSharedStorageAccess())
        "storage.requestAccess" -> { system.openAllFilesAccessSettings(); true }

        // ---- Termux execution ----
        "termux.available" -> TermuxBridge.isInstalled(context)
        "termux.run" -> {
            val dir = projects.dir(a.getString("project"))
            val cwd = if (a.optString("path", "").isEmpty()) dir.absolutePath else File(dir, a.getString("path")).absolutePath
            TermuxBridge.run(context, a.getString("command"), cwd, a.optLong("timeoutMs", 120_000))
        }

        // ---- languages (installed/run via Termux) ----
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
        "github.pull" -> {
            val content = github.pullFile(a.getString("path"))
            fm(a).write(a.getString("path"), content)
            true
        }
        "github.pullAll" -> {
            val files = github.listRepoFiles()
            var count = 0
            for (i in 0 until files.length()) {
                val path = files.getJSONObject(i).getString("path")
                try { fm(a).write(path, github.pullFile(path)); count++ } catch (e: Exception) { /* skip unreadable entries */ }
            }
            count
        }
        "github.push" -> github.pushFile(a.getString("path"), fm(a).read(a.getString("path")), a.optString("message", "Update ${a.getString("path")} via SARI IDE"))
        "github.pushAll" -> {
            val fileManager = fm(a)
            val message = a.optString("message", "Update project via SARI IDE")
            var count = 0
            for (path in fileManager.allFiles()) {
                try { github.pushFile(path, fileManager.read(path), message); count++ } catch (e: Exception) { /* skip binary/unreadable */ }
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
