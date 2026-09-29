package com.sari.ide.bridge

import android.net.Uri

/** Implemented by the hosting Activity so the bridge can launch Storage Access Framework pickers and await the result. */
interface DocumentPicker {
    suspend fun pickFiles(): List<Uri>
    suspend fun pickFolder(): Uri?
}
