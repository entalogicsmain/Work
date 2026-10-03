package com.entalogics.comeback.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import java.util.TimeZone

class WidgetModelTest {
    private val us = Locale.US
    private val today = "2026-10-03"
    private fun snap(score: Int? = 62, label: String? = "12-day streak", steps: Int = 5200, target: Int = 8000, open: String? = "Water", date: String = today) =
        Snapshot(date, score, label, steps, target, open, 1_700_000_000_000L)

    // ---------- parsing ----------

    @Test fun parsesAFullSnapshot() {
        val s = WidgetModel.parse("""{"date":"2026-10-03","score":62,"label":"12-day streak","steps":5200,"stepsTarget":8000,"openHabit":"Water","updatedAt":1700000000000}""")
        assertNotNull(s)
        assertEquals(snap(), s)
    }

    @Test fun nullsAndMissingFieldsAreKept() {
        val s = WidgetModel.parse("""{"date":"2026-10-03","score":null,"label":null,"steps":0,"stepsTarget":0,"openHabit":null}""")!!
        assertNull(s.score); assertNull(s.label); assertNull(s.openHabit)
        assertEquals(0, s.steps); assertEquals(0L, s.updatedAt)
        assertNull(WidgetModel.parse("""{"date":"2026-10-03"}""")!!.score)
    }

    @Test fun rejectsBadInput() {
        assertNull(WidgetModel.parse(null))
        assertNull(WidgetModel.parse(""))
        assertNull(WidgetModel.parse("not json"))
        assertNull(WidgetModel.parse("""{"score":10}"""))
        assertNull(WidgetModel.parse("""{"date":"3 Oct 2026","score":10}"""))
    }

    @Test fun numbersAreClampedAndRounded() {
        val s = WidgetModel.parse("""{"date":"2026-10-03","score":140.6,"steps":-5,"stepsTarget":8000.4}""")!!
        assertEquals(100, s.score); assertEquals(0, s.steps); assertEquals(8000, s.stepsTarget)
        assertEquals(0, WidgetModel.parse("""{"date":"2026-10-03","score":-3}""")!!.score)
        assertEquals(63, WidgetModel.parse("""{"date":"2026-10-03","score":62.5}""")!!.score)
    }

    @Test fun textIsCleanedAndShortened() {
        assertEquals("Water", WidgetModel.clean("  Water \n"))
        assertEquals("Morning walk", WidgetModel.clean("Morning\u0000   walk"))
        assertNull(WidgetModel.clean("   "))
        assertNull(WidgetModel.clean(null))
        assertEquals(WidgetModel.MAX_TEXT, WidgetModel.clean("x".repeat(200))!!.length)
    }

    @Test fun jsonRoundTrips() {
        for (s in listOf(snap(), snap(score = null, label = "Rest day", open = null), snap(score = 100, label = null))) {
            assertEquals(s, WidgetModel.parse(WidgetModel.toJson(s)))
        }
    }

    // ---------- days ----------

    @Test fun dayKeyUsesTheGivenZone() {
        val utc = TimeZone.getTimeZone("UTC"); val tokyo = TimeZone.getTimeZone("Asia/Tokyo")
        val t = 1_790_000_000_000L   // 2026-09-21T14:13:20Z
        assertEquals("2026-09-21", WidgetModel.dayKey(t, utc))
        assertEquals("2026-09-21", WidgetModel.dayKey(t, tokyo))
        assertEquals("2026-09-22", WidgetModel.dayKey(t + 3_600_000L, tokyo))   // past midnight in Tokyo, not yet in UTC
        assertEquals("2026-09-21", WidgetModel.dayKey(t + 3_600_000L, utc))
    }

    @Test fun stalenessIsADayComparison() {
        assertFalse(WidgetModel.isStale("2026-10-03", "2026-10-03"))
        assertTrue(WidgetModel.isStale("2026-10-02", "2026-10-03"))
        assertTrue(WidgetModel.isStale("2026-10-04", "2026-10-03"))   // a clock set back also counts as not today
    }

    // ---------- text ----------

    @Test fun percentText() {
        assertEquals("62%", WidgetModel.percentText(62))
        assertEquals("0%", WidgetModel.percentText(0))
        assertEquals("100%", WidgetModel.percentText(250))
        assertEquals("", WidgetModel.percentText(null))
    }

    @Test fun stepsTextHasThousandsSeparators() {
        assertEquals("5,200 / 8,000", WidgetModel.stepsText(5200, 8000, us))
        assertEquals("0 / 8,000", WidgetModel.stepsText(0, 8000, us))
        assertEquals("12,345 / 10,000", WidgetModel.stepsText(12345, 10000, us))
        assertEquals("999 / 1,000", WidgetModel.stepsText(999, 1000, us))
        assertEquals("5,200", WidgetModel.stepsText(5200, 0, us))
    }

    // ---------- the state the widget shows ----------

    @Test fun aNormalDay() {
        val st = WidgetModel.resolve(snap(), null, today, locale = us)
        assertEquals("62%", st.centerText)
        assertEquals(0.62f, st.fraction, 0.0001f)
        assertFalse(st.done); assertFalse(st.stale)
        assertEquals("5,200 / 8,000", st.stepsShort)
        assertEquals("5,200 / 8,000 steps", st.stepsLong)
        assertEquals("12-day streak", st.note)
        assertEquals("Next: Water", st.nextLine)
        assertEquals("Comeback. Today 62 percent. 5,200 of 8,000 steps. 12-day streak. Next: Water. Tap to open Comeback.", st.description)
    }

    @Test fun aFullDayIsDone() {
        val st = WidgetModel.resolve(snap(score = 100, open = null, steps = 8200), null, today, locale = us)
        assertTrue(st.done); assertEquals(1f, st.fraction, 0.0001f)
        assertNull(st.nextLine)
    }

    @Test fun restAndLightDaysHaveNoScore() {
        val rest = WidgetModel.resolve(snap(score = null, label = "Rest day", open = null), null, today, locale = us)
        assertEquals("Rest", rest.centerText); assertEquals(0f, rest.fraction, 0f); assertEquals("Rest day", rest.note)
        assertTrue(rest.description.contains("Rest day"))
        assertFalse(rest.description.contains("percent"))
        val light = WidgetModel.resolve(snap(score = null, label = "Light day", open = null), null, today, locale = us)
        assertEquals("Light", light.centerText); assertEquals("Light day", light.note)
    }

    @Test fun noStreakGetsAGentleLine() {
        val st = WidgetModel.resolve(snap(label = null), null, today, locale = us)
        assertEquals("A fresh start today", st.note)
    }

    @Test fun anEmptyDayStillShowsTheRing() {
        val st = WidgetModel.resolve(snap(score = 0, steps = 0, open = "Steps"), null, today, locale = us)
        assertEquals("0%", st.centerText); assertEquals(0f, st.fraction, 0f); assertEquals("0 / 8,000", st.stepsShort)
    }

    @Test fun nativeStepsWinOverTheSnapshotOnTheSameDay() {
        val st = WidgetModel.resolve(snap(steps = 5200), 6100, today, locale = us)
        assertEquals("6,100 / 8,000", st.stepsShort)
        assertEquals("62%", st.centerText)   // the score only moves when the page sends a new snapshot
    }

    @Test fun anOldSnapshotAsksToOpenTheApp() {
        val st = WidgetModel.resolve(snap(date = "2026-10-02"), 1234, today, locale = us)
        assertTrue(st.stale)
        assertEquals("Open Comeback to start today", st.note)
        assertEquals("–", st.centerText); assertEquals(0f, st.fraction, 0f)
        assertEquals("1,234 / 8,000", st.stepsShort)   // steps come from the phone only; the target is the last one known
        assertNull(st.nextLine)
        assertFalse(st.description.contains("percent"))
        assertTrue(st.description.contains("Open Comeback to start today"))
    }

    @Test fun anOldSnapshotWithoutStepCountingHidesSteps() {
        val st = WidgetModel.resolve(snap(date = "2026-10-02"), null, today, locale = us)
        assertNull(st.stepsShort); assertNull(st.stepsLong)
    }

    @Test fun noSnapshotAtAll() {
        val st = WidgetModel.resolve(null, 300, today, locale = us)
        assertTrue(st.stale)
        assertEquals("Open Comeback to set up", st.note)
        assertEquals("300", st.stepsShort)
        assertNull(WidgetModel.resolve(null, null, today, locale = us).stepsShort)
    }

    @Test fun noStepsHabitAndNoStepsHidesTheStepsLine() {
        val st = WidgetModel.resolve(snap(steps = 0, target = 0), null, today, locale = us)
        assertNull(st.stepsShort)
        assertEquals("300", WidgetModel.resolve(snap(steps = 0, target = 0), 300, today, locale = us).stepsShort)
    }

    @Test fun aClockTimeIsNeverShown() {
        val clock = Regex("\\b\\d{1,2}:\\d{2}\\b|\\b(am|pm|AM|PM)\\b")
        for (st in listOf(
            WidgetModel.resolve(snap(), 6100, today, locale = us),
            WidgetModel.resolve(snap(score = null, label = "Light day"), null, today, locale = us),
            WidgetModel.resolve(snap(date = "2026-10-01"), 10, today, locale = us),
            WidgetModel.resolve(null, null, today, locale = us)
        )) {
            val all = listOfNotNull(st.centerText, st.stepsShort, st.stepsLong, st.note, st.nextLine, st.description).joinToString(" | ")
            assertFalse(all, clock.containsMatchIn(all))
        }
    }

    @Test fun layoutChoiceFollowsWidth() {
        assertFalse(WidgetModel.isWide(110)); assertFalse(WidgetModel.isWide(146))
        assertTrue(WidgetModel.isWide(WidgetModel.WIDE_MIN_DP)); assertTrue(WidgetModel.isWide(250))
    }

    // ---------- ring geometry ----------

    @Test fun sweepAngle() {
        assertEquals(0f, WidgetModel.sweepFor(0f), 0f)
        assertEquals(180f, WidgetModel.sweepFor(0.5f), 0.001f)
        assertEquals(360f, WidgetModel.sweepFor(1f), 0.001f)
        assertEquals(360f, WidgetModel.sweepFor(3f), 0.001f)       // clamped
        assertEquals(0f, WidgetModel.sweepFor(-1f), 0f)
        assertEquals(WidgetModel.MIN_SWEEP, WidgetModel.sweepFor(0.01f), 0f)   // a little progress is still visible
        assertEquals(223.2f, WidgetModel.sweepFor(WidgetModel.fractionOf(62)), 0.01f)
        assertEquals(-90f, WidgetModel.ARC_START, 0f)             // starts at the top, like the ring in the app
    }

    @Test fun fractionFromScore() {
        assertEquals(0f, WidgetModel.fractionOf(null), 0f)
        assertEquals(1f, WidgetModel.fractionOf(100), 0f)
        assertEquals(1f, WidgetModel.fractionOf(180), 0f)
        assertEquals(0f, WidgetModel.fractionOf(-5), 0f)
    }

    @Test fun arcStrokeIsCentredInsideTheBitmap() {
        val size = 256f
        val inset = WidgetModel.arcInset(size)
        val stroke = size * WidgetModel.STROKE_RATIO
        assertEquals(stroke / 2f, inset, 0.0001f)
        assertEquals(0f, size / 2f - (size / 2f - inset) - stroke / 2f, 0.0001f)   // outer edge of the stroke touches the bitmap edge
        assertTrue(inset * 2 < size)
    }
}
