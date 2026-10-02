package com.umar.resetlog.steps

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

/*
 * Step counting brain. Pure Kotlin (no android.* imports) so it can be unit tested with simulated sensor data.
 *
 * Every way of getting steps ends up as a stream of step timestamps:
 *   - STEP_COUNTER deltas (hardware counter; optionally refined with STEP_DETECTOR timestamps)
 *   - STEP_DETECTOR events
 *   - peaks from AccelStepDetector (phones without a step sensor)
 * Each timestamp goes through:  vehicle check -> rhythm gate (buffering) -> hold-back list -> daily totals.
 * The hold-back list keeps freshly accepted steps for a short while so that a late "you are in a vehicle"
 * transition from Activity Recognition can still cancel them.
 */

enum class Strictness(val key: String, val minSteps: Int, val windowMs: Long, val maxCv: Double, val holdMs: Long, val maxAmpCv: Double) {
    RELAXED("relaxed", 6, 8_000, 0.35, 30_000, 0.60),
    BALANCED("balanced", 10, 9_000, 0.25, 75_000, 0.35),
    STRICT("strict", 14, 12_000, 0.18, 120_000, 0.25);

    companion object {
        fun of(key: String?): Strictness = values().firstOrNull { it.key == key } ?: BALANCED
    }
}

enum class CountSource(val key: String) {
    COUNTER("counter"), DETECTOR("detector"), ACCEL("accelerometer");

    companion object {
        fun of(key: String?): CountSource = values().firstOrNull { it.key == key } ?: COUNTER
    }
}

enum class ActivityType { IN_VEHICLE, ON_BICYCLE, WALKING, RUNNING, STILL }

class DayData(var steps: Int = 0, var filtered: Int = 0, val hourly: IntArray = IntArray(24))

/** Accepts steps only when they look like walking: 1.2 to 3.0 steps/s, steady rhythm, sustained. */
class RhythmGate(var strictness: Strictness) {
    class Out(val committed: List<Long>, val discarded: Int)

    private val buf = ArrayList<Long>()
    private val amps = ArrayList<Double>()
    private var walking = false
    private var walkAmp = Double.NaN     // typical step strength of the confirmed bout
    private val recent = ArrayList<Long>() // last step times while walking, to notice the rhythm falling apart
    private var last = 0L

    companion object {
        const val MIN_INTERVAL_MS = 280L      // faster than ~3.5 steps/s is vibration, not walking
        const val MAX_INTERVAL_MS = 1_000L    // slower than ~1 step/s: rhythm broken
        const val WALK_TIMEOUT_MS = 3_000L    // walking ends after this long without a step
        const val DUPLICATE_MS = 250L
        const val RECENT = 6
        const val ACCEL_EXTRA_STEPS = 4      // the accelerometer is a weaker step detector than the hardware chip: ask for a longer steady walk
        const val AMP_BAND = 2.0            // while walking, a step this many times stronger/weaker than the bout is not a footstep
    }

    fun isWalking() = walking

    /** amp = strength of the step (accelerometer peak height), NaN when the source has none (hardware step sensors). */
    fun onStep(ts: Long, amp: Double = Double.NaN): Out {
        if (walking) {
            if (ts - last > WALK_TIMEOUT_MS) {
                walking = false
            } else {
                if (ts - last < DUPLICATE_MS) return Out(emptyList(), 1)
                if (!amp.isNaN() && !walkAmp.isNaN() && (amp > walkAmp * AMP_BAND || amp < walkAmp / AMP_BAND)) return Out(emptyList(), 1)
                if (!amp.isNaN() && !walkAmp.isNaN()) walkAmp = 0.8 * walkAmp + 0.2 * amp
                recent.add(ts); if (recent.size > RECENT) recent.removeAt(0)
                if (recent.size >= RECENT && !steady(recent)) {
                    // the steady rhythm that started this bout is gone: stop counting and start looking for a new bout
                    walking = false; recent.clear(); last = ts
                    return Out(emptyList(), 1)
                }
                last = ts
                return Out(listOf(ts), 0)
            }
        }
        var discarded = 0
        if (buf.isNotEmpty()) {
            val gap = ts - last
            if (gap > MAX_INTERVAL_MS) {
                discarded += buf.size; buf.clear(); amps.clear()
            } else if (gap < MIN_INTERVAL_MS) {
                // an irregular burst: throw away everything held so far
                discarded += buf.size + 1; buf.clear(); amps.clear(); last = ts
                return Out(emptyList(), discarded)
            }
        }
        val extra = if (amp.isNaN()) 0 else ACCEL_EXTRA_STEPS
        val need = strictness.minSteps + extra
        val window = strictness.windowMs + extra * 650L
        buf.add(ts); amps.add(amp); last = ts
        while (buf.size > 1 && ts - buf[0] > window) { buf.removeAt(0); amps.removeAt(0); discarded++ }
        if (buf.size >= need) {
            val tail = buf.subList(buf.size - need, buf.size)
            val aTail = amps.subList(amps.size - need, amps.size)
            if (rhythmOk(tail, window) && amplitudeOk(aTail)) {
                walking = true
                recent.clear(); recent.addAll(buf.takeLast(RECENT))
                walkAmp = if (aTail.any { it.isNaN() }) Double.NaN else aTail.average()
                val out = ArrayList(buf); buf.clear(); amps.clear()
                return Out(out, discarded)
            }
            buf.removeAt(0); amps.removeAt(0); discarded++
        }
        return Out(emptyList(), discarded)
    }

    /** Loose rhythm test used while walking (people speed up and slow down a little). */
    private fun steady(t: List<Long>): Boolean {
        val iv = DoubleArray(t.size - 1) { (t[it + 1] - t[it]).toDouble() }
        val mean = iv.average()
        if (iv.any { it < MIN_INTERVAL_MS - 80 || it > MAX_INTERVAL_MS + 200 }) return false
        var v = 0.0
        for (x in iv) v += (x - mean) * (x - mean)
        return Math.sqrt(v / iv.size) / mean <= strictness.maxCv * 1.6
    }

    /** Walking steps are about equally strong; bumps and shaking vary a lot. */
    private fun amplitudeOk(a: List<Double>): Boolean {
        if (a.any { it.isNaN() }) return true
        val mean = a.average()
        if (mean <= 0) return false
        var v = 0.0
        for (x in a) v += (x - mean) * (x - mean)
        return Math.sqrt(v / a.size) / mean <= strictness.maxAmpCv
    }

    private fun rhythmOk(t: List<Long>, window: Long): Boolean {
        val n = t.size
        if (n < 3) return false
        if (t[n - 1] - t[0] > window) return false
        var sum = 0.0
        val iv = DoubleArray(n - 1)
        for (i in 0 until n - 1) {
            iv[i] = (t[i + 1] - t[i]).toDouble()
            if (iv[i] < MIN_INTERVAL_MS || iv[i] > MAX_INTERVAL_MS) return false
            sum += iv[i]
        }
        val mean = sum / iv.size
        var v = 0.0
        for (x in iv) v += (x - mean) * (x - mean)
        val cv = Math.sqrt(v / iv.size) / mean
        return cv <= strictness.maxCv
    }

    /** Called on a timer. Returns how many held steps were thrown away. */
    fun expire(now: Long): Int {
        var d = 0
        if (!walking && buf.isNotEmpty() && now - last > MAX_INTERVAL_MS) { d = buf.size; buf.clear(); amps.clear() }
        if (walking && now - last > WALK_TIMEOUT_MS) walking = false
        return d
    }

    fun reset(): Int { val d = buf.size; buf.clear(); amps.clear(); recent.clear(); walking = false; return d }
}

class StepEngine(
    var strictness: Strictness = Strictness.BALANCED,
    private val zone: TimeZone = TimeZone.getDefault()
) {
    var source: CountSource = CountSource.COUNTER
    val days = HashMap<String, DayData>()
    private val gate = RhythmGate(strictness)
    private val pending = ArrayList<Long>()                 // accepted, waiting out the hold-back
    private val detectorHints = ArrayList<Long>()           // STEP_DETECTOR timestamps (used to time counter deltas)
    private val windows = ArrayList<LongArray>()            // closed vehicle windows [start, end]
    private var vehicleSince: Long? = null                  // activity recognition says vehicle/bicycle since
    private var speedFastSince: Long? = null
    private var speedVehicleSince: Long? = null
    var lastTotal: Long = -1
    var lastTotalTs: Long = 0

    companion object {
        const val COARSE_GAP_MS = 15_000L        // longer than this between counter readings: rhythm cannot be judged
        const val MAX_CADENCE = 3.2              // steps per second a human cannot exceed
        const val REBOOT_ASSUMED_CADENCE = 1.8
        const val SPEED_LIMIT_KMH = 15.0
        const val SPEED_HOLD_MS = 30_000L
        const val KEEP_DAYS = 60
    }

    fun applyStrictness(s: Strictness) { strictness = s; gate.strictness = s }

    val inVehicle: Boolean get() = vehicleSince != null || speedVehicleSince != null
    val walkingNow: Boolean get() = gate.isWalking()

    // ---------- day bookkeeping ----------
    fun dayKey(ts: Long): String {
        val c = Calendar.getInstance(zone); c.timeInMillis = ts
        return String.format("%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }
    private fun hourOf(ts: Long): Int { val c = Calendar.getInstance(zone); c.timeInMillis = ts; return c.get(Calendar.HOUR_OF_DAY) }
    private fun day(ts: Long) = days.getOrPut(dayKey(ts)) { DayData() }
    private fun addFiltered(ts: Long, n: Int) { if (n > 0) day(ts).filtered += n }
    private fun commit(ts: Long) { val d = day(ts); d.steps++; d.hourly[hourOf(ts)]++ }

    // ---------- inputs ----------
    /** STEP_DETECTOR event. In COUNTER mode it only provides timing; otherwise it is a step. */
    fun onDetectorStep(ts: Long) {
        when (source) {
            CountSource.COUNTER -> { detectorHints.add(ts); if (detectorHints.size > 600) detectorHints.removeAt(0) }
            else -> rawStep(ts)
        }
    }

    /** Peak from the accelerometer detector. */
    fun onAccelStep(ts: Long, amp: Double = Double.NaN) { if (source == CountSource.ACCEL) rawStep(ts, amp) }

    /** STEP_COUNTER reading: total steps since the phone last booted. */
    fun onCounterReading(ts: Long, total: Long) {
        if (source != CountSource.COUNTER) return
        if (lastTotal < 0) { lastTotal = total; lastTotalTs = ts; return }
        if (ts < lastTotalTs) return
        var t0 = lastTotalTs
        val delta: Long
        if (total < lastTotal) {
            // the phone rebooted: the new reading is the number of steps since the reboot
            delta = total
            t0 = maxOf(lastTotalTs, ts - (delta * 1000 / REBOOT_ASSUMED_CADENCE).toLong())
        } else delta = total - lastTotal
        lastTotal = total; lastTotalTs = ts
        if (delta <= 0 || delta > 200_000) { trimHints(ts); return }
        val n = delta.toInt()
        // The counter reports when steps happen. A few steps after a long quiet time happened just now, not spread
        // over the quiet time. Only a steady average rate means "walked the whole gap" (service was not running).
        if (ts - t0 > COARSE_GAP_MS && delta * 1000.0 / (ts - t0) < 0.8) t0 = maxOf(t0, ts - (delta * 1000 / REBOOT_ASSUMED_CADENCE).toLong())
        val span = ts - t0
        if (span > COARSE_GAP_MS) { coarse(t0, ts, n); trimHints(ts); return }
        stampsFor(t0, ts, n).forEach { rawStep(it) }
        trimHints(ts)
    }

    /** A long gap between readings (service was not running). Rhythm cannot be judged, vehicle windows still apply. */
    private fun coarse(t0: Long, t1: Long, n: Int) {
        if (n < strictness.minSteps) { addFiltered(t1, n); return }
        val span = (t1 - t0).coerceAtLeast(1)
        var max = (MAX_CADENCE * span / 1000.0).toInt().coerceAtLeast(1)
        // If part of the gap was spent in a vehicle, the counter's total is full of vibration steps and the time they
        // happened is unknown. Assume at most half of the remaining time was spent walking.
        val inVeh = vehicleMsWithin(t0, t1)
        if (inVeh > 0) max = minOf(max, ((span - inVeh) / 1000.0 * 0.5).toInt().coerceAtLeast(0))
        val keep = minOf(n, max)
        addFiltered(t1, n - keep)
        for (i in 0 until keep) {
            val ts = t0 + (i + 1) * span / keep
            if (isVehicleAt(ts)) addFiltered(ts, 1) else pending.add(ts)
        }
        pending.sort()
    }

    private fun vehicleMsWithin(t0: Long, t1: Long): Long {
        var total = 0L
        val all = ArrayList<LongArray>(windows)
        vehicleSince?.let { all.add(longArrayOf(it, t1)) }
        speedVehicleSince?.let { all.add(longArrayOf(it, t1)) }
        for (w in all) { val a = maxOf(w[0], t0); val b = minOf(w[1], t1); if (b > a) total += b - a }
        return minOf(total, t1 - t0)
    }

    private fun stampsFor(t0: Long, t1: Long, n: Int): List<Long> {
        val hints = detectorHints.filter { it in (t0 + 1)..t1 }
        if (hints.isNotEmpty() && Math.abs(hints.size - n) <= maxOf(2, n / 10)) {
            if (hints.size >= n) return hints.takeLast(n)
        }
        val span = (t1 - t0).coerceAtLeast(1)
        return (0 until n).map { t0 + (it + 1) * span / n }
    }
    private fun trimHints(upTo: Long) { detectorHints.removeAll { it <= upTo } }

    private fun rawStep(ts: Long, amp: Double = Double.NaN) {
        if (isVehicleAt(ts)) { addFiltered(ts, 1); return }
        val out = gate.onStep(ts, amp)
        out.committed.forEach { pending.add(it) }
        addFiltered(ts, out.discarded)
    }

    /** Activity Recognition transition. ts is when the transition happened (may be earlier than now). */
    fun onActivity(ts: Long, type: ActivityType, enter: Boolean) {
        when (type) {
            ActivityType.IN_VEHICLE, ActivityType.ON_BICYCLE -> if (enter) startVehicle(ts) else endVehicle(ts)
            ActivityType.WALKING, ActivityType.RUNNING, ActivityType.STILL -> if (enter) endVehicle(ts)
        }
    }

    private fun startVehicle(ts: Long) {
        if (vehicleSince != null) return
        vehicleSince = ts
        // detection lags the real start of the ride, so also cancel what was accepted just before it
        purgeFrom(ts - strictness.holdMs)
    }

    private fun endVehicle(ts: Long) {
        val s = vehicleSince ?: return
        windows.add(longArrayOf(s, maxOf(s, ts)))
        vehicleSince = null
        addFiltered(ts, gate.reset())
    }

    /** Optional speed check: above 15 km/h for 30 s means a vehicle. */
    fun onSpeed(ts: Long, kmh: Double) {
        if (kmh >= SPEED_LIMIT_KMH) {
            if (speedFastSince == null) speedFastSince = ts
            val since = speedFastSince!!
            if (speedVehicleSince == null && ts - since >= SPEED_HOLD_MS) {
                speedVehicleSince = since
                purgeFrom(since - strictness.holdMs)
            }
        } else {
            speedFastSince = null
            speedVehicleSince?.let { windows.add(longArrayOf(it, ts)); speedVehicleSince = null; addFiltered(ts, gate.reset()) }
        }
    }

    private fun isVehicleAt(ts: Long): Boolean {
        vehicleSince?.let { if (ts >= it) return true }
        speedVehicleSince?.let { if (ts >= it) return true }
        for (w in windows) if (ts >= w[0] && ts <= w[1]) return true
        return false
    }

    private fun purgeFrom(ts: Long) {
        var n = 0
        val it = pending.iterator()
        while (it.hasNext()) { val p = it.next(); if (p >= ts) { it.remove(); n++; addFiltered(p, 1) } }
        addFiltered(ts, gate.reset())
        if (n >= 0) Unit
    }

    /** Housekeeping on a timer: expire rhythm buffers, finalise held steps, midnight, pruning. */
    fun tick(now: Long) {
        addFiltered(now, gate.expire(now))
        val limit = now - strictness.holdMs
        val iter = pending.iterator()
        while (iter.hasNext()) { val p = iter.next(); if (p <= limit) { commit(p); iter.remove() } }
        windows.removeAll { it[1] < now - 24 * 3_600_000L }
        if (days.size > KEEP_DAYS) {
            val keep = days.keys.sorted().takeLast(KEEP_DAYS).toSet()
            days.keys.retainAll(keep)
        }
    }

    // ---------- views ----------
    /** Totals including steps still in the hold-back (what the user should see). */
    fun view(now: Long): Map<String, DayData> {
        val out = HashMap<String, DayData>()
        for ((k, v) in days) out[k] = DayData(v.steps, v.filtered, v.hourly.copyOf())
        for (p in pending) { val d = out.getOrPut(dayKey(p)) { DayData() }; d.steps++; d.hourly[hourOf(p)]++ }
        return out
    }
    fun today(now: Long): DayData = view(now)[dayKey(now)] ?: DayData()

    // ---------- persistence ----------
    fun toJson(): String {
        val o = JSONObject()
        o.put("lastTotal", lastTotal); o.put("lastTotalTs", lastTotalTs)
        o.put("source", source.key); o.put("strictness", strictness.key)
        val d = JSONObject()
        for ((k, v) in days) d.put(k, JSONObject().put("s", v.steps).put("f", v.filtered).put("h", JSONArray(v.hourly.toList())))
        o.put("days", d)
        o.put("pending", JSONArray(pending))
        o.put("windows", JSONArray(windows.map { JSONArray(listOf(it[0], it[1])) }))
        vehicleSince?.let { o.put("vehicleSince", it) }
        speedVehicleSince?.let { o.put("speedVehicleSince", it) }
        return o.toString()
    }

    fun loadJson(json: String) {
        val o = JSONObject(json)
        lastTotal = o.optLong("lastTotal", -1); lastTotalTs = o.optLong("lastTotalTs", 0)
        source = CountSource.of(o.optString("source")); applyStrictness(Strictness.of(o.optString("strictness")))
        days.clear()
        o.optJSONObject("days")?.let { d ->
            for (k in d.keys()) {
                val v = d.getJSONObject(k)
                val dd = DayData(v.optInt("s"), v.optInt("f"))
                val h = v.optJSONArray("h"); if (h != null) for (i in 0 until minOf(24, h.length())) dd.hourly[i] = h.optInt(i)
                days[k] = dd
            }
        }
        pending.clear(); o.optJSONArray("pending")?.let { for (i in 0 until it.length()) pending.add(it.getLong(i)) }
        windows.clear(); o.optJSONArray("windows")?.let { for (i in 0 until it.length()) { val w = it.getJSONArray(i); windows.add(longArrayOf(w.getLong(0), w.getLong(1))) } }
        vehicleSince = if (o.has("vehicleSince")) o.getLong("vehicleSince") else null
        speedVehicleSince = if (o.has("speedVehicleSince")) o.getLong("speedVehicleSince") else null
    }
}
