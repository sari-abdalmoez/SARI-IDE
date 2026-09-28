package com.sari.ide.core

import java.io.File

/** All filesystem access from the WebView goes through here. */
object PathGuard {
    private val PROJECT_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$")
    private val ENTRY_NAME = Regex("^[^/\\\\\u0000]{1,128}$")

    fun validProjectName(name: String): Boolean = PROJECT_NAME.matches(name) && !name.contains("..")

    fun validEntryName(name: String): Boolean =
        ENTRY_NAME.matches(name) && name != "." && name != ".."

    /** Resolve [rel] inside [root]; throws if the canonical result escapes the root. */
    fun resolve(root: File, rel: String): File {
        require(!rel.contains('\u0000')) { "Invalid path" }
        val base = root.canonicalFile
        val f = File(base, rel).canonicalFile
        require(f.path == base.path || f.path.startsWith(base.path + File.separator)) {
            "Path is outside the project"
        }
        return f
    }
}
