package com.entalogics.comeback.widget

import org.json.JSONObject
import java.text.NumberFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * What the page last told the phone about today: the score, a short label, steps, the steps target and the next open habit.
 * The page is the only place that knows the habit plan and the day records, so it pushes this small snapshot whenever the Today numbers change.
 * Everything in this file is plain Kotlin (no Android classes except org.json), so it is unit tested on the JVM.
 */
data class Snapshot(
    /** Local calendar day the snapshot is about, "YYYY-MM-DD". */
    val date: String,
    /** 0 to 100, or null on a rest day or a light day (no score). */
    val score: Int?,
    /** "12-day streak", "Rest day", "Light day" or null. */
    val label: String?,
    val steps: Int,
    /** 0 when there is no Steps habit. */
    val stepsTarget: Int,
    /** The first habit still open today, or null. */
    val openHabit: String?,
    /** When the page built it (ms since 1970). Never shown. */
    val updatedAt: Long
)

/** The words the widget shows. The defaults are the English text; the updater fills them from string resources. */
data class WidgetTexts(
    val stale: String = "Open Comeback to start today",
    val setup: String = "Open Comeback to set up",
    val freshStart: String = "A fresh start today",
    val stepsWord: String = "steps",
    val next: String = "Next: %s",
    val rest: String = "Rest",
    val light: String = "Light",
    val none: String = "–",
    val tapToOpen: String = "Tap to open Comeback.",
    val appName: String = "Comeback",
    val today: String = "Today",
    val percentWord: String = "percent",
    val ofWord: String = "of"
)

/** Everything the layouts need, already turned into text. */
data class WidgetState(
    /** 0..1 share of the ring that is filled. */
    val fraction: Float,
    /** The ring is full: drawn in the "done" colour. */
    val done: Boolean,
    /** Inside the ring: "62%", "Rest", "Light" or a dash. */
    val centerText: String,
    /** "5,200 / 8,000" (compact). Null when there is nothing to show. */
    val stepsShort: String?,
    /** "5,200 / 8,000 steps" (wide). */
    val stepsLong: String?,
    /** The streak / day label, or the "Open Comeback ..." message. Null when none. */
    val note: String?,
    /** "Next: Water", or null. */
    val nextLine: String?,
    /** The snapshot is from an earlier day or missing. */
    val stale: Boolean,
    /** One sentence for screen readers. */
    val description: String
)

object WidgetModel {
    const val MAX_TEXT = 40
    const val LABEL_REST = "Rest day"
    const val LABEL_LIGHT = "Light day"
    private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    // ---------- parsing ----------

    /** Tidy a piece of text from the page: no control characters, single spaces, at most MAX_TEXT characters, null when empty. */
    fun clean(text: String?): String? {
        if (text == null) return null
        val t = text.replace(Regex("[\\p{Cntrl}\\s]+"), " ").trim()
        if (t.isEmpty()) return null
        return if (t.length > MAX_TEXT) t.substring(0, MAX_TEXT).trimEnd() else t
    }

    /** Null for anything that is not a usable snapshot (bad date, not JSON). Numbers are clamped, text is cleaned. */
    fun parse(json: String?): Snapshot? {
        if (json.isNullOrBlank()) return null
        return try {
            val o = JSONObject(json)
            val date = o.optString("date", "")
            if (!DATE.matches(date)) return null
            val score = if (o.isNull("score") || !o.has("score")) null else Math.round(o.optDouble("score", 0.0)).coerceIn(0L, 100L).toInt()
            Snapshot(
                date = date,
                score = score,
                label = clean(if (o.isNull("label")) null else o.optString("label")),
                steps = Math.round(o.optDouble("steps", 0.0)).coerceIn(0L, 10_000_000L).toInt(),
                stepsTarget = Math.round(o.optDouble("stepsTarget", 0.0)).coerceIn(0L, 10_000_000L).toInt(),
                openHabit = clean(if (o.isNull("openHabit")) null else o.optString("openHabit")),
                updatedAt = o.optLong("updatedAt", 0L)
            )
        } catch (e: Exception) { null }
    }

    fun toJson(s: Snapshot): String {
        val o = JSONObject()
        o.put("date", s.date)
        o.put("score", s.score ?: JSONObject.NULL)
        o.put("label", s.label ?: JSONObject.NULL)
        o.put("steps", s.steps)
        o.put("stepsTarget", s.stepsTarget)
        o.put("openHabit", s.openHabit ?: JSONObject.NULL)
        o.put("updatedAt", s.updatedAt)
        return o.toString()
    }

    // ---------- days ----------

    /** "YYYY-MM-DD" for a moment, in the given time zone (the phone's current one by default). */
    fun dayKey(millis: Long, zone: TimeZone = TimeZone.getDefault()): String {
        val c = Calendar.getInstance(zone)
        c.timeInMillis = millis
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    /** A snapshot is only good for the day it was made on. */
    fun isStale(snapshotDate: String, today: String) = snapshotDate != today

    // ---------- formatting ----------

    fun percentText(score: Int?): String = if (score == null) "" else "${score.coerceIn(0, 100)}%"

    /** 5200 -> "5,200" (the phone's own grouping for the given locale). */
    fun number(n: Int, locale: Locale = Locale.getDefault()): String = NumberFormat.getIntegerInstance(locale).format(n.toLong())

    /** "5,200 / 8,000", or "5,200" when there is no target. */
    fun stepsText(steps: Int, target: Int, locale: Locale = Locale.getDefault()): String =
        if (target > 0) "${number(steps, locale)} / ${number(target, locale)}" else number(steps, locale)

    // ---------- ring geometry (used by the bitmap painter, tested here) ----------

    /** Where the arc starts: straight up. */
    const val ARC_START = -90f
    /** Ring thickness as a share of its size. */
    const val STROKE_RATIO = 0.11f
    /** A ring with anything in it shows at least this much, so a few percent is still visible. */
    const val MIN_SWEEP = 6f

    fun fractionOf(score: Int?): Float = if (score == null) 0f else score.coerceIn(0, 100) / 100f

    fun sweepFor(fraction: Float): Float {
        val f = fraction.coerceIn(0f, 1f)
        if (f <= 0f) return 0f
        return maxOf(MIN_SWEEP, f * 360f)
    }

    /** Left/top/right/bottom of the arc's box inside a square bitmap: the stroke is centred on the box, so it is inset by half the stroke. */
    fun arcInset(size: Float): Float = size * STROKE_RATIO / 2f

    // ---------- the state the layouts show ----------

    /**
     * @param snap the last snapshot from the page, or null if it never sent one
     * @param nativeSteps today's steps counted by the phone itself, or null when step counting is off
     * @param today the phone's current day, "YYYY-MM-DD"
     */
    fun resolve(snap: Snapshot?, nativeSteps: Int?, today: String, t: WidgetTexts = WidgetTexts(), locale: Locale = Locale.getDefault()): WidgetState {
        val fresh = snap != null && !isStale(snap.date, today)
        val target = snap?.stepsTarget ?: 0
        val steps: Int? = if (fresh) (nativeSteps ?: snap!!.steps) else nativeSteps
        val showSteps = steps != null && (target > 0 || steps > 0)
        val stepsShort = if (showSteps) stepsText(steps!!, target, locale) else null
        val stepsLong = stepsShort?.let { "$it ${t.stepsWord}" }

        if (!fresh) {
            val note = if (snap == null) t.setup else t.stale
            val desc = listOfNotNull(t.appName, note, stepsLong?.let { stepsDescription(steps!!, target, t, locale) }, t.tapToOpen).joinToString(". ")
            return WidgetState(0f, false, t.none, stepsShort, stepsLong, note, null, true, desc)
        }
        val s = snap!!
        val kind = when (s.label) { LABEL_REST -> t.rest; LABEL_LIGHT -> t.light; else -> null }
        val center = if (s.score != null) percentText(s.score) else kind ?: t.none
        val note = s.label ?: t.freshStart
        val next = s.openHabit?.let { String.format(Locale.US, t.next, it) }
        val parts = ArrayList<String>()
        parts.add(t.appName)
        parts.add(if (s.score != null) "${t.today} ${s.score} ${t.percentWord}" else s.label ?: t.today)
        if (stepsLong != null) parts.add(stepsDescription(steps!!, target, t, locale))
        if (s.score != null && s.label != null) parts.add(s.label)
        if (next != null) parts.add(next)
        parts.add(t.tapToOpen)
        val fraction = fractionOf(s.score)
        return WidgetState(fraction, s.score != null && s.score >= 100, center, stepsShort, stepsLong, note, next, false, parts.joinToString(". "))
    }

    private fun stepsDescription(steps: Int, target: Int, t: WidgetTexts, locale: Locale): String =
        if (target > 0) "${number(steps, locale)} ${t.ofWord} ${number(target, locale)} ${t.stepsWord}" else "${number(steps, locale)} ${t.stepsWord}"

    /** A narrow widget uses the compact layout. Widths are in dp. */
    const val WIDE_MIN_DP = 190
    fun isWide(minWidthDp: Int) = minWidthDp >= WIDE_MIN_DP
}
