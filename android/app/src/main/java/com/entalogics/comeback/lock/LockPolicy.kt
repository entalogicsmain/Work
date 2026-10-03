package com.entalogics.comeback.lock

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt

/**
 * The pure rules of the app lock, kept apart from Android so they can be unit tested. The page (www/js/lock.js) applies the same
 * rules in JavaScript; test/theme-lock-test.mjs and LockPolicyTest.kt check the same table of cases.
 *
 * The lock settings live in Capacitor Preferences (SharedPreferences group "CapacitorStorage"), on this phone only: they are not part of the
 * synced settings, the JSON backup or the Android backup (allowBackup is off).
 */
object LockPolicy {
    const val PREFS_GROUP = "CapacitorStorage"
    const val KEY_LOCK = "comeback_lock"
    const val KEY_DELAY = "comeback_lock_delay"
    const val KEY_LAST_ACTIVE = "comeback_last_active"

    /** Minutes the app may stay away before it locks again: 0 = Immediately. */
    val DELAYS_MIN = listOf(0, 1, 5)
    const val DEFAULT_DELAY_MIN = 1

    /**
     * Strong or weak biometrics, or the phone's own PIN, pattern or password. BIOMETRIC_WEAK | DEVICE_CREDENTIAL works from API 21 up (the
     * androidx.biometric library falls back to the device-credential screen on API 23 to 29 by itself), so one code path covers minSdk 23.
     * (DEVICE_CREDENTIAL alone, or BIOMETRIC_STRONG | DEVICE_CREDENTIAL, would not work before API 30.)
     */
    const val AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL

    fun isEnabled(raw: String?): Boolean = raw == "1"

    /** The stored "Lock after" value in minutes; anything unknown becomes the default. */
    fun delayMinutes(raw: String?): Int {
        val n = raw?.trim()?.toIntOrNull()
        return if (n != null && n in DELAYS_MIN) n else DEFAULT_DELAY_MIN
    }

    fun delayMs(raw: String?): Long = delayMinutes(raw) * 60_000L

    /**
     * Should the lock screen be shown when the app comes back? Yes when the lock is on and either it never recorded when the app was last in use,
     * or the clock went backwards, or the app has been away for at least the chosen time. "Immediately" (0) always locks.
     */
    fun shouldLock(enabled: Boolean, lastActiveMs: Long?, nowMs: Long, delayMs: Long): Boolean {
        if (!enabled) return false
        if (lastActiveMs == null || lastActiveMs <= 0L) return true
        if (nowMs < lastActiveMs) return true
        return nowMs - lastActiveMs >= delayMs
    }

    /** BiometricManager.canAuthenticate() result -> the word the page gets. */
    fun reasonFor(status: Int): String = when (status) {
        BiometricManager.BIOMETRIC_SUCCESS -> "ok"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none_enrolled"
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "no_hardware"
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "hw_unavailable"
        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "update_required"
        BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED -> "unsupported"
        else -> "unknown"
    }

    /** BiometricPrompt error code -> "canceled" (the person backed out), "lockout" (too many tries), "unavailable" (no screen lock or sensor) or "failed". */
    fun errorFor(code: Int): String = when (code) {
        BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "canceled"
        BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
        BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_HW_NOT_PRESENT, BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL, BiometricPrompt.ERROR_HW_UNAVAILABLE -> "unavailable"
        else -> "failed"
    }
}
