package com.sari.ide.bridge

/** Implemented by the hosting Activity for actions the bridge can't do from a plain Context. */
interface SystemActions {
    fun hasSharedStorageAccess(): Boolean
    fun openAllFilesAccessSettings()
    /** Requests com.termux.permission.RUN_COMMAND at runtime if not already granted; returns whether it ends up granted. */
    suspend fun ensureTermuxPermission(): Boolean
}
