package com.entalogics.comeback.steps

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/*
 * Travel record. Pure Kotlin (no android.* imports) so it can be unit tested with simulated transitions and fixes.
 *
 * Tier 1 (always, needs only Activity Recognition): minutes per day spent walking, running, cycling and in a vehicle,
 * plus a list of trips. A trip is one vehicle (or bicycle) journey of at least 2 minutes. A stop shorter than 3 minutes
 * (a traffic light, a drop-off) does not end the trip. A period that crosses midnight is split by timestamp, like steps.
 * A trip belongs to the day it started on (its minutes are split across both days in the day totals).
 *
 * Tier 2 (opt-in): while a trip is active the service feeds location fixes to onFix(). They are only used to add up
 * the distance between consecutive fixes. The latest fix is kept in memory for that and is never written to storage:
 * no coordinates, no route, only the total distance and the time it covers are persisted.
 *
 * Android cannot tell a car from a motorbike (both are IN_VEHICLE), so a trip's mode is "vehicle" or "bike" only.
 * The user can label vehicle trips in the app.
 */

class Trip(val mode: String, var start: Long, var end: Long, var distM: Double = 0.0, var segMs: Long = 0)

class TravelDay(var walkMs: Long = 0, var runMs: Long = 0, var bikeMs: Long = 0, var vehicleMs: Long = 0, val trips: ArrayList<Trip> = ArrayList()) {
    fun copy() = TravelDay(walkMs, runMs, bikeMs, vehicleMs, ArrayList(trips.map { Trip(it.mode, it.start, it.end, it.distM, it.segMs) }))
}

class TripView(val mode: String, val start: Long, val end: Long, val min: Int, val km: Double?, val avgKmh: Double?)

class TravelView(val walkMin: Int, val runMin: Int, val bikeMin: Int, val vehicleMin: Int, val trips: List<TripView>)

class TravelLog(private val zoneOf: () -> TimeZone = { TimeZone.getDefault() }) {
    companion object {
        const val MIN_TRIP_MS = 2 * 60_000L          // shorter journeys are not trips
        const val MERGE_GAP_MS = 3 * 60_000L         // stops shorter than this keep the trip going
        const val MAX_OPEN_MS = 12 * 3_600_000L      // a period with no end event for this long is not trusted
        const val MAX_TRIPS_PER_DAY = 50
        const val KEEP_DAYS = 60
        const val MAX_ACCURACY_M = 50.0              // fixes less precise than this are dropped
        const val MAX_SPEED_KMH = 200.0              // a jump implying more than this is a bad fix
        const val MAX_FIX_GAP_MS = 10 * 60_000L      // after this long without a fix the distance chain starts again
        const val STALE_FIX_MS = 30_000L             // ignore fixes older than the start of the trip
        const val MAX_REJECTED_JUMPS = 3             // after this many bad jumps in a row the next fix becomes the new anchor
    }

    val days = HashMap<String, TravelDay>()
    private var cur: ActivityType? = null            // what Activity Recognition says we are doing (STILL included)
    private var curSince = 0L
    private var cand: Trip? = null                   // the trip being assembled; extended while stops stay short
    private class Fix(val ts: Long, val lat: Double, val lon: Double, val acc: Double)
    private var lastFix: Fix? = null                 // memory only, never persisted
    private var jumps = 0

    /** True while a vehicle or bicycle period is open: the service asks for location fixes only then. */
    val tripActive: Boolean get() = cur == ActivityType.IN_VEHICLE || cur == ActivityType.ON_BICYCLE

    // ---------- time helpers ----------
    private fun dayKey(ts: Long): String {
        val c = Calendar.getInstance(zoneOf()); c.timeInMillis = ts
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }
    private fun nextMidnight(ts: Long): Long {
        val c = Calendar.getInstance(zoneOf()); c.timeInMillis = ts
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }
    /** Calls sink once per calendar day touched by [s, e), with the milliseconds spent inside that day. */
    private fun splitByDay(s: Long, e: Long, sink: (String, Long) -> Unit) {
        var a = s
        while (a < e) {
            val m = nextMidnight(a)
            val b = minOf(e, if (m > a) m else e)
            sink(dayKey(a), b - a)
            a = b
        }
    }
    private fun add(days: Map<String, TravelDay>, mode: ActivityType, s: Long, e: Long, create: (String) -> TravelDay) {
        if (e <= s) return
        splitByDay(s, e) { k, ms ->
            val d = days[k] ?: create(k)
            when (mode) {
                ActivityType.WALKING -> d.walkMs += ms
                ActivityType.RUNNING -> d.runMs += ms
                ActivityType.ON_BICYCLE -> d.bikeMs += ms
                ActivityType.IN_VEHICLE -> d.vehicleMs += ms
                ActivityType.STILL -> {}
            }
        }
    }

    // ---------- Activity Recognition ----------
    fun onActivity(ts: Long, type: ActivityType, enter: Boolean) {
        if (enter) {
            if (cur == type) return
            closeCurrent(ts)
            cur = type; curSince = ts
            if (type == ActivityType.IN_VEHICLE || type == ActivityType.ON_BICYCLE) openTrip(ts, if (type == ActivityType.IN_VEHICLE) "vehicle" else "bike")
        } else if (cur == type) {
            closeCurrent(ts)
            cur = null
        }
    }

    private fun closeCurrent(ts: Long) {
        val c = cur ?: return
        val end = maxOf(ts, curSince)
        if (end - curSince <= MAX_OPEN_MS) {
            add(days, c, curSince, end) { k -> TravelDay().also { days[k] = it } }
            if (c == ActivityType.IN_VEHICLE || c == ActivityType.ON_BICYCLE) cand?.let { if (end > it.end) it.end = end }
        }
        lastFix = null; jumps = 0
        cur = null
    }

    private fun openTrip(ts: Long, mode: String) {
        val t = cand
        if (t != null && (t.mode != mode || ts - t.end >= MERGE_GAP_MS)) { finalizeTrip(t); cand = null }
        val c = cand
        if (c == null) cand = Trip(mode, ts, ts) else c.end = maxOf(c.end, ts)
        lastFix = null; jumps = 0
    }

    private fun finalizeTrip(t: Trip) {
        if (t.end - t.start < MIN_TRIP_MS) return
        val d = days.getOrPut(dayKey(t.start)) { TravelDay() }
        if (d.trips.size < MAX_TRIPS_PER_DAY) d.trips.add(t)
    }

    // ---------- location fixes (tier 2) ----------
    /** One location fix while a trip is active. Returns true when it was used. Coordinates are not kept beyond the next fix. */
    fun onFix(ts: Long, lat: Double, lon: Double, accuracyM: Double): Boolean {
        val t = cand ?: return false
        if (!tripActive) return false
        if (accuracyM.isNaN() || accuracyM < 0 || accuracyM > MAX_ACCURACY_M) return false
        if (lat.isNaN() || lon.isNaN() || Math.abs(lat) > 90 || Math.abs(lon) > 180) return false
        if (ts < curSince - STALE_FIX_MS) return false
        val p = lastFix
        val fix = Fix(ts, lat, lon, accuracyM)
        if (p == null) { lastFix = fix; jumps = 0; return true }
        val dt = ts - p.ts
        if (dt <= 0) return false
        if (dt > MAX_FIX_GAP_MS) { lastFix = fix; jumps = 0; return true }
        val d = haversineM(p.lat, p.lon, lat, lon)
        if (d / (dt / 1000.0) * 3.6 > MAX_SPEED_KMH) {
            if (++jumps >= MAX_REJECTED_JUMPS) { lastFix = fix; jumps = 0 }
            return false
        }
        jumps = 0
        // movement smaller than the position noise is not movement; the anchor stays so slow progress still adds up
        if (d < maxOf(5.0, 0.5 * maxOf(p.acc, accuracyM))) return false
        t.distM += d; t.segMs += dt; lastFix = fix
        return true
    }

    // ---------- housekeeping ----------
    fun tick(now: Long) {
        cur?.let {
            if (now - curSince > MAX_OPEN_MS) { cur = null; lastFix = null }   // end event never arrived: do not invent hours
        }
        cand?.let { if (!tripActive && now - it.end >= MERGE_GAP_MS) { finalizeTrip(it); cand = null } }
        if (days.size > KEEP_DAYS) {
            val keep = days.keys.sorted().takeLast(KEEP_DAYS).toSet()
            days.keys.retainAll(keep)
        }
    }

    // ---------- views ----------
    /** Everything per day, including the period in progress and the trip being assembled (when it already counts as a trip). */
    fun view(now: Long): Map<String, TravelView> {
        val copy = HashMap<String, TravelDay>()
        for ((k, v) in days) copy[k] = v.copy()
        val c = cur
        if (c != null && now - curSince <= MAX_OPEN_MS) add(copy, c, curSince, now) { k -> TravelDay().also { copy[k] = it } }
        cand?.let { t ->
            val end = if (tripActive) maxOf(now, t.end) else t.end
            if (end - t.start >= MIN_TRIP_MS) {
                val d = copy.getOrPut(dayKey(t.start)) { TravelDay() }
                if (d.trips.size < MAX_TRIPS_PER_DAY) d.trips.add(Trip(t.mode, t.start, end, t.distM, t.segMs))
            }
        }
        val out = HashMap<String, TravelView>()
        for ((k, d) in copy) {
            val trips = d.trips.sortedBy { it.start }.map { t ->
                val km = if (t.segMs > 0 && t.distM > 0) Math.round(t.distM / 10.0) / 100.0 else null
                val avg = if (km != null && t.segMs > 0) Math.round(t.distM / 1000.0 / (t.segMs / 3_600_000.0) * 10) / 10.0 else null
                TripView(t.mode, t.start, t.end, minutes(t.end - t.start), km, avg)
            }
            val v = TravelView(minutes(d.walkMs), minutes(d.runMs), minutes(d.bikeMs), minutes(d.vehicleMs), trips)
            if (v.walkMin + v.runMin + v.bikeMin + v.vehicleMin > 0 || trips.isNotEmpty()) out[k] = v
        }
        return out
    }
    private fun minutes(ms: Long) = ((ms + 30_000) / 60_000).toInt()

    // ---------- persistence (no coordinates) ----------
    private fun tripJson(t: Trip) = JSONArray().put(t.mode).put(t.start).put(t.end).put(Math.round(t.distM)).put(t.segMs)
    private fun tripFrom(a: JSONArray) = Trip(a.optString(0, "vehicle"), a.optLong(1), a.optLong(2), a.optDouble(3, 0.0), a.optLong(4, 0))

    fun toJson(): JSONObject {
        val o = JSONObject()
        val d = JSONObject()
        for ((k, v) in days) d.put(k, JSONObject().put("w", v.walkMs).put("r", v.runMs).put("b", v.bikeMs).put("v", v.vehicleMs).put("t", JSONArray(v.trips.map { tripJson(it) })))
        o.put("days", d)
        cur?.let { o.put("cur", it.name).put("curSince", curSince) }
        cand?.let { o.put("cand", tripJson(it)) }
        return o
    }

    fun loadJson(o: JSONObject?) {
        days.clear(); cur = null; cand = null; lastFix = null; jumps = 0
        if (o == null) return
        o.optJSONObject("days")?.let { d ->
            for (k in d.keys()) {
                val v = d.optJSONObject(k) ?: continue
                val td = TravelDay(v.optLong("w"), v.optLong("r"), v.optLong("b"), v.optLong("v"))
                v.optJSONArray("t")?.let { a -> for (i in 0 until minOf(a.length(), MAX_TRIPS_PER_DAY)) a.optJSONArray(i)?.let { td.trips.add(tripFrom(it)) } }
                days[k] = td
            }
        }
        val name = o.optString("cur", "")
        cur = ActivityType.values().firstOrNull { it.name == name }
        curSince = o.optLong("curSince", 0)
        o.optJSONArray("cand")?.let { cand = tripFrom(it) }
    }
}

/** Great-circle distance in metres. */
fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6_371_000.0
    val p1 = Math.toRadians(lat1); val p2 = Math.toRadians(lat2)
    val dp = p2 - p1; val dl = Math.toRadians(lon2 - lon1)
    val a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2)
    return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(a)))
}
