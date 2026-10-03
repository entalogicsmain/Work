package com.entalogics.comeback.lock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The delay rules of the app lock. test/theme-lock-test.mjs runs the same table against the JavaScript copy in www/js/lock.js. */
class LockPolicyTest {
    private val minute = 60_000L
    private val t0 = 1_800_000_000_000L

    @Test fun offNeverLocks() {
        assertFalse(LockPolicy.shouldLock(false, null, t0, 0))
        assertFalse(LockPolicy.shouldLock(false, t0 - 10 * minute, t0, minute))
    }

    @Test fun immediatelyAlwaysLocks() {
        assertTrue(LockPolicy.shouldLock(true, t0, t0, 0))
        assertTrue(LockPolicy.shouldLock(true, t0 - 1, t0, 0))
    }

    @Test fun oneMinuteLocksOnlyAfterAMinute() {
        val d = LockPolicy.delayMs("1")
        assertEquals(minute, d)
        assertFalse(LockPolicy.shouldLock(true, t0 - 59_999, t0, d))
        assertTrue(LockPolicy.shouldLock(true, t0 - 60_000, t0, d))
        assertTrue(LockPolicy.shouldLock(true, t0 - 61_000, t0, d))
    }

    @Test fun fiveMinutes() {
        val d = LockPolicy.delayMs("5")
        assertEquals(5 * minute, d)
        assertFalse(LockPolicy.shouldLock(true, t0 - 4 * minute, t0, d))
        assertTrue(LockPolicy.shouldLock(true, t0 - 5 * minute, t0, d))
    }

    @Test fun neverRecordedOrClockWentBackwardsLocks() {
        val d = LockPolicy.delayMs("5")
        assertTrue(LockPolicy.shouldLock(true, null, t0, d))
        assertTrue(LockPolicy.shouldLock(true, 0L, t0, d))
        assertTrue(LockPolicy.shouldLock(true, t0 + 1, t0, d))
    }

    @Test fun unknownDelayFallsBackToOneMinute() {
        assertEquals(1, LockPolicy.delayMinutes(null))
        assertEquals(1, LockPolicy.delayMinutes(""))
        assertEquals(1, LockPolicy.delayMinutes("abc"))
        assertEquals(1, LockPolicy.delayMinutes("7"))
        assertEquals(1, LockPolicy.delayMinutes("-5"))
        assertEquals(0, LockPolicy.delayMinutes("0"))
        assertEquals(0, LockPolicy.delayMinutes(" 0 "))
        assertEquals(5, LockPolicy.delayMinutes("5"))
    }

    @Test fun onlyAOneEnablesTheLock() {
        assertTrue(LockPolicy.isEnabled("1"))
        assertFalse(LockPolicy.isEnabled("0"))
        assertFalse(LockPolicy.isEnabled(null))
        assertFalse(LockPolicy.isEnabled("true"))
    }

    @Test fun errorsAreMappedToGentleWords() {
        assertEquals("canceled", LockPolicy.errorFor(androidx.biometric.BiometricPrompt.ERROR_USER_CANCELED))
        assertEquals("canceled", LockPolicy.errorFor(androidx.biometric.BiometricPrompt.ERROR_NEGATIVE_BUTTON))
        assertEquals("lockout", LockPolicy.errorFor(androidx.biometric.BiometricPrompt.ERROR_LOCKOUT))
        assertEquals("unavailable", LockPolicy.errorFor(androidx.biometric.BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL))
        assertEquals("failed", LockPolicy.errorFor(androidx.biometric.BiometricPrompt.ERROR_TIMEOUT))
    }

    @Test fun availabilityReasons() {
        assertEquals("ok", LockPolicy.reasonFor(androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS))
        assertEquals("none_enrolled", LockPolicy.reasonFor(androidx.biometric.BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED))
        assertEquals("hw_unavailable", LockPolicy.reasonFor(androidx.biometric.BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE))
        assertEquals("unknown", LockPolicy.reasonFor(12345))
    }
}
