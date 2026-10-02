package com.entalogics.comeback.steps

/*
 * Pedometer for phones without a step sensor. Pure Kotlin.
 * Acceleration magnitude -> high-pass (~0.8 Hz, removes gravity and slow drift) -> two low-pass stages (~3 Hz, removes
 * engine and road vibration) -> peak picking with a minimum height and a minimum time between peaks.
 * Rhythm validation and buffering happen afterwards in StepEngine, exactly as for hardware steps.
 */
class AccelStepDetector(var sensitivity: Sensitivity = Sensitivity.NORMAL, private val onStep: (Long, Double) -> Unit) {
    enum class Sensitivity(val key: String, val minPeak: Double) {
        LOW("low", 0.80), NORMAL("normal", 0.45), HIGH("high", 0.25);

        companion object {
            fun of(key: String?) = values().firstOrNull { it.key == key } ?: NORMAL
        }
    }

    companion object {
        const val HP_HZ = 0.8
        const val LP_HZ = 3.0
        const val MIN_PEAK_GAP_MS = 300L
        const val WARMUP_MS = 1_000L
        const val MAX_PEAK = 10.0   // filtered peaks this tall are shaking or a hard knock, not a footstep
    }

    private var startT = -1L
    private var prevT = -1L
    private var prevMag = 0.0
    private var hp = 0.0
    private var lp1 = 0.0
    private var lp2 = 0.0
    private var y0 = 0.0           // sample before the candidate
    private var y1 = 0.0           // candidate sample
    private var t1 = 0L
    private var lastPeak = -1_000_000L
    private var n = 0

    fun reset() { startT = -1; prevT = -1; hp = 0.0; lp1 = 0.0; lp2 = 0.0; y0 = 0.0; y1 = 0.0; n = 0 }

    fun onSample(tMs: Long, x: Double, y: Double, z: Double) {
        val mag = Math.sqrt(x * x + y * y + z * z)
        if (prevT < 0) { startT = tMs; prevT = tMs; prevMag = mag; return }
        val dt = ((tMs - prevT) / 1000.0).coerceIn(0.002, 0.25)
        prevT = tMs
        val rcH = 1.0 / (2 * Math.PI * HP_HZ)
        hp = rcH / (rcH + dt) * (hp + mag - prevMag)
        prevMag = mag
        val rcL = 1.0 / (2 * Math.PI * LP_HZ)
        val aL = dt / (rcL + dt)
        lp1 += aL * (hp - lp1)
        lp2 += aL * (lp1 - lp2)
        val yNow = lp2
        n++
        if (n >= 3 && tMs - startT > WARMUP_MS) {
            if (y1 > y0 && y1 >= yNow && y1 >= sensitivity.minPeak && t1 - lastPeak >= MIN_PEAK_GAP_MS) {
                lastPeak = t1
                if (y1 <= MAX_PEAK) onStep(t1, y1)
            }
        }
        y0 = y1; y1 = yNow; t1 = tMs
    }
}
