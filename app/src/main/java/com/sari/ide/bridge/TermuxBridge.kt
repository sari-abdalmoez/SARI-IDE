package com.sari.ide.bridge

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/**
 * Bridge to Termux's RUN_COMMAND plugin API — the same IPC mechanism Termux:Tasker / Termux:Widget /
 * Termux:API use to run commands inside the user's real, already-configured Termux installation.
 *
 * Requirements on the Termux side (unrelated to this app and not something we can fix here):
 *  - `allow-external-apps=true` in ~/.termux/termux.properties, followed by `termux-reload-settings`.
 * Requirements on this app's side (what earlier versions got wrong, see TermuxResultReceiver):
 *  - the com.termux.permission.RUN_COMMAND permission must be granted at RUNTIME (it has
 *    protectionLevel="dangerous" in Termux's manifest — just declaring <uses-permission> is not enough).
 *  - the result Termux posts back is a single "result" Bundle extra, not flat extras.
 */
object TermuxBridge {
    private const val TAG = "SariTermux"
    private const val TERMUX_PKG = "com.termux"
    private const val RUN_SERVICE = "com.termux.app.RunCommandService"
    private const val ACTION_RUN = "com.termux.RUN_COMMAND"
    const val PERMISSION = "com.termux.permission.RUN_COMMAND"
    private const val HOME = "/data/data/com.termux/files/home"

    private val pending = java.util.concurrent.ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()
    private val seq = AtomicInteger(1000)

    /** Set once by MainActivity so this object can trigger a runtime permission request without holding an Activity. */
    var permissionChecker: (suspend () -> Boolean)? = null

    fun isInstalled(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(TERMUX_PKG, 0); true
    } catch (e: PackageManager.NameNotFoundException) { false }

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, PERMISSION) == PackageManager.PERMISSION_GRANTED

    fun deliverResult(requestId: Int, result: JSONObject) {
        pending.remove(requestId)?.complete(result)
    }

    /** stdin is optional: RUN_COMMAND has no live interactive channel, so it's piped in up front (see README). */
    suspend fun run(context: Context, command: String, cwd: String?, timeoutMs: Long = 90_000, stdin: String? = null): JSONObject {
        if (!isInstalled(context)) {
            return err("Termux is not installed on this device. Install the F-Droid or GitHub-release build of Termux (the Play Store build is outdated and incompatible with this integration).")
        }

        if (!hasPermission(context)) {
            val granted = permissionChecker?.invoke() ?: false
            if (!granted) {
                return err("SARI IDE does not have Termux's RUN_COMMAND permission yet. Grant it in the dialog that just appeared (or in Android Settings > Apps > SARI IDE > Permissions) and try again.")
            }
        }

        val id = seq.incrementAndGet()
        val deferred = CompletableDeferred<JSONObject>()
        pending[id] = deferred

        val resultIntent = Intent(context, TermuxResultReceiver::class.java)
            .putExtra("req_id", id)

        val flags =
            PendingIntent.FLAG_ONE_SHOT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE
            } else {
                0
            }

        val pi = PendingIntent.getService(context, id, resultIntent, flags)

        val workdir = cwd ?: HOME
        val fullCommand = if (stdin != null) {
            val escaped = stdin.replace("'", "'\\''")
            "printf '%s' '$escaped' | $command"
        } else command

        val intent = Intent(ACTION_RUN).apply {
            setClassName(TERMUX_PKG, RUN_SERVICE)
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", fullCommand))
            putExtra("com.termux.RUN_COMMAND_WORKDIR", workdir)
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
            putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pi)
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startService(intent)
            } else {
                context.startService(intent)
            }
        } catch (e: SecurityException) {
            pending.remove(id)
            Log.w(TAG, "RUN_COMMAND rejected: ${e.message}")
            return err("Android refused to start Termux's command service (permission not actually granted, or Termux's RUN_COMMAND receiver is disabled). Re-check the RUN_COMMAND permission for SARI IDE.")
        } catch (e: IllegalStateException) {
            pending.remove(id)
            return err("Could not start Termux's background service: ${e.message}. Try opening Termux once manually, then retry.")
        } catch (e: Exception) {
            pending.remove(id)
            return err("Could not reach Termux: ${e.message}")
        }

        val result = withTimeoutOrNull(timeoutMs) { deferred.await() }
        pending.remove(id)
        return result ?: err("Command timed out after ${timeoutMs / 1000}s (it may still be running inside Termux)")
    }

    private fun err(msg: String) = JSONObject().put("stdout", "").put("stderr", msg).put("exitCode", -1).put("ok", false)
}
