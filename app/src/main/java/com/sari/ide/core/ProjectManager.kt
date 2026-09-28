package com.sari.ide.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class ProjectManager(private val root: File) {
    init { root.mkdirs() }

    fun list(): JSONArray {
        val arr = JSONArray()
        root.listFiles { f -> f.isDirectory && PathGuard.validProjectName(f.name) }
            ?.sortedByDescending { it.lastModified() }
            ?.forEach { d ->
                val meta = readMeta(d)
                arr.put(
                    JSONObject()
                        .put("name", d.name)
                        .put("language", meta?.optString("language", "") ?: "")
                        .put("modified", d.lastModified())
                )
            }
        return arr
    }

    fun dir(name: String): File {
        require(PathGuard.validProjectName(name)) { "Invalid project name" }
        val d = File(root, name)
        require(d.isDirectory) { "Project not found" }
        return d
    }

    fun create(name: String, template: String): String {
        require(PathGuard.validProjectName(name)) { "Invalid project name (letters, digits, . _ - and spaces)" }
        val t = Templates.all[template] ?: throw IllegalArgumentException("Unknown template")
        val d = File(root, name)
        require(!d.exists()) { "A project with this name already exists" }
        check(d.mkdirs()) { "Cannot create project folder" }
        File(d, ".sari").mkdirs()
        val meta = JSONObject()
            .put("name", name)
            .put("language", t.language)
            .put("run", t.runFile)
            .put("created", System.currentTimeMillis())
        File(d, ".sari/project.json").writeText(meta.toString(2))
        File(d, "README.md").writeText("# $name\n\nCreated with SARI IDE.\n")
        t.files.forEach { (rel, content) -> File(d, rel).writeText(content) }
        return name
    }

    fun rename(name: String, newName: String): String {
        val src = dir(name)
        require(PathGuard.validProjectName(newName)) { "Invalid project name" }
        val dst = File(root, newName)
        require(!dst.exists()) { "A project with this name already exists" }
        check(src.renameTo(dst)) { "Rename failed" }
        return newName
    }

    fun duplicate(name: String): String {
        val src = dir(name)
        var n = 1
        var copyName = "$name-copy"
        while (File(root, copyName).exists() || !PathGuard.validProjectName(copyName)) {
            n++
            copyName = "$name-copy$n"
            if (n > 999) throw IllegalStateException("Cannot pick a name for the copy")
        }
        check(src.copyRecursively(File(root, copyName), overwrite = false)) { "Copy failed" }
        return copyName
    }

    fun delete(name: String) {
        val d = dir(name)
        check(d.deleteRecursively()) { "Delete failed" }
    }

    private fun readMeta(d: File): JSONObject? = try {
        JSONObject(File(d, ".sari/project.json").readText())
    } catch (e: Exception) {
        null
    }
}
