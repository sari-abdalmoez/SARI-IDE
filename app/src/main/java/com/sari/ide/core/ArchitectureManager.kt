package com.sari.ide.core

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * Real device-architecture detection used to decide which De Linux components can run, and to
 * avoid ever reporting a package/runtime as usable on an ABI it doesn't actually support.
 */
object ArchitectureManager {
    fun supportedAbis(): List<String> = Build.SUPPORTED_ABIS.toList()

    fun primaryAbi(): String = Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"

    fun is64Bit(): Boolean = primaryAbi().contains("64")

    fun apiLevel(): Int = Build.VERSION.SDK_INT

    /** The two ABIs SARI IDE actually ships native components for (see app/build.gradle.kts ndk.abiFilters). */
    private val shippedAbis = setOf("arm64-v8a", "armeabi-v7a")

    fun isDeviceSupported(): Boolean = Build.SUPPORTED_ABIS.any { it in shippedAbis }

    fun info(): JSONObject = JSONObject()
        .put("primaryAbi", primaryAbi())
        .put("supportedAbis", JSONArray(supportedAbis()))
        .put("apiLevel", apiLevel())
        .put("is64Bit", is64Bit())
        .put("deviceSupported", isDeviceSupported())
        .put("shippedAbis", JSONArray(shippedAbis.toList()))
}
