package com.entalogics.comeback.steps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Accelerometer pedometer (phones without a step sensor) driven by simulated 50 Hz signals. */
class AccelDetectorTest {
    private fun run(seconds: Int, signal: (Double) -> DoubleArray, sens: AccelStepDetector.Sensitivity = AccelStepDetector.Sensitivity.NORMAL, strict: Strictness = Strictness.BALANCED, activity: List<Triple<Long, ActivityType, Boolean>> = emptyList()): Int {
        val e = Sim.engine(strict, CountSource.ACCEL)
        val det = AccelStepDetector(sens) { ts, amp -> e.onAccelStep(ts, amp) }
        val start = Sim.at(8, 0)
        val pend = ArrayList(activity.sortedBy { it.first })
        for (i in 0 until seconds * Sim.FS) {
            val t = start + i * 1000L / Sim.FS
            while (pend.isNotEmpty() && pend[0].first <= t) { val a = pend.removeAt(0); e.onActivity(a.first, a.second, a.third) } // events arrive in time order
            val a = signal(i.toDouble() / Sim.FS)
            det.onSample(t, a[0], a[1], a[2])
            if (i % (Sim.FS * 5) == 0) e.tick(t)
        }
        e.tick(start + seconds * 1000L + 400_000)
        return Sim.total(e)
    }
    private fun within(expected: Int, actual: Int, pct: Double) = assertTrue("expected ~$expected (+-${(pct * 100).toInt()}%) but counted $actual", Math.abs(actual - expected) <= expected * pct)

    @Test fun walkingPhoneInPocket_counted() { // 2 minutes at 1.9 steps/s ~ 228 steps
        within(228, run(120, Sim.walkingSignal(3.0, 1.9, 1)), 0.08)
    }
    @Test fun walkingPhoneInHand_counted() {
        within(216, run(120, Sim.walkingSignal(1.4, 1.8, 2)), 0.10)
    }
    @Test fun slowWalking_pocket_counted() {
        within(150, run(120, Sim.walkingSignal(2.2, 1.25, 3)), 0.12)
    }
    @Test fun brisk_walking_counted() { within(300, run(120, Sim.walkingSignal(3.5, 2.5, 4)), 0.08) }
    @Test fun carRideSmoothRoad_rejected() { assertEquals(0, run(600, Sim.carSmooth(5))) }
    @Test fun motorbikeBumpyRoad_rejected() {
        // without Activity Recognition, an unlucky stretch of bumps can look like one short walk; it must stay a handful of steps
        for (seed in listOf(6L, 16L, 26L)) { val n = run(600, Sim.motorbikeBumpy(seed)); assertTrue("motorbike (seed $seed) counted $n steps in 10 minutes", n <= 12) }
    }
    @Test fun motorbikeBumpyRoad_withActivityRecognition_zero() {
        val n = run(600, Sim.motorbikeBumpy(6), activity = listOf(Triple(Sim.at(8, 1), ActivityType.IN_VEHICLE, true)))
        assertTrue("motorbike counted $n steps", n <= 2)
    }
    @Test fun bicycleRide_rejectedByActivityRecognition() {
        // steady pedalling at ~1.3 Hz looks like slow walking to an accelerometer; Activity Recognition (ON_BICYCLE) is what rejects it
        val n = run(600, Sim.bicycle(7), activity = listOf(Triple(Sim.at(8, 1), ActivityType.ON_BICYCLE, true)))
        assertTrue("bicycle counted $n steps in 10 minutes", n <= 8)
    }
    @Test fun phoneShakingInHand_rejected() {
        val n = run(60, Sim.shaking(8)); assertTrue("shaking counted $n steps", n <= 3)
    }
    @Test fun phoneStillOnTable_zero() { assertEquals(0, run(300, Sim.stillOnTable())) }
    @Test fun sensitivityHigh_catchesGentlerWalking_thanLow() {
        val gentle = Sim.walkingSignal(1.0, 1.8, 9)
        val low = run(90, gentle, AccelStepDetector.Sensitivity.LOW); val high = run(90, Sim.walkingSignal(1.0, 1.8, 9), AccelStepDetector.Sensitivity.HIGH)
        assertTrue("low=$low high=$high", high > low)
    }
}
