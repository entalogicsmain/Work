package com.umar.resetlog.steps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

/** Simulated sensor data: no phone needed. See README for what still has to be checked on a real phone. */
class StepEngineTest {
    private val r get() = Random(42)
    private fun near(expected: Int, actual: Int, pct: Double) = assertTrue("expected ~$expected (+-${(pct * 100).toInt()}%) but was $actual", Math.abs(actual - expected) <= expected * pct)

    // ---------- walking is counted ----------
    @Test fun normalWalkingCounterPlusDetector_countsEveryStep() {
        val e = Sim.engine()
        val ts = Sim.walk(Sim.at(8, 0), 500, 1.9, 0.07, r)
        Sim.counterPerStep(e, ts, 10_000)
        Sim.finish(e, ts.last())
        assertEquals(500, Sim.total(e))
    }

    @Test fun normalWalkingCounterOnly_countsEveryStep() {
        val e = Sim.engine()
        val ts = Sim.walk(Sim.at(8, 0), 400, 1.7, 0.08, r)
        var total = 5000L
        e.onCounterReading(ts.first() - 1000, total)
        for (t in ts) { total++; e.onCounterReading(t, total); if (t % 5000 < 40) e.tick(t) }
        Sim.finish(e, ts.last())
        assertEquals(400, Sim.total(e))
    }

    @Test fun walkingWithBatchedCounterReports_countsEverything() {
        val e = Sim.engine()
        val ts = Sim.walk(Sim.at(8, 0), 600, 1.8, 0.06, r)
        Sim.counterBatched(e, ts, 100, 10_000)
        Sim.finish(e, ts.last() + 20_000)
        near(600, Sim.total(e), 0.02)
    }

    @Test fun stepDetectorOnlyPhone_countsWalking() {
        val e = Sim.engine(source = CountSource.DETECTOR)
        val ts = Sim.walk(Sim.at(8, 0), 300, 2.0, 0.07, r)
        Sim.detector(e, ts)
        Sim.finish(e, ts.last())
        assertEquals(300, Sim.total(e))
    }

    @Test fun runningCadence_isCounted() {
        val e = Sim.engine()
        val ts = Sim.walk(Sim.at(8, 0), 600, 2.9, 0.04, r)
        Sim.counterPerStep(e, ts, 0)
        Sim.finish(e, ts.last())
        assertEquals(600, Sim.total(e))
    }

    // ---------- hourly buckets and day split ----------
    @Test fun hourlyBuckets_followTheClock() {
        val e = Sim.engine()
        val a = Sim.walk(Sim.at(9, 30), 200, 1.8, 0.05, r); val b = Sim.walk(Sim.at(17, 10), 150, 1.8, 0.05, r)
        var tot = Sim.counterPerStep(e, a, 0); Sim.counterPerStep(e, b, tot)
        Sim.finish(e, b.last())
        val d = e.days["2026-10-02"]!!
        assertEquals(200, d.hourly[9] + d.hourly[10]); assertEquals(150, d.hourly[17] + d.hourly[18])
        assertEquals(350, d.steps)
    }

    @Test fun midnightSplit_dividesStepsByTime() {
        val e = Sim.engine()
        // one steady walk from 23:57:00 to 00:03:00 (6 minutes at 2 steps/s = 720 steps), counter reports every 10 s
        val start = Sim.at(23, 57); val ts = (1..720).map { start + it * 500L }
        Sim.counterBatched(e, ts, 0, 10_000)
        Sim.finish(e, ts.last() + 20_000)
        val d1 = e.days["2026-10-02"]!!.steps; val d2 = e.days["2026-10-03"]!!.steps
        near(360, d1, 0.03); near(360, d2, 0.03)
        assertEquals(720, d1 + d2 + 0 * 1) // nothing lost
    }

    // ---------- reboot, missed samples ----------
    @Test fun rebootResetsBaseline_andKeepsCounting() {
        val e = Sim.engine()
        val a = Sim.walk(Sim.at(8, 0), 200, 1.9, 0.06, r)
        val tot = Sim.counterPerStep(e, a, 50_000)
        assertEquals(50_200L, tot)
        // phone reboots: counter restarts from zero, user keeps walking
        val b = Sim.walk(Sim.at(8, 30), 150, 1.9, 0.06, r)
        Sim.counterPerStep(e, b, 0)
        Sim.finish(e, b.last())
        assertEquals(350, Sim.total(e))
    }

    @Test fun missedSamples_serviceDeadWhileWalking_stepsAreCaughtUp() {
        val e = Sim.engine()
        Sim.counterPerStep(e, Sim.walk(Sim.at(8, 0), 100, 1.8, 0.05, r), 1000)
        // service was killed for 10 minutes while the user walked 900 steps; the hardware counter kept counting
        e.onCounterReading(Sim.at(8, 12), 1000 + 100 + 900)
        Sim.finish(e, Sim.at(8, 12))
        near(1000, Sim.total(e), 0.02)
    }

    @Test fun missedSamples_serviceDeadWhileInCar_catchUpRespectsVehicleWindow() {
        val e = Sim.engine()
        e.onCounterReading(Sim.at(8, 0), 1000)
        e.onActivity(Sim.at(8, 5), ActivityType.IN_VEHICLE, true)
        e.onActivity(Sim.at(8, 55), ActivityType.WALKING, true)
        e.onCounterReading(Sim.at(9, 0), 1000 + 4000) // chip counted 4000 "steps" while driving
        Sim.finish(e, Sim.at(9, 0))
        assertTrue("catch-up kept ${Sim.total(e)} steps from a drive", Sim.total(e) < 400)
    }

    @Test fun tinyCatchUpDelta_isIsolatedAndDropped() {
        val e = Sim.engine()
        e.onCounterReading(Sim.at(8, 0), 1000); e.onCounterReading(Sim.at(8, 30), 1004)
        Sim.finish(e, Sim.at(8, 30)); assertEquals(0, Sim.total(e))
    }

    // ---------- vehicles are rejected ----------
    @Test fun carRideSmooth_counterSilent_zeroSteps() {
        val e = Sim.engine()
        e.onActivity(Sim.at(8, 0), ActivityType.IN_VEHICLE, true)
        // hardware counter does not move on a smooth road
        for (i in 0..60) e.onCounterReading(Sim.at(8, 0) + i * 10_000L, 2000)
        Sim.finish(e, Sim.at(8, 10)); assertEquals(0, Sim.total(e))
    }

    @Test fun carRide_chipFalseStepsBumpyRoad_rejectedEvenWithoutActivityRecognition() {
        val e = Sim.engine()
        val ts = Sim.bumpy(Sim.at(8, 0), 600_000, 700.0, r)
        Sim.counterPerStep(e, ts, 0)
        Sim.finish(e, ts.last())
        assertTrue("rhythm gate leaked ${Sim.total(e)} of ${ts.size} false steps", Sim.total(e) <= 12)
    }

    @Test fun motorbikeBumpyRoad_rejected_withAndWithoutActivityRecognition() {
        for (withActivity in listOf(false, true)) {
            val e = Sim.engine()
            val ts = Sim.bumpy(Sim.at(8, 0), 600_000, 450.0, Random(7))
            if (withActivity) e.onActivity(Sim.at(8, 1, 15), ActivityType.IN_VEHICLE, true)
            Sim.counterPerStep(e, ts, 0)
            Sim.finish(e, ts.last())
            assertTrue("motorbike (activity=$withActivity) counted ${Sim.total(e)} of ${ts.size}", Sim.total(e) <= 12)
        }
    }

    @Test fun bicycleRide_regularPedalling_rejectedWhenActivityRecognitionSeesIt() {
        val e = Sim.engine()
        val ts = Sim.regular(Sim.at(8, 0), 600_000, 1.3) // pedalling looks exactly like slow walking to a step chip
        var tot = 0L
        e.onCounterReading(ts.first() - 1000, 0)
        var told = false
        for (t in ts) {
            // Activity Recognition reports ON_BICYCLE about 60 s after the ride started
            if (!told && t >= Sim.at(8, 1)) { e.onActivity(Sim.at(8, 1), ActivityType.ON_BICYCLE, true); told = true }
            tot++; e.onDetectorStep(t); e.onCounterReading(t, tot); if (t % 5000 < 40) e.tick(t)
        }
        Sim.finish(e, ts.last())
        assertTrue("bicycle counted ${Sim.total(e)}", Sim.total(e) <= 10)
    }

    @Test fun lateVehicleDetection_cancelsStepsStillInHoldBack() {
        val e = Sim.engine()
        val ts = Sim.regular(Sim.at(8, 0), 50_000, 1.5)
        Sim.counterPerStep(e, ts, 0)
        e.tick(Sim.at(8, 0, 51))
        assertTrue("steps are visible while held back", e.today(Sim.at(8, 0, 51)).steps > 50)
        e.onActivity(Sim.at(8, 0, 52), ActivityType.IN_VEHICLE, true)
        assertEquals(0, e.today(Sim.at(8, 0, 52)).steps)
        Sim.finish(e, Sim.at(8, 5)); assertEquals(0, Sim.total(e))
    }

    // ---------- buffering ----------
    @Test fun shortShuffles_threeToFiveSteps_rejected() {
        val e = Sim.engine()
        val all = ArrayList<Long>()
        var start = Sim.at(8, 0)
        for (bout in listOf(3, 4, 5, 3, 5, 4)) { all.addAll(Sim.walk(start, bout, 1.8, 0.05, r)); start += 15_000 }
        Sim.counterPerStep(e, all, 0)
        Sim.finish(e, all.last())
        assertEquals(0, Sim.total(e))
        assertTrue("filtered count should show the discarded steps", Sim.filtered(e) >= 20)
    }

    @Test fun walkingTenStepsOrMore_isCountedFromTheFirstStep() {
        val e = Sim.engine()
        val ts = Sim.walk(Sim.at(8, 0), 12, 1.9, 0.05, r)
        Sim.counterPerStep(e, ts, 0)
        Sim.finish(e, ts.last()); assertEquals(12, Sim.total(e))
    }

    @Test fun vehicleThenWalking_countingResumesCorrectly() {
        val e = Sim.engine()
        val ride = Sim.bumpy(Sim.at(8, 0), 600_000, 500.0, Random(3))
        e.onActivity(Sim.at(8, 1, 20), ActivityType.IN_VEHICLE, true)
        var tot = Sim.counterPerStep(e, ride, 0)
        e.onActivity(Sim.at(8, 10, 30), ActivityType.IN_VEHICLE, false)
        e.onActivity(Sim.at(8, 10, 40), ActivityType.WALKING, true)
        val walk = Sim.walk(Sim.at(8, 11), 250, 1.9, 0.06, r)
        Sim.counterPerStep(e, walk, tot)
        Sim.finish(e, walk.last())
        assertEquals(250, Sim.total(e))
        assertFalse(e.inVehicle)
    }

    @Test fun stillAfterVehicle_alsoResumes() {
        val e = Sim.engine()
        e.onActivity(Sim.at(8, 0), ActivityType.IN_VEHICLE, true)
        assertTrue(e.inVehicle)
        e.onActivity(Sim.at(8, 20), ActivityType.STILL, true)
        assertFalse(e.inVehicle)
    }

    // ---------- speed check ----------
    @Test fun speedCheck_fastWindowIsDiscarded_walkingAfterwardsCounts() {
        val e = Sim.engine()
        val drive = Sim.regular(Sim.at(8, 0), 120_000, 1.4)
        var tot = 0L
        e.onCounterReading(drive.first() - 1000, 0)
        for (t in drive) { tot++; e.onCounterReading(t, tot); e.onSpeed(t, 42.0) }
        e.onSpeed(Sim.at(8, 2, 5), 3.0)
        val walk = Sim.walk(Sim.at(8, 3), 100, 1.9, 0.05, r)
        for (t in walk) { tot++; e.onCounterReading(t, tot); e.onSpeed(t, 5.0); if (t % 5000 < 40) e.tick(t) }
        Sim.finish(e, walk.last())
        assertTrue("counted ${Sim.total(e)}", Sim.total(e) in 100..112)
    }

    // ---------- strictness ----------
    @Test fun strictnessChangesHowMuchWalkingIsNeeded() {
        val seven = Sim.walk(Sim.at(8, 0), 7, 1.9, 0.04, r)
        val relaxed = Sim.engine(Strictness.RELAXED); Sim.counterPerStep(relaxed, seven, 0); Sim.finish(relaxed, seven.last())
        val balanced = Sim.engine(Strictness.BALANCED); Sim.counterPerStep(balanced, seven, 0); Sim.finish(balanced, seven.last())
        assertEquals(7, Sim.total(relaxed)); assertEquals(0, Sim.total(balanced))
        val twelve = Sim.walk(Sim.at(9, 0), 12, 1.9, 0.04, r)
        val strict = Sim.engine(Strictness.STRICT); Sim.counterPerStep(strict, twelve, 0); Sim.finish(strict, twelve.last())
        assertEquals(0, Sim.total(strict))
    }

    // ---------- persistence ----------
    @Test fun stateSurvivesJsonRoundTrip() {
        val e = Sim.engine()
        val ts = Sim.walk(Sim.at(8, 0), 100, 1.9, 0.05, r)
        Sim.counterPerStep(e, ts, 777)
        e.onActivity(Sim.at(8, 5), ActivityType.IN_VEHICLE, true)
        val copy = Sim.engine(); copy.loadJson(e.toJson())
        assertEquals(e.lastTotal, copy.lastTotal)
        assertEquals(e.today(Sim.at(8, 3)).steps, copy.today(Sim.at(8, 3)).steps)
        assertTrue(copy.inVehicle)
    }
}
