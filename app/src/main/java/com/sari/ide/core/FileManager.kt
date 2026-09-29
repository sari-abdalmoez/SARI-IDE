package com.sari.ide.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** File operations confined to a single project directory. */
class FileManager(projectDir: File) {
    private val root: File = projectDir.canonicalFile
    private val skipDirs = setOf(".git", "build", ".gradle", "node_modules")
    private val maxReadBytes = 2L * 1024 * 1024

    private fun rel(f: File): String = f.relativeTo(root).path.replace(File.separatorChar, '/')

    fun list(path: String): JSONArray {
        val d = PathGuard.resolve(root, path)
        require(d.isDirectory) { "Not a folder" }
        val arr = JSONArray()
        d.listFiles()
            ?.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
            ?.forEach {
                arr.put(JSONObject().put("name", it.name).put("dir", it.isDirectory).put("size", it.length()))
            }
        return arr
    }

    fun read(path: String): String {
        val f = PathGuard.resolve(root, path)
        require(f.isFile) { "Not a file" }
        require(f.length() <= maxReadBytes) { "File is larger than 2 MB (large-file mode arrives in Phase 2)" }
        val text = f.readText(Charsets.UTF_8)
        require(!text.contains('\u0000')) { "Binary files cannot be opened in the editor" }
        return text
    }

    /** Byte-exact read, for anything that may be binary (images, archives, etc.) — used by GitHub sync. */
    fun readBytes(path: String): ByteArray {
        val f = PathGuard.resolve(root, path)
        require(f.isFile) { "Not a file" }
        require(f.length() <= 20L * 1024 * 1024) { "File is larger than 20 MB" }
        return f.readBytes()
    }

    fun writeBytes(path: String, bytes: ByteArray) {
        val f = PathGuard.resolve(root, path)
        require(!f.isDirectory) { "Target is a folder" }
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".sari-tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) {
            f.delete()
            check(tmp.renameTo(f)) { "Save failed" }
        }
    }

    fun write(path: String, content: String) {
        val f = PathGuard.resolve(root, path)
        require(!f.isDirectory) { "Target is a folder" }
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".sari-tmp")
        tmp.writeText(content, Charsets.UTF_8)
        if (!tmp.renameTo(f)) {
            f.delete()
            check(tmp.renameTo(f)) { "Save failed" }
        }
    }

    fun createFile(dir: String, name: String): String {
        require(PathGuard.validEntryName(name)) { "Invalid file name" }
        val parent = PathGuard.resolve(root, dir)
        require(parent.isDirectory) { "Not a folder" }
        val f = PathGuard.resolve(root, join(dir, name))
        require(!f.exists()) { "Already exists" }
        check(f.createNewFile()) { "Cannot create file" }
        return rel(f)
    }

    fun createDir(dir: String, name: String): String {
        require(PathGuard.validEntryName(name)) { "Invalid folder name" }
        val parent = PathGuard.resolve(root, dir)
        require(parent.isDirectory) { "Not a folder" }
        val f = PathGuard.resolve(root, join(dir, name))
        require(!f.exists()) { "Already exists" }
        check(f.mkdirs()) { "Cannot create folder" }
        return rel(f)
    }

    fun rename(path: String, newName: String): String {
        require(PathGuard.validEntryName(newName)) { "Invalid name" }
        val f = PathGuard.resolve(root, path)
        require(f != root) { "Cannot rename the project root" }
        val target = PathGuard.resolve(root, join(rel(f.parentFile!!), newName))
        require(!target.exists()) { "Already exists" }
        check(f.renameTo(target)) { "Rename failed" }
        return rel(target)
    }

    fun delete(path: String) {
        val f = PathGuard.resolve(root, path)
        require(f != root) { "Cannot delete the project root" }
        check(f.deleteRecursively()) { "Delete failed" }
    }

    fun copy(path: String, destDir: String): String {
        val src = PathGuard.resolve(root, path)
        require(src != root) { "Cannot copy the project root" }
        val dest = PathGuard.resolve(root, destDir)
        require(dest.isDirectory) { "Destination is not a folder" }
        require(!(src.isDirectory && (dest == src || dest.path.startsWith(src.path + File.separator)))) {
            "Cannot copy a folder into itself"
        }
        val target = unique(dest, src.name)
        if (src.isDirectory) check(src.copyRecursively(target)) { "Copy failed" } else src.copyTo(target)
        return rel(target)
    }

    fun move(path: String, destDir: String): String {
        val src = PathGuard.resolve(root, path)
        require(src != root) { "Cannot move the project root" }
        val dest = PathGuard.resolve(root, destDir)
        require(dest.isDirectory) { "Destination is not a folder" }
        require(!(src.isDirectory && (dest == src || dest.path.startsWith(src.path + File.separator)))) {
            "Cannot move a folder into itself"
        }
        val target = unique(dest, src.name)
        if (!src.renameTo(target)) {
            if (src.isDirectory) check(src.copyRecursively(target)) { "Move failed" } else src.copyTo(target)
            src.deleteRecursively()
        }
        return rel(target)
    }

    /** All file paths (relative, forward-slash) under the project, skipping VCS/build clutter. Used for GitHub push. */
    fun allFiles(): List<String> {
        val out = mutableListOf<String>()
        for (f in root.walkTopDown().onEnter { it.name !in skipDirs }) {
            if (f.isFile) out.add(rel(f))
        }
        return out
    }

    fun search(query: String): JSONArray {
        val q = query.trim().lowercase()
        val arr = JSONArray()
        if (q.isEmpty()) return arr
        var count = 0
        for (f in root.walkTopDown().onEnter { it.name !in skipDirs }) {
            if (f.isFile && f.name.lowercase().contains(q)) {
                arr.put(rel(f))
                if (++count >= 200) break
            }
        }
        return arr
    }

    private fun join(dir: String, name: String) = if (dir.isEmpty()) name else "$dir/$name"

    private fun unique(dir: File, name: String): File {
        var f = File(dir, name)
        var n = 1
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        while (f.exists()) {
            f = File(dir, "$stem copy${if (n > 1) " $n" else ""}$ext")
            n++
        }
        return f
    }
}
