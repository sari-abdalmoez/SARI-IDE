package com.sari.ide.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Language/runtime inventory for De Linux. Termux is deliberately not used by this
 * manager; it is an optional terminal integration only.
 */
object LanguageManager {
    data class Lang(val id: String, val label: String, val executable: String, val packageManager: String?)

    val registry = listOf(
        Lang("python", "Python", "python3", "pip"),
        Lang("javascript", "JavaScript / Node.js", "node", "npm"),
        Lang("c", "C (clang)", "clang", null),
        Lang("cpp", "C++ (clang++)", "clang++", null),
        Lang("java", "Java", "java", null),
        Lang("kotlin", "Kotlin", "kotlinc", null),
        Lang("bash", "Shell / Bash", "sh", null),
    )

    suspend fun list(context: Context): JSONArray {
        val root = File(context.filesDir, "de-linux/bin")
        return JSONArray().also { out ->
            registry.forEach { l ->
                val installed = if (l.id == "bash") File("/system/bin/sh").canExecute()
                else File(root, l.executable).canExecute()
                out.put(
                    JSONObject()
                        .put("id", l.id)
                        .put("label", l.label)
                        .put("installable", false)
                        .put("installed", installed)
                        .put("hasPackages", installed && l.packageManager != null)
                        .put("runtime", "De Linux")
                )
            }
        }
    }

    suspend fun install(context: Context, id: String): JSONObject {
        val l = registry.firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown language")
        return JSONObject()
            .put("ok", false)
            .put("status", "NOT_INSTALLED")
            .put("runtime", "De Linux")
            .put("stderr", "${l.label} is not bundled in this build. Install a compatible De Linux runtime package when available; SARI IDE will not silently use Termux.")
            .put("exitCode", -1)
    }

    suspend fun installPackages(context: Context, id: String, packages: String): JSONObject {
        val l = registry.firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown language")
        require(l.packageManager != null) { "${l.label} has no package manager configured" }
        return JSONObject()
            .put("ok", false)
            .put("status", "UNSUPPORTED")
            .put("runtime", "De Linux")
            .put("stderr", "De Linux package manager is not installed on this device.")
            .put("exitCode", -1)
    }
}
