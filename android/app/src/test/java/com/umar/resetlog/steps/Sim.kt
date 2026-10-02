package com.umar.resetlog.steps

import java.util.Calendar
import java.util.Random
import java.util.TimeZone

/** Simulated sensor data for the unit tests (no phone needed). All times are UTC. */
object Sim {
    val UTC: TimeZone = TimeZone.getTimeZone("UTC")

    fun at(h: Int, m: Int, s: Int = 0, dayOfMonth: Int = 2): Long {
        val c = Calendar.getInstance(UTC)
        c.clear(); c.set(2026, Calendar.OCTOBER, dayOfMonth, h, m, s)
        return c.timeInMillis
    }

    fun engine(strictness: Strictness = Strictness.BALANCED, source: CountSource = CountSource.COUNTER): StepEngine {
        val e = StepEngine(strictness, UTC); e.source = source; return e
    }

    /** n steps starting at `start`, mean cadence in steps/s, relative jitter on each interval (0.06 = 6%). */
    fun walk(start: Long, n: Int, cadence: Double, jitter: Double, r: Random): List<Long> {
        val mean = 1000.0 / cadence
        val out = ArrayList<Long>(); var t = start.toDouble()
        for (i in 0 until n) { t += (mean + r.nextGaussian() * jitter * mean).coerceAtLeast(120.0); out.add(t.toLong()) }
        return out
    }

    /** Bursty false steps with exponential gaps (how a hardware counter reacts to road bumps). */
    fun bumpy(start: Long, durationMs: Long, meanGapMs: Double, r: Random): List<Long> {
        val out = ArrayList<Long>(); var t = start.toDouble()
        while (t < start + durationMs) { t += -Math.log(1 - r.nextDouble()) * meanGapMs + 40; out.add(t.toLong()) }
        return out
    }

    /** Perfectly regular false steps (pedalling). */
    fun regular(start: Long, durationMs: Long, cadence: Double): List<Long> {
        val gap = 1000.0 / cadence; val out = ArrayList<Long>(); var t = start + gap
        while (t < start + durationMs) { out.add(t.toLong()); t += gap }
        return out
    }

    /** Hardware step counter that reports on every step. Returns the final total. */
    fun counterPerStep(e: StepEngine, ts: List<Long>, startTotal: Long): Long {
        var total = startTotal
        e.onCounterReading(ts.first() - 1_000, total)   // baseline reading taken when counting started
        for (t in ts) { total++; e.onDetectorStep(t); e.onCounterReading(t, total); if (t % 5000 < 40) e.tick(t) }
        return total
    }

    /** Counter that reports in batches every `everyMs` (sensor batching / maxReportLatency). */
    fun counterBatched(e: StepEngine, ts: List<Long>, startTotal: Long, everyMs: Long): Long {
        var total = startTotal; var nextReport = ts.first() + everyMs
        e.onCounterReading(ts.first() - 1_000, total)
        for (t in ts) {
            while (t > nextReport) { e.onCounterReading(nextReport, total); e.tick(nextReport); nextReport += everyMs }
            total++
        }
        e.onCounterReading(nextReport, total)
        return total
    }

    fun detector(e: StepEngine, ts: List<Long>) { for (t in ts) { e.onDetectorStep(t); if (t % 5000 < 40) e.tick(t) } }

    fun total(e: StepEngine): Int = e.days.values.sumOf { it.steps }
    fun filtered(e: StepEngine): Int = e.days.values.sumOf { it.filtered }
    fun finish(e: StepEngine, lastTs: Long) = e.tick(lastTs + 400_000)

    // ---------------- accelerometer signals (50 Hz) ----------------
    const val FS = 50

    fun feedAccel(det: AccelStepDetector, start: Long, seconds: Int, fn: (Double) -> DoubleArray) {
        val n = seconds * FS
        for (i in 0 until n) { val t = i.toDouble() / FS; val a = fn(t); det.onSample(start + (t * 1000).toLong(), a[0], a[1], a[2]) }
    }

    /** Walking: vertical bounce at the step frequency plus a harmonic, sway and sensor noise. */
    fun walkingSignal(amp: Double, f0: Double, seed: Long): (Double) -> DoubleArray {
        val r = Random(seed); var phase = 0.0; var last = 0.0
        return { t ->
            val f = f0 * (1 + 0.04 * Math.sin(2 * Math.PI * 0.1 * t))
            phase += 2 * Math.PI * f * (t - last); last = t
            val v = amp * Math.sin(phase) + 0.35 * amp * Math.sin(2 * phase + 0.6)
            doubleArrayOf(0.4 * amp * Math.sin(phase / 2) + r.nextGaussian() * 0.15, r.nextGaussian() * 0.15, 9.81 + v + r.nextGaussian() * 0.15)
        }
    }

    fun carSmooth(seed: Long): (Double) -> DoubleArray {
        val r = Random(seed)
        return { t -> doubleArrayOf(0.15 * Math.sin(2 * Math.PI * 0.3 * t) + r.nextGaussian() * 0.05, r.nextGaussian() * 0.05, 9.81 + 0.08 * Math.sin(2 * Math.PI * 25 * t) + r.nextGaussian() * 0.06) }
    }

    fun motorbikeBumpy(seed: Long): (Double) -> DoubleArray {
        val r = Random(seed); val bumps = ArrayList<DoubleArray>(); var nextBump = 0.3
        return { t ->
            while (nextBump < t + 0.01) { bumps.add(doubleArrayOf(nextBump, 3 + r.nextDouble() * 9)); nextBump += -Math.log(1 - r.nextDouble()) / 1.5 }
            var b = 0.0
            for (x in bumps) { val d = t - x[0]; if (d in 0.0..0.08) b += x[1] * Math.sin(Math.PI * d / 0.08) }
            bumps.removeAll { t - it[0] > 0.2 }
            doubleArrayOf(1.5 * Math.sin(2 * Math.PI * 0.2 * t) + r.nextGaussian() * 0.8, r.nextGaussian() * 0.8, 9.81 + 1.2 * Math.sin(2 * Math.PI * 30 * t) + b + r.nextGaussian() * 0.8)
        }
    }

    fun bicycle(seed: Long): (Double) -> DoubleArray {
        val r = Random(seed); val bumps = ArrayList<DoubleArray>(); var nextBump = 0.5
        return { t ->
            while (nextBump < t + 0.01) { bumps.add(doubleArrayOf(nextBump, 2 + r.nextDouble() * 5)); nextBump += -Math.log(1 - r.nextDouble()) / 0.4 }
            var b = 0.0
            for (x in bumps) { val d = t - x[0]; if (d in 0.0..0.1) b += x[1] * Math.sin(Math.PI * d / 0.1) }
            bumps.removeAll { t - it[0] > 0.3 }
            doubleArrayOf(r.nextGaussian() * 0.4, r.nextGaussian() * 0.4, 9.81 + 0.8 * Math.sin(2 * Math.PI * 1.3 * t) + 0.5 * Math.sin(2 * Math.PI * 20 * t) + b + r.nextGaussian() * 0.5)
        }
    }

    /** Phone shaken about in the hand: wandering frequency (2-8 Hz) and bursty amplitude. */
    fun shaking(seed: Long): (Double) -> DoubleArray {
        val r = Random(seed); var phase = 0.0; var last = 0.0; var f = 5.0; var amp = 10.0
        return { t ->
            f = (f + r.nextGaussian() * 0.25).coerceIn(2.0, 8.0); amp = (amp + r.nextGaussian() * 1.5).coerceIn(4.0, 22.0)
            phase += 2 * Math.PI * f * (t - last); last = t
            doubleArrayOf(amp * 0.6 * Math.sin(phase * 0.7), amp * 0.5 * Math.cos(phase), 9.81 + amp * Math.sin(phase))
        }
    }

    fun stillOnTable(): (Double) -> DoubleArray = { _ -> doubleArrayOf(0.0, 0.0, 9.81) }
}
