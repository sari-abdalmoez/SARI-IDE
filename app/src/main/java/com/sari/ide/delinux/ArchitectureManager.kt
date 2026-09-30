package com.sari.ide.delinux

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** Detects device ABI, API level, and selects compatible runtime download targets. */
object ArchitectureManager {

    fun primaryAbi(): String = Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"
    fun supportedAbis(): Array<String> = Build.SUPPORTED_ABIS
    fun apiLevel(): Int = Build.VERSION.SDK_INT
    fun is64Bit(): Boolean = primaryAbi().contains("64")

    /** Target triple used in Android NDK / toolchain names. */
    fun targetTriple(): String = when {
        primaryAbi().startsWith("arm64") -> "aarch64-linux-android"
        primaryAbi().startsWith("armeabi") -> "armv7a-linux-androideabi"
        primaryAbi() == "x86_64" -> "x86_64-linux-android"
        primaryAbi() == "x86" -> "i686-linux-android"
        else -> "unknown"
    }

    /** Short ABI tag used in package/asset naming. */
    fun abiTag(): String = when {
        primaryAbi().startsWith("arm64") -> "arm64"
        primaryAbi().startsWith("armeabi") -> "arm"
        primaryAbi() == "x86_64" -> "x86_64"
        primaryAbi() == "x86" -> "x86"
        else -> "unknown"
    }

    /** Returns whether a given ABI string is supported on this device. */
    fun isCompatible(abi: String): Boolean = abi in Build.SUPPORTED_ABIS

    fun info(): JSONObject = JSONObject()
        .put("primaryAbi", primaryAbi())
        .put("abiTag", abiTag())
        .put("targetTriple", targetTriple())
        .put("apiLevel", apiLevel())
        .put("is64Bit", is64Bit())
        .put("supportedAbis", JSONArray(Build.SUPPORTED_ABIS.toList()))
}
