package com.entalogics.comeback.steps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyMigrationTest {
    @Test fun oldKeysMoveToNewFileAndAreRemoved() {
        val old = mutableMapOf<String, Any?>("engine" to "{\"days\":1}", "config" to "{\"enabled\":true}", "heartbeat" to 123L)
        val new = mutableMapOf<String, Any?>()
        assertEquals(3, LegacyMigration.move(old, new))
        assertTrue(old.isEmpty())
        assertEquals("{\"days\":1}", new["engine"])
        assertEquals(123L, new["heartbeat"])
    }

    @Test fun runningTwiceIsSafe() {
        val old = mutableMapOf<String, Any?>("engine" to "a", "heartbeat" to 5L)
        val new = mutableMapOf<String, Any?>()
        LegacyMigration.move(old, new)
        assertEquals(0, LegacyMigration.move(old, new))   // nothing left to move
        assertEquals("a", new["engine"])
    }

    @Test fun existingNewValueIsNeverOverwritten() {
        val old = mutableMapOf<String, Any?>("engine" to "old", "config" to "same")
        val new = mutableMapOf<String, Any?>("engine" to "new", "config" to "same")
        assertEquals(0, LegacyMigration.move(old, new))
        assertEquals("new", new["engine"])                // new data wins
        assertEquals(mapOf<String, Any?>("engine" to "old"), old)   // conflicting old value is kept, identical one is dropped
    }
}
