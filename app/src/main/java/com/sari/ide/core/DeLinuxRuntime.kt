package com.sari.ide.core

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * De Linux is SARI IDE's internal execution provider.
 *
 * The project does not ship desktop Linux/Python/Clang binaries yet, so this class
 * deliberately reports missing runtimes instead of silently falling back to Termux.
 * A future runtime installer can populate filesDir/de-linux/bin without changing
 * ExecutionManager or the UI protocol.
 */
class DeLinuxRuntime(private val context: Context) {
    private val root = File(context.filesDir, "de-linux")
    private val bin = File(root, "bin")

    fun status(): JSONObject {
        val names = listOf("python3", "node", "clang", "clang++", "javac", "java", "kotlinc")
        val available = names.filter { File(bin, it).canExecute() }
        return JSONObject()
            .put("name", "De Linux")
            .put("root", root.absolutePath)
            .put("status", if (available.isNotEmpty()) "READY" else "NOT_INSTALLED")
            .put("availableRuntimes", available.joinToString(","))
    }

    fun command(language: String, file: File, workspace: File): List<String>? {
        val exe = when (language.lowercase()) {
            "python" -> File(bin, "python3")
            "javascript" -> File(bin, "node")
            "c" -> File(bin, "clang")
            "cpp" -> File(bin, "clang++")
            "java" -> File(bin, "javac")
            "kotlin" -> File(bin, "kotlinc")
            "bash" -> File("/system/bin/sh")
            else -> return null
        }

        if (language.lowercase() != "bash" && !exe.canExecute()) return null

        fun q(path: String) = "'" + path.replace("'", "'\\''") + "'"
        return when (language.lowercase()) {
            "python", "javascript" -> listOf(exe.absolutePath, file.absolutePath)
            "bash" -> listOf(exe.absolutePath, file.absolutePath)
            "c", "cpp" -> {
                val out = File(workspace, ".sari-bin/program")
                out.parentFile?.mkdirs()
                listOf("/system/bin/sh", "-c", "${q(exe.absolutePath)} ${q(file.absolutePath)} -O2 -o ${q(out.absolutePath)} && ${q(out.absolutePath)}")
            }
             "java" -> listOf("/system/bin/sh", "-c", "mkdir -p .sari-bin && ${q(exe.absolutePath)} ${q(file.absolutePath)} -d .sari-bin && ${q(File(bin, "java").absolutePath)} -cp .sari-bin ${q(file.nameWithoutExtension)}")
            "kotlin" -> listOf("/system/bin/sh", "-c", "${q(exe.absolutePath)} ${q(file.absolutePath)} -include-runtime -d .sari-bin/program.jar && ${q(File(bin, "java").absolutePath)} -jar .sari-bin/program.jar")
            else -> null
        }
    }
}
