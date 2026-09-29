package com.sari.ide.core

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import java.io.File

/** Copies files/folders picked via Storage Access Framework into a project directory on disk. */
object DocumentImporter {

    fun importFiles(context: Context, uris: List<Uri>, destDir: File): List<String> {
        val names = mutableListOf<String>()
        for (uri in uris) {
            val doc = DocumentFile.fromSingleUri(context, uri) ?: continue
            val name = uniqueName(destDir, doc.name ?: "file")
            val out = File(destDir, name)
            context.contentResolver.openInputStream(uri)?.use { input ->
                out.outputStream().use { output -> input.copyTo(output) }
            }
            names.add(name)
        }
        return names
    }

    fun importFolder(context: Context, treeUri: Uri, destDir: File): String {
        val root = DocumentFile.fromTreeUri(context, treeUri) ?: throw IllegalArgumentException("Cannot open folder")
        val name = uniqueName(destDir, root.name ?: "folder")
        val target = File(destDir, name)
        target.mkdirs()
        copyRecursive(context, root, target)
        return name
    }

    private fun copyRecursive(context: Context, doc: DocumentFile, into: File) {
        for (child in doc.listFiles()) {
            val n = child.name ?: continue
            if (child.isDirectory) {
                val sub = File(into, n)
                sub.mkdirs()
                copyRecursive(context, child, sub)
            } else {
                val out = File(into, n)
                context.contentResolver.openInputStream(child.uri)?.use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                }
            }
        }
    }

    private fun uniqueName(dir: File, name: String): String {
        var f = File(dir, name)
        var n = 1
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        while (f.exists()) { f = File(dir, "$stem-${n++}$ext") }
        return f.name
    }
}
