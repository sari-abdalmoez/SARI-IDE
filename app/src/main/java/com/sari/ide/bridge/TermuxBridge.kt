package com.sari.ide.bridge

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/**
 * Bridge to Termux's RUN_COMMAND plugin API (the same mechanism Termux:Tasker / Termux:Widget use).
 * Requires: Termux installed, `allow-external-apps=true` in ~/.termux/termux.properties inside Termux,
 * and the com.termux.permission.RUN_COMMAND permission (declared in this app's manifest; the user
 * grants it to SARI IDE from Android's App info screen the first time it's needed).
 */
object TermuxBridge {
    private const val TERMUX_PKG = "com.termux"
    private const val RUN_SERVICE = "com.termux.app.RunCommandService"
    private const val ACTION_RUN = "com.termux.RUN_COMMAND"
    private val pending = java.util.concurrent.ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()
    private val seq = AtomicInteger(1000)
    private const val HOME = "/data/data/com.termux/files/home"

    fun isInstalled(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(TERMUX_PKG, 0); true
    } catch (e: PackageManager.NameNotFoundException) { false }

    fun deliverResult(requestId: Int, result: JSONObject) {
        pending.remove(requestId)?.complete(result)
    }

    suspend fun run(context: Context, command: String, cwd: String?, timeoutMs: Long = 120_000): JSONObject {
        if (!isInstalled(context)) return err("Termux is not installed on this device. Install it from F-Droid or GitHub Releases (the Play Store build is outdated and incompatible).")

        val id = seq.incrementAndGet()
        val deferred = CompletableDeferred<JSONObject>()
        pending[id] = deferred

        val resultIntent = Intent(context, TermuxResultReceiver::class.java).putExtra("req_id", id)
        val flags = PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val pi = PendingIntent.getBroadcast(context, id, resultIntent, flags)

        val workdir = cwd ?: HOME
        val intent = Intent(ACTION_RUN).apply {
            setClassName(TERMUX_PKG, RUN_SERVICE)
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", command))
            putExtra("com.termux.RUN_COMMAND_WORKDIR", workdir)
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
            putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pi)
        }
        try {
            context.startService(intent)
        } catch (e: Exception) {
            pending.remove(id)
            return err("Could not reach Termux: ${e.message}. Make sure allow-external-apps=true is set in Termux's termux.properties and the RUN_COMMAND permission is granted.")
        }

        val result = withTimeoutOrNull(timeoutMs) { deferred.await() }
        pending.remove(id)
        return result ?: err("Command timed out after ${timeoutMs / 1000}s (still running in Termux)")
    }

    private fun err(msg: String) = JSONObject().put("stdout", "").put("stderr", msg).put("exitCode", -1).put("ok", false)
}
