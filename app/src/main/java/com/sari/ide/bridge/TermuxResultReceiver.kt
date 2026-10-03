package com.sari.ide.bridge

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import org.json.JSONObject

/**
 * Receives the result PendingIntent callback from Termux RUN_COMMAND.
 *
 * Termux sends the command result inside one Bundle extra named "result".
 */
class TermuxResultReceiver : Service() {

    companion object {
        private const val TAG = "SariTermux"
        private const val EXTRA_REQUEST_ID = "req_id"
        private const val EXTRA_RESULT = "result"
        private const val EXTRA_STDOUT = "stdout"
        private const val EXTRA_STDERR = "stderr"
        private const val EXTRA_EXIT_CODE = "exitCode"
        private const val EXTRA_ERR = "err"
        private const val EXTRA_ERRMSG = "errmsg"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            if (intent == null) {
                Log.w(TAG, "RUN_COMMAND callback received with null intent")
                return START_NOT_STICKY
            }

            val requestId = intent.getIntExtra(EXTRA_REQUEST_ID, -1)
            if (requestId < 0) {
                Log.w(TAG, "RUN_COMMAND callback has invalid request id")
                return START_NOT_STICKY
            }

            val result: Bundle? = intent.getBundleExtra(EXTRA_RESULT)

            if (result == null) {
                Log.w(TAG, "RUN_COMMAND callback had no result bundle for req $requestId")
                TermuxBridge.deliverResult(
                    requestId,
                    JSONObject()
                        .put("stdout", "")
                        .put("stderr", "Termux returned no result data for this command.")
                        .put("exitCode", -1)
                        .put("ok", false)
                )
                return START_NOT_STICKY
            }

            val stdout = result.getString(EXTRA_STDOUT).orEmpty()
            val stderr = result.getString(EXTRA_STDERR).orEmpty()
            val exitCode = if (result.containsKey(EXTRA_EXIT_CODE)) {
                result.getInt(EXTRA_EXIT_CODE)
            } else {
                -1
            }

            val err = if (result.containsKey(EXTRA_ERR)) {
                result.getInt(EXTRA_ERR)
            } else {
                0
            }

            val errmsg = result.getString(EXTRA_ERRMSG).orEmpty()

            val finalStderr = when {
                err != 0 && errmsg.isNotBlank() ->
                    if (stderr.isBlank()) errmsg else "$stderr\n$errmsg"
                else ->
                    stderr
            }

            TermuxBridge.deliverResult(
                requestId,
                JSONObject()
                    .put("stdout", stdout)
                    .put("stderr", finalStderr)
                    .put("exitCode", exitCode)
                    .put("ok", err == 0 && exitCode == 0)
            )

        } catch (e: Exception) {
            Log.e(TAG, "Failed to process Termux result callback", e)

            try {
                val requestId = intent?.getIntExtra(EXTRA_REQUEST_ID, -1) ?: -1
                if (requestId >= 0) {
                    TermuxBridge.deliverResult(
                        requestId,
                        JSONObject()
                            .put("stdout", "")
                            .put("stderr", "Failed to process Termux result: ${e.message}")
                            .put("exitCode", -1)
                            .put("ok", false)
                    )
                }
            } catch (_: Exception) {
            }
        } finally {
            stopSelf(startId)
        }

        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
