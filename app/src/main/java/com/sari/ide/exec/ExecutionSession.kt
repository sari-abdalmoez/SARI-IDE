package com.sari.ide.exec

import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

enum class SessionStatus { PENDING, COMPILING, RUNNING, COMPLETED, FAILED, CANCELLED }

/**
 * Represents one isolated execution session. Each file run produces a new session with a unique ID.
 * Output from an expired session is dropped so it can never contaminate the next session's console.
 */
data class ExecutionSession(
    val sessionId: Long,
    val project: String,
    val filePath: String,
    val language: String,
    val workDir: File,
    val startTime: Long = System.currentTimeMillis()
) {
    @Volatile var status: SessionStatus = SessionStatus.PENDING
    @Volatile var exitCode: Int? = null
    @Volatile var process: Process? = null
    val cancelled = AtomicBoolean(false)

    val isActive get() = status == SessionStatus.RUNNING || status == SessionStatus.COMPILING
    val isDone get() = status == SessionStatus.COMPLETED || status == SessionStatus.FAILED || status == SessionStatus.CANCELLED

    fun cancel() {
        cancelled.set(true)
        process?.destroy()
        status = SessionStatus.CANCELLED
    }
}
