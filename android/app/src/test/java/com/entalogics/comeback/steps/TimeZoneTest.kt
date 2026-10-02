package com.entalogics.comeback.steps

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.TimeZone

/** The engine must cut days at the phone's current midnight, even if the time zone changes while the process is alive. */
class TimeZoneTest {
    private val tokyo = TimeZone.getTimeZone("Asia/Tokyo")      // UTC+9
    private val la = TimeZone.getTimeZone("America/Los_Angeles") // UTC-7 in October

    @Test fun dayKeyFollowsAZoneProvider() {
        var z: TimeZone = Sim.UTC
        val e = StepEngine(Strictness.BALANCED) { z }
        val ts = Sim.at(22, 0)                                    // 2 Oct 22:00 UTC
        assertEquals("2026-10-02", e.dayKey(ts))
        z = tokyo
        assertEquals("2026-10-03", e.dayKey(ts))
        z = la
        assertEquals("2026-10-02", e.dayKey(ts))
    }

    @Test fun defaultConstructorReadsTheDefaultZoneOnEveryUse() {
        val saved = TimeZone.getDefault()
        try {
            TimeZone.setDefault(Sim.UTC)
            val e = StepEngine()                                  // built before the zone changes
            val ts = Sim.at(22, 0)
            assertEquals("2026-10-02", e.dayKey(ts))
            TimeZone.setDefault(tokyo)
            assertEquals("2026-10-03", e.dayKey(ts))
        } finally { TimeZone.setDefault(saved) }
    }

    @Test fun hourlyBucketsFollowTheZoneToo() {
        var z: TimeZone = Sim.UTC
        val e = StepEngine(Strictness.BALANCED) { z }
        e.source = CountSource.DETECTOR
        z = tokyo
        val t0 = Sim.at(22, 0)                                    // 07:00 on the 3rd in Tokyo
        val steps = Sim.walk(t0, 40, 1.8, 0.04, java.util.Random(7))
        for (t in steps) e.onDetectorStep(t)
        e.tick(steps.last() + 200_000)
        val d = e.view(steps.last() + 200_000)["2026-10-03"]!!
        assertEquals(true, d.steps > 20)
        assertEquals(d.steps, d.hourly[7])
    }

    @Test fun existingConstructorWithAZoneStillWorks() {
        val e = StepEngine(Strictness.BALANCED, tokyo)
        assertEquals("2026-10-03", e.dayKey(Sim.at(22, 0)))
    }
}
