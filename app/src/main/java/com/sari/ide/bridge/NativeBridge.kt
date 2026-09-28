package com.sari.ide.bridge

import com.sari.ide.core.FileManager
import com.sari.ide.core.ProjectManager
import org.json.JSONObject
import java.io.File

/**
 * Message protocol between the WebView UI and native code.
 * Request : {"id":1,"op":"readFile","args":{...}}
 * Response: {"id":1,"ok":true,"data":...} or {"id":1,"ok":false,"error":"..."}
 * Only an explicit allow-list of operations exists; no shell access in this phase.
 */
class NativeBridge(projectsRoot: File) {
    private val projects = ProjectManager(projectsRoot)

    fun handle(raw: String): String {
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

    private fun dispatch(op: String, a: JSONObject): Any = when (op) {
        "listProjects" -> projects.list()
        "createProject" -> projects.create(a.getString("name"), a.getString("template"))
        "renameProject" -> projects.rename(a.getString("name"), a.getString("newName"))
        "duplicateProject" -> projects.duplicate(a.getString("name"))
        "deleteProject" -> { projects.delete(a.getString("name")); true }
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
        else -> throw IllegalArgumentException("Unknown operation: $op")
    }
}
