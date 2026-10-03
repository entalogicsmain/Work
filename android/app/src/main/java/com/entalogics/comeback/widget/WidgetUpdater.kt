package com.entalogics.comeback.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import com.entalogics.comeback.R
import com.entalogics.comeback.steps.StepTracker
import java.util.concurrent.Executors

/**
 * Draws the widget. All work runs on one background thread (never the main thread) and uses no network and no location.
 * Triggers: a new snapshot from the page, the step service saving (at most once a minute, and only when the steps changed),
 * the midnight alarm / date change, and the launcher asking for an update.
 */
object WidgetUpdater {
    private const val STEPS_MIN_GAP_MS = 60_000L
    private const val ARC_PX = 256
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "comeback-widget").also { it.isDaemon = true } }

    @Volatile private var lastStepsRun = 0L
    @Volatile private var lastDrawnSteps = Int.MIN_VALUE
    private var arcKey = ""
    private var arcBitmap: Bitmap? = null

    /** Redraw now (a new snapshot, midnight, the launcher asked). If [pending] is given it is finished when the work is done. */
    fun refresh(ctx: Context, pending: BroadcastReceiver.PendingResult? = null) {
        val app = ctx.applicationContext
        try {
            io.execute { try { renderAll(app, false) } catch (e: Throwable) { } finally { try { pending?.finish() } catch (e: Throwable) { } } }
        } catch (e: Throwable) { try { pending?.finish() } catch (x: Throwable) { } }
    }

    /** Called by the step service every time it ticks. Does nothing unless a minute has passed, and the widget is placed. */
    fun refreshFromSteps(ctx: Context) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastStepsRun < STEPS_MIN_GAP_MS) return
        lastStepsRun = now
        val app = ctx.applicationContext
        try { io.execute { try { if (WidgetStore.isActive(app)) renderAll(app, true) } catch (e: Throwable) { } } } catch (e: Throwable) { }
    }

    private fun renderAll(ctx: Context, onlyIfStepsChanged: Boolean) {
        val mgr = AppWidgetManager.getInstance(ctx)
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, ComebackWidgetProvider::class.java))
        if (ids.isEmpty()) return
        StepTracker.init(ctx)
        val native: Int? = if (StepTracker.config().enabled) StepTracker.today().steps else null
        if (onlyIfStepsChanged && native != null && native == lastDrawnSteps) return
        lastDrawnSteps = native ?: Int.MIN_VALUE
        val state = WidgetModel.resolve(WidgetStore.load(ctx), native, WidgetModel.dayKey(System.currentTimeMillis()), texts(ctx))
        for (id in ids) {
            val wide = WidgetModel.isWide(widthDp(mgr.getAppWidgetOptions(id)))
            mgr.updateAppWidget(id, build(ctx, state, wide))
        }
    }

    private fun widthDp(o: Bundle?): Int = o?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0

    private fun texts(c: Context) = WidgetTexts(
        stale = c.getString(R.string.widget_stale), setup = c.getString(R.string.widget_setup), freshStart = c.getString(R.string.widget_fresh_start),
        stepsWord = c.getString(R.string.widget_steps_word), next = c.getString(R.string.widget_next), rest = c.getString(R.string.widget_rest),
        light = c.getString(R.string.widget_light), none = c.getString(R.string.widget_none), tapToOpen = c.getString(R.string.widget_tap_to_open),
        appName = c.getString(R.string.app_name), today = c.getString(R.string.widget_today), percentWord = c.getString(R.string.widget_percent_word),
        ofWord = c.getString(R.string.widget_of_word)
    )

    private fun build(ctx: Context, s: WidgetState, wide: Boolean): RemoteViews {
        val rv = RemoteViews(ctx.packageName, if (wide) R.layout.widget_wide else R.layout.widget_compact)
        rv.setTextViewText(R.id.w_percent, s.centerText)
        val steps = if (wide) s.stepsLong else s.stepsShort
        rv.setTextViewText(R.id.w_steps, steps ?: "")
        rv.setViewVisibility(R.id.w_steps, if (steps == null) View.GONE else View.VISIBLE)
        if (wide) {
            rv.setTextViewText(R.id.w_note, s.note ?: "")
            rv.setTextViewText(R.id.w_next, s.nextLine ?: "")
            rv.setViewVisibility(R.id.w_next, if (s.nextLine == null) View.GONE else View.VISIBLE)
        } else {
            // the compact widget has room for one more line only when there is something to explain (a new day, or nothing sent yet)
            rv.setTextViewText(R.id.w_note, if (s.stale) s.note ?: "" else "")
            rv.setViewVisibility(R.id.w_note, if (s.stale) View.VISIBLE else View.GONE)
        }
        val bmp = arc(ctx, s.fraction, s.done)
        if (bmp == null) rv.setViewVisibility(R.id.w_arc, View.INVISIBLE) else { rv.setViewVisibility(R.id.w_arc, View.VISIBLE); rv.setImageViewBitmap(R.id.w_arc, bmp) }
        rv.setContentDescription(R.id.widget_root, s.description)
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        if (launch != null) {
            val pi = PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            rv.setOnClickPendingIntent(R.id.widget_root, pi)
        }
        return rv
    }

    /** The filled part of the ring as a transparent bitmap (the grey track is a drawable). One bitmap is kept: every widget shows the same numbers. */
    @Synchronized private fun arc(ctx: Context, fraction: Float, done: Boolean): Bitmap? {
        val sweep = WidgetModel.sweepFor(fraction)
        if (sweep <= 0f) return null
        val key = "$sweep/$done"
        arcBitmap?.let { if (key == arcKey) return it }
        val bmp = Bitmap.createBitmap(ARC_PX, ARC_PX, Bitmap.Config.ARGB_8888)
        val stroke = ARC_PX * WidgetModel.STROKE_RATIO
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = stroke; strokeCap = Paint.Cap.ROUND
            color = ctx.getColor(if (done) R.color.widget_arc_done else R.color.widget_arc)
        }
        val inset = WidgetModel.arcInset(ARC_PX.toFloat())
        Canvas(bmp).drawArc(RectF(inset, inset, ARC_PX - inset, ARC_PX - inset), WidgetModel.ARC_START, sweep, false, p)
        arcBitmap = bmp; arcKey = key
        return bmp
    }
}
