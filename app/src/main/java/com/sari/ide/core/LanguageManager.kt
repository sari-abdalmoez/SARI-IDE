package com.sari.ide.core

import android.content.Context
import com.sari.ide.bridge.TermuxBridge
import org.json.JSONArray
import org.json.JSONObject

/** Languages that can genuinely be installed and run through Termux's `pkg` (apt) package manager. */
object LanguageManager {
    data class Lang(val id: String, val label: String, val checkCmd: String, val pkg: String?, val pkgManager: String?)

    // checkCmd must both prove presence AND be cheap/safe to run (a --version style probe).
    val registry = listOf(
        Lang("python", "Python", "python3 --version", "python", "pip"),
        Lang("c", "C (clang)", "clang --version", "clang", null),
        Lang("cpp", "C++ (clang++)", "clang++ --version", "clang", null),
        Lang("java", "Java", "javac --version", "openjdk-17", null),
        Lang("kotlin", "Kotlin", "kotlinc -version", "kotlin", null),
        Lang("javascript", "Node.js / JavaScript", "node --version", "nodejs", "npm"),
        Lang("typescript", "TypeScript", "tsc --version", null, "npm"),
        Lang("php", "PHP", "php --version", "php", null),
        Lang("ruby", "Ruby", "ruby --version", "ruby", "gem"),
        Lang("go", "Go", "go version", "golang", null),
        Lang("rust", "Rust", "rustc --version", "rust", "cargo"),
        Lang("lua", "Lua", "lua5.4 -v", "lua54", null),
        Lang("dart", "Dart", "dart --version", "dart", null),
        Lang("perl", "Perl", "perl -v", "perl", null),
        Lang("bash", "Shell / Bash", "bash --version", null, null),
    )

    suspend fun list(context: Context): JSONArray {
        val out = JSONArray()
        for (l in registry) {
            val installed = if (l.pkg == null) true else verify(context, l)
            out.put(
                JSONObject().put("id", l.id).put("label", l.label)
                    .put("installable", l.pkg != null).put("installed", installed)
                    .put("hasPackages", l.pkgManager != null)
            )
        }
        return out
    }

    private suspend fun verify(context: Context, l: Lang): Boolean {
        val r = TermuxBridge.run(context, l.checkCmd, null, 15_000)
        return r.optBoolean("ok", false) || (r.optInt("exitCode", -1) == 0)
    }

    /** Installs via pkg, then re-verifies with the same probe used by [list] — never reports Installed on faith. */
    suspend fun install(context: Context, id: String): JSONObject {
        val l = registry.firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown language")
        val pkg = l.pkg ?: throw IllegalArgumentException("${l.label} has nothing to install")
        val installResult = TermuxBridge.run(
            context,
            "pkg update -y 2>&1; pkg install -y $pkg 2>&1",
            null, 300_000
        )
        val verified = verify(context, l)
        val out = installResult.optString("stdout", "")
        val errOut = installResult.optString("stderr", "")
        return JSONObject()
            .put("ok", verified)
            .put("stdout", out)
            .put("stderr", if (verified) errOut else (errOut + "\n(verification command \"${l.checkCmd}\" did not succeed after install)").trim())
            .put("exitCode", installResult.optInt("exitCode", -1))
    }

    suspend fun installPackages(context: Context, id: String, packages: String): JSONObject {
        val l = registry.firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown language")
        val mgr = l.pkgManager ?: throw IllegalArgumentException("${l.label} has no package manager configured")
        val safe = packages.replace(Regex("[;&|`$()<>]"), " ").trim()
        require(safe.isNotBlank()) { "No packages given" }
        val cmd = when (mgr) {
            "pip" -> "pip install --upgrade $safe 2>&1"
            "npm" -> "npm install -g $safe 2>&1"
            "gem" -> "gem install $safe 2>&1"
            "cargo" -> "cargo install $safe 2>&1"
            else -> throw IllegalArgumentException("Unsupported package manager: $mgr")
        }
        return TermuxBridge.run(context, cmd, null, 300_000)
    }
}
