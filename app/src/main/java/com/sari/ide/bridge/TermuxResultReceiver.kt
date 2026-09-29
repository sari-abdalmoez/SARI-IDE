package com.sari.ide.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject

/**
 * Receives the callback Termux fires after a RUN_COMMAND finishes in the background.
 *
 * IMPORTANT (this was the root cause of every command reporting exit code -1):
 * Termux's RunCommandService does NOT put stdout/stderr/exitCode as flat string/int extras on the
 * result intent. It wraps them in a single Bundle extra named "result" (the same convention used by
 * Termux:Tasker / Termux:Widget / Termux:API), containing the keys "stdout", "stderr", "exitCode",
 * "err" and "errmsg". Reading flat extras (as an earlier version of this bridge did) always misses,
 * so every call silently fell back to the "not found" defaults -> exit code -1 with no output.
 */
class TermuxResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra("req_id", -1)
        if (id < 0) return

        val result = intent.getBundleExtra("result")
        if (result == null) {
            Log.w("SariTermux", "RUN_COMMAND result had no 'result' bundle for req $id")
            TermuxBridge.deliverResult(
                id,
                JSONObject().put("stdout", "").put("stderr", "Termux returned no result data for this command.")
                    .put("exitCode", -1).put("ok", false)
            )
            return
        }

        val stdout = result.getString("stdout").orEmpty()
        val stderr = result.getString("stderr").orEmpty()
        val exitCode = if (result.containsKey("exitCode")) result.getInt("exitCode") else -1
        val err = if (result.containsKey("err")) result.getInt("err") else 0
        val errmsg = result.getString("errmsg").orEmpty()

        val combinedStderr = when {
            err != 0 && errmsg.isNotBlank() -> if (stderr.isBlank()) errmsg else "$stderr\n$errmsg"
            else -> stderr
        }

        TermuxBridge.deliverResult(
            id,
            JSONObject()
                .put("stdout", stdout)
                .put("stderr", combinedStderr)
                .put("exitCode", exitCode)
                .put("ok", err == 0 && exitCode == 0)
        )
    }
}
