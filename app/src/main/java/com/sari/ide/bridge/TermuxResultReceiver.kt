package com.sari.ide.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/** Receives the callback Termux fires after a RUN_COMMAND finishes in the background. */
class TermuxResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra("req_id", -1)
        if (id < 0) return
        val stdout = intent.getStringExtra("com.termux.RUN_COMMAND_RESULT_STDOUT") ?: ""
        val stderr = intent.getStringExtra("com.termux.RUN_COMMAND_RESULT_STDERR") ?: ""
        val exit = intent.getIntExtra("com.termux.RUN_COMMAND_RESULT_EXIT_CODE", -1)
        val errmsg = intent.getStringExtra("com.termux.RUN_COMMAND_RESULT_ERRMSG")
        val result = JSONObject()
            .put("stdout", stdout)
            .put("stderr", if (errmsg.isNullOrBlank()) stderr else "$stderr\n$errmsg")
            .put("exitCode", exit)
            .put("ok", exit == 0)
        TermuxBridge.deliverResult(id, result)
    }
}
