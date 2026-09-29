package com.sari.ide.core

import android.content.Context
import com.sari.ide.bridge.TermuxBridge
import org.json.JSONArray
import org.json.JSONObject

/** Languages that can genuinely be installed and run through Termux's `pkg` (apt) package manager. */
object LanguageManager {
    data class Lang(val id: String, val label: String, val icon: String, val checkBin: String, val pkg: String?, val pkgManager: String?)

    val registry = listOf(
        Lang("python", "Python", "🐍", "python3", "python", "pip"),
        Lang("c", "C", "🇨", "clang", "clang", null),
        Lang("cpp", "C++", "➕", "clang++", "clang", null),
        Lang("java", "Java", "☕", "javac", "openjdk-17", null),
        Lang("kotlin", "Kotlin", "🅺", "kotlinc", "kotlin", null),
        Lang("javascript", "Node.js / JavaScript", "🟨", "node", "nodejs", "npm"),
        Lang("typescript", "TypeScript", "🔷", "tsc", null, "npm"),
        Lang("php", "PHP", "🐘", "php", "php", null),
        Lang("ruby", "Ruby", "💎", "ruby", "ruby", "gem"),
        Lang("go", "Go", "🐹", "go", "golang", null),
        Lang("rust", "Rust", "🦀", "rustc", "rust", "cargo"),
        Lang("lua", "Lua", "🌙", "lua5.4", "lua54", null),
        Lang("dart", "Dart", "🎯", "dart", "dart", null),
        Lang("perl", "Perl", "🐪", "perl", "perl", null),
        Lang("bash", "Shell / Bash", "🐚", "bash", null, null),
    )

    suspend fun list(context: Context): JSONArray {
        val out = JSONArray()
        for (l in registry) {
            val status = if (l.pkg == null) {
                JSONObject().put("installed", true).put("checked", true)
            } else {
                val r = TermuxBridge.run(context, "command -v ${l.checkBin} >/dev/null 2>&1 && echo YES || echo NO", null, 15_000)
                val ok = r.optString("stdout").contains("YES")
                JSONObject().put("installed", ok).put("checked", r.optBoolean("ok", false) || r.optString("stdout").isNotBlank())
            }
            out.put(
                JSONObject().put("id", l.id).put("label", l.label).put("icon", l.icon)
                    .put("installable", l.pkg != null).put("installed", status.optBoolean("installed"))
                    .put("hasPackages", l.pkgManager != null)
            )
        }
        return out
    }

    suspend fun install(context: Context, id: String): JSONObject {
        val l = registry.firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown language")
        val pkg = l.pkg ?: throw IllegalArgumentException("${l.label} has nothing to install")
        return TermuxBridge.run(context, "pkg update -y >/dev/null 2>&1; pkg install -y $pkg", null, 300_000)
    }

    suspend fun installPackages(context: Context, id: String, packages: String): JSONObject {
        val l = registry.firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown language")
        val mgr = l.pkgManager ?: throw IllegalArgumentException("${l.label} has no package manager configured")
        val safe = packages.replace(Regex("[;&|`$()<>]"), " ").trim()
        require(safe.isNotBlank()) { "No packages given" }
        val cmd = when (mgr) {
            "pip" -> "pip install --upgrade $safe"
            "npm" -> "npm install -g $safe"
            "gem" -> "gem install $safe"
            "cargo" -> "cargo install $safe"
            else -> throw IllegalArgumentException("Unsupported package manager: $mgr")
        }
        return TermuxBridge.run(context, cmd, null, 300_000)
    }
}
