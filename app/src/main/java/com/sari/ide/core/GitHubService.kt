package com.sari.ide.core

import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class GitHubApiException(message: String, val status: Int = 0) : IOException(message)

/** Thin wrapper over the GitHub REST API used by the repository and Actions screens. Stateless; credentials are passed in per call. */
class GitHubService(private val store: SecureStore) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val base = "https://api.github.com"

    private fun cfg() = store.getGitHub() ?: throw GitHubApiException("Not connected to GitHub")

    private fun req(method: String, url: String, body: JSONObject? = null): JSONObject {
        val c = cfg()
        val b = Request.Builder().url(url)
            .header("Authorization", "Bearer ${c.token}")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
        when (method) {
            "GET" -> b.get()
            "DELETE" -> if (body != null) b.delete(body.toString().toRequestBody(jsonMedia)) else b.delete()
            else -> b.method(method, (body ?: JSONObject()).toString().toRequestBody(jsonMedia))
        }
        client.newCall(b.build()).execute().use { r ->
            val text = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                val msg = try { JSONObject(text).optString("message", text) } catch (e: Exception) { text }
                throw GitHubApiException("GitHub API error (${r.code}): $msg", r.code)
            }
            if (text.isBlank()) return JSONObject()
            return if (text.trim().startsWith("[")) JSONObject().put("_array", JSONArray(text)) else JSONObject(text)
        }
    }

    private fun rawText(url: String): String {
        val c = cfg()
        val req = Request.Builder().url(url)
            .header("Authorization", "Bearer ${c.token}")
            .header("Accept", "application/vnd.github+json")
            .build()
        client.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw GitHubApiException("GitHub API error (${r.code})", r.code)
            return r.body?.string().orEmpty()
        }
    }

    private fun rawBytes(url: String): ByteArray {
        val c = cfg()
        val req = Request.Builder().url(url)
            .header("Authorization", "Bearer ${c.token}")
            .build()
        client.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw GitHubApiException("GitHub API error (${r.code})", r.code)
            return r.body?.bytes() ?: ByteArray(0)
        }
    }

    fun connect(username: String, token: String, repo: String, branch: String): JSONObject {
        require(username.isNotBlank() && token.isNotBlank() && repo.isNotBlank()) { "Username, token and repository are required" }
        val cleanRepo = repo.trim().removePrefix("https://github.com/").removeSuffix(".git").trim('/')
        require(cleanRepo.count { it == '/' } == 1) { "Repository must be in the form owner/repo" }
        store.saveGitHub(SecureStore.GitHubConfig(username.trim(), token.trim(), cleanRepo, branch.ifBlank { "main" }))
        val info = try {
            req("GET", "$base/repos/$cleanRepo")
        } catch (e: GitHubApiException) {
            store.clearGitHub()
            if (e.status == 404) throw GitHubApiException("Repository \"$cleanRepo\" was not found, or this token cannot see it (private repos need the \"repo\" scope).", 404)
            if (e.status == 401) throw GitHubApiException("GitHub rejected the token (invalid or expired).", 401)
            throw e
        }
        val defaultBranch = info.optString("default_branch", "main")
        if (branch.isBlank()) store.setBranch(defaultBranch)
        return status()
    }

    fun status(): JSONObject {
        val c = store.getGitHub() ?: return JSONObject().put("connected", false)
        return JSONObject().put("connected", true).put("username", c.username).put("repo", c.repo).put("branch", c.branch)
    }

    fun disconnect() { store.clearGitHub() }

    fun listBranches(): JSONArray {
        val c = cfg()
        val r = req("GET", "$base/repos/${c.repo}/branches?per_page=100")
        val arr = r.optJSONArray("_array") ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until arr.length()) out.put(arr.getJSONObject(i).getString("name"))
        return out
    }

    fun createBranch(name: String, fromBranch: String): String {
        val c = cfg()
        val base0 = req("GET", "$base/repos/${c.repo}/git/refs/heads/$fromBranch")
        val sha = base0.getJSONObject("object").getString("sha")
        req("POST", "$base/repos/${c.repo}/git/refs", JSONObject().put("ref", "refs/heads/$name").put("sha", sha))
        return name
    }

    /** Full recursive file list of the connected repo/branch. */
    fun listRepoFiles(): JSONArray {
        val c = cfg()
        val tree = req("GET", "$base/repos/${c.repo}/git/trees/${c.branch}?recursive=1")
        val arr = tree.optJSONArray("tree") ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val e = arr.getJSONObject(i)
            if (e.optString("type") == "blob") out.put(JSONObject().put("path", e.getString("path")).put("size", e.optLong("size", 0)))
        }
        return out
    }

    private fun encPath(path: String) = path.split("/").joinToString("/") {
        java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20")
    }

    fun pullFile(path: String): String {
        val c = cfg()
        val r = req("GET", "$base/repos/${c.repo}/contents/${encPath(path)}?ref=${c.branch}")
        val content = r.optString("content", "")
        return String(Base64.decode(content.replace("\n", ""), Base64.DEFAULT), Charsets.UTF_8)
    }

    /** Byte-exact fetch — use this (not [pullFile]) for anything that isn't guaranteed plain text, so binary assets round-trip intact. */
    fun pullFileBytes(path: String): ByteArray {
        val c = cfg()
        val r = req("GET", "$base/repos/${c.repo}/contents/${encPath(path)}?ref=${c.branch}")
        val content = r.optString("content", "")
        return Base64.decode(content.replace("\n", ""), Base64.DEFAULT)
    }

    private fun existingSha(path: String): String? = try {
        req("GET", "$base/repos/${cfg().repo}/contents/${encPath(path)}?ref=${cfg().branch}").optString("sha", null)
    } catch (e: GitHubApiException) { null }

    fun pushFile(path: String, content: ByteArray, message: String): JSONObject {
        val c = cfg()
        val sha = existingSha(path)
        val body = JSONObject()
            .put("message", message)
            .put("content", Base64.encodeToString(content, Base64.NO_WRAP))
            .put("branch", c.branch)
        if (sha != null) body.put("sha", sha)
        return req("PUT", "$base/repos/${c.repo}/contents/${encPath(path)}", body)
    }

    fun deleteFile(path: String, message: String) {
        val sha = existingSha(path) ?: throw GitHubApiException("File not found on GitHub")
        req("DELETE", "$base/repos/${cfg().repo}/contents/${encPath(path)}",
            JSONObject().put("message", message).put("sha", sha).put("branch", cfg().branch))
    }

    fun triggerWorkflow(workflowFile: String, ref: String): JSONObject {
        val c = cfg()
        val targetRef = ref.ifBlank { c.branch }

        // A bare 404 from the dispatch endpoint is almost always one of these two — check them first so the
        // user gets an actionable reason instead of "404 Not Found".
        try {
            req("GET", "$base/repos/${c.repo}/branches/$targetRef")
        } catch (e: GitHubApiException) {
            if (e.status == 404) throw GitHubApiException("Branch \"$targetRef\" does not exist yet in ${c.repo}. Push your project to that branch first (GitHub \u2192 Push all).", 404)
            throw e
        }
        try {
            req("GET", "$base/repos/${c.repo}/contents/.github/workflows/$workflowFile?ref=$targetRef")
        } catch (e: GitHubApiException) {
            if (e.status == 404) throw GitHubApiException(
                "Workflow file .github/workflows/$workflowFile was not found on branch \"$targetRef\". Push your project first \u2014 it includes this workflow file. " +
                    "Note: GitHub only lets you dispatch a workflow that already exists on the repository's default branch, even when targeting another branch.",
                404
            )
            throw e
        }

        req("POST", "$base/repos/${c.repo}/actions/workflows/$workflowFile/dispatches", JSONObject().put("ref", targetRef))
        Thread.sleep(1200)
        val runs = req("GET", "$base/repos/${c.repo}/actions/runs?per_page=5")
        val arr = runs.optJSONArray("workflow_runs") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val run = arr.getJSONObject(i)
            if (run.optString("path", "").endsWith(workflowFile)) return run
        }
        return if (arr.length() > 0) arr.getJSONObject(0) else JSONObject()
    }

    fun listRuns(): JSONArray {
        val c = cfg()
        val r = req("GET", "$base/repos/${c.repo}/actions/runs?branch=${c.branch}&per_page=15")
        return r.optJSONArray("workflow_runs") ?: JSONArray()
    }

    fun getRun(runId: Long): JSONObject = req("GET", "$base/repos/${cfg().repo}/actions/runs/$runId")

    fun getRunJobs(runId: Long): JSONArray {
        val r = req("GET", "$base/repos/${cfg().repo}/actions/runs/$runId/jobs")
        return r.optJSONArray("jobs") ?: JSONArray()
    }

    fun getRunLogSummary(runId: Long): String {
        val jobs = getRunJobs(runId)
        val sb = StringBuilder()
        for (i in 0 until jobs.length()) {
            val job = jobs.getJSONObject(i)
            sb.append("## ").append(job.getString("name")).append(" — ").append(job.optString("conclusion", job.optString("status"))).append('\n')
            val steps = job.optJSONArray("steps") ?: JSONArray()
            for (s in 0 until steps.length()) {
                val st = steps.getJSONObject(s)
                sb.append("  - ").append(st.getString("name")).append(": ").append(st.optString("conclusion", st.optString("status"))).append('\n')
            }
            if (job.optString("conclusion") == "failure") {
                try {
                    val log = rawText("$base/repos/${cfg().repo}/actions/jobs/${job.getLong("id")}/logs")
                    sb.append("\n--- log tail (").append(job.getString("name")).append(") ---\n")
                    sb.append(log.takeLast(4000))
                    sb.append('\n')
                } catch (e: Exception) { sb.append("  (log unavailable: ${e.message})\n") }
            }
        }
        return sb.toString()
    }

    fun listArtifacts(runId: Long): JSONArray {
        val r = req("GET", "$base/repos/${cfg().repo}/actions/runs/$runId/artifacts")
        return r.optJSONArray("artifacts") ?: JSONArray()
    }

    fun downloadArtifactZip(artifactId: Long): ByteArray =
        rawBytes("$base/repos/${cfg().repo}/actions/artifacts/$artifactId/zip")
}
