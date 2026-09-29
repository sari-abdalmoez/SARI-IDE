package com.sari.ide.core

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Encrypted, app-private storage for GitHub credentials. Never logged, never committed to a project. */
class SecureStore(context: Context) {
    private val prefs = run {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context, "sari_secure_prefs", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    data class GitHubConfig(val username: String, val token: String, val repo: String, val branch: String)

    fun saveGitHub(c: GitHubConfig) {
        prefs.edit()
            .putString("gh_user", c.username)
            .putString("gh_token", c.token)
            .putString("gh_repo", c.repo)
            .putString("gh_branch", c.branch)
            .apply()
    }

    fun getGitHub(): GitHubConfig? {
        val u = prefs.getString("gh_user", null) ?: return null
        val t = prefs.getString("gh_token", null) ?: return null
        val r = prefs.getString("gh_repo", null) ?: return null
        val b = prefs.getString("gh_branch", "main") ?: "main"
        return GitHubConfig(u, t, r, b)
    }

    fun setBranch(branch: String) { prefs.edit().putString("gh_branch", branch).apply() }

    fun clearGitHub() { prefs.edit().remove("gh_user").remove("gh_token").remove("gh_repo").remove("gh_branch").apply() }
}
