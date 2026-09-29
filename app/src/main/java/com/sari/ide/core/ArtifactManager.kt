package com.sari.ide.core

import java.io.File
import java.util.zip.ZipInputStream

object ArtifactManager {
    /** Extracts a GitHub Actions artifact zip into [destDir] and returns the paths of any .apk files found. */
    fun extractZip(bytes: ByteArray, destDir: File): List<File> {
        destDir.mkdirs()
        val apks = mutableListOf<File>()
        ZipInputStream(bytes.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val outFile = File(destDir, entry.name).canonicalFile
                require(outFile.path.startsWith(destDir.canonicalFile.path + File.separator) || outFile == destDir) { "Unsafe zip entry" }
                if (entry.isDirectory) {
                    outFile.mkdirs()
                } else {
                    outFile.parentFile?.mkdirs()
                    outFile.outputStream().use { fos -> zis.copyTo(fos) }
                    if (outFile.name.endsWith(".apk")) apks.add(outFile)
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
        return apks
    }
}
