package com.sari.ide.bridge

/** Implemented by the hosting Activity for actions the bridge can't do from a plain Context. */
interface SystemActions {
    fun hasSharedStorageAccess(): Boolean
    fun openAllFilesAccessSettings()
}
