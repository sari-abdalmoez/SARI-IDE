package com.sari.ide.core

import android.content.Context
import com.sari.ide.bridge.TermuxBridge
import org.json.JSONArray
import org.json.JSONObject

/**
 * Language/runtime registry for the Termux-backed Run engine.
 *
 * Every language has:
 *  - an exact executable/probe command
 *  - an optional Termux package installer
 *  - an optional package-manager integration
 *
 * "installed" is never inferred from metadata: it is always verified by
 * executing the actual runtime/compiler check command.
 */
object LanguageManager {

    data class Lang(
        val id: String,
        val label: String,
        val checkCmd: String,
        val pkg: String?,
        val installCmd: String?,
        val pkgManager: String?
    )

    val registry = listOf(
        Lang("python", "Python", "python3 --version", "python", "pkg install -y python", "pip"),
        Lang("javascript", "Node.js / JavaScript", "node --version", "nodejs", "pkg install -y nodejs", "npm"),
        Lang("typescript", "TypeScript", "tsc --version", "nodejs", "pkg install -y nodejs && npm install -g typescript", "npm"),
        Lang("c", "C (clang)", "clang --version", "clang", "pkg install -y clang", null),
        Lang("cpp", "C++ (clang++)", "clang++ --version", "clang", "pkg install -y clang", null),
        Lang("java", "Java", "javac --version", "openjdk-17", "pkg install -y openjdk-17", null),
        Lang("kotlin", "Kotlin", "kotlinc -version", "kotlin", "pkg install -y kotlin", null),
        Lang("rust", "Rust", "rustc --version", "rust", "pkg install -y rust", "cargo"),
        Lang("go", "Go", "go version", "golang", "pkg install -y golang", null),
        Lang("php", "PHP", "php --version", "php", "pkg install -y php", null),
        Lang("ruby", "Ruby", "ruby --version", "ruby", "pkg install -y ruby", "gem"),
        Lang(
            "lua",
            "Lua",
            "(command -v lua5.4 >/dev/null 2>&1 && lua5.4 -v) || (command -v lua >/dev/null 2>&1 && lua -v)",
            "lua54",
            "pkg install -y lua54",
            null
        ),
        Lang("dart", "Dart", "dart --version", "dart", "pkg install -y dart", null),
        Lang("perl", "Perl", "perl -v", "perl", "pkg install -y perl", null),
        Lang("bash", "Shell / Bash", "bash --version", null, null, null),
        Lang("html", "HTML (WebView)", "true", null, null, null)
    )

    private fun find(id: String): Lang =
        registry.firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("Unknown language: $id")

    private suspend fun probe(context: Context, l: Lang): JSONObject {
        val r = TermuxBridge.run(context, l.checkCmd, null, 15_000)
        val ok = r.optBoolean("ok", false) || r.optInt("exitCode", -1) == 0

        val stdout = r.optString("stdout", "").trim()
        val stderr = r.optString("stderr", "").trim()

        return JSONObject()
            .put("id", l.id)
            .put("label", l.label)
            .put("ok", ok)
            .put("installed", ok)
            .put("version", stdout.ifBlank { stderr })
            .put(
                "error",
                if (ok) JSONObject.NULL
                else stderr.ifBlank { stdout.ifBlank { "Runtime/compiler not available" } }
            )
    }

    suspend fun check(context: Context, id: String): JSONObject {
        return probe(context, find(id))
    }

    suspend fun list(context: Context): JSONArray {
        val out = JSONArray()

        for (l in registry) {
            val r = probe(context, l)

            out.put(
                r.put("installable", l.installCmd != null)
                    .put("hasPackages", l.pkgManager != null)
            )
        }

        return out
    }

    suspend fun install(context: Context, id: String): JSONObject {
        val l = find(id)

        val command = l.installCmd
            ?: throw IllegalArgumentException("${l.label} does not require installation")

        val result = TermuxBridge.run(
            context,
            command + " 2>&1",
            null,
            300_000
        )

        val verified = probe(context, l)

        val stdout = result.optString("stdout", "")
        val stderr = result.optString("stderr", "")

        return JSONObject()
            .put("ok", verified.optBoolean("ok", false))
            .put("id", l.id)
            .put("label", l.label)
            .put("stdout", stdout)
            .put(
                "stderr",
                if (verified.optBoolean("ok", false)) {
                    stderr
                } else {
                    (stderr + "\n" + verified.optString("error", "")).trim()
                }
            )
            .put("exitCode", result.optInt("exitCode", -1))
            .put("version", verified.optString("version", ""))
    }

    suspend fun installPackages(
        context: Context,
        id: String,
        packages: String
    ): JSONObject {
        val l = find(id)
        val manager = l.pkgManager
            ?: throw IllegalArgumentException("${l.label} has no package manager configured")

        val safe = packages
            .replace(Regex("[;&|`$()<>]"), " ")
            .trim()

        require(safe.isNotBlank()) { "No packages given" }

        val cmd = when (manager) {
            "pip" -> "pip install --upgrade $safe"
            "npm" -> "npm install -g $safe"
            "gem" -> "gem install $safe"
            "cargo" -> "cargo install $safe"
            else -> throw IllegalArgumentException("Unsupported package manager: $manager")
        }

        return TermuxBridge.run(
            context,
            "$cmd 2>&1",
            null,
            300_000
        )
    }
}
