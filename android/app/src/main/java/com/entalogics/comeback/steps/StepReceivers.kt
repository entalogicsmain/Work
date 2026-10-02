package com.entalogics.comeback.steps

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/** After a reboot or an app update: start counting again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        StepTracker.init(ctx)
        val cfg = StepTracker.config()
        if (cfg.enabled && StepTracker.hasActivityPermission(ctx)) {
            if (!StepService.start(ctx)) StepTracker.catchUp(ctx)
            StepTracker.scheduleWatchdog(ctx)
            StepTracker.scheduleMidnight(ctx)
        }
    }
}

/** Activity Recognition transitions (IN_VEHICLE, ON_BICYCLE, WALKING, RUNNING, STILL). On-device, Google Play services. */
class ActivityTransitionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        StepTracker.init(ctx)
        if (!ActivityTransitionResult.hasResult(intent)) return
        val result = ActivityTransitionResult.extractResult(intent) ?: return
        for (e in result.transitionEvents) {
            val type = when (e.activityType) {
                DetectedActivity.IN_VEHICLE -> ActivityType.IN_VEHICLE
                DetectedActivity.ON_BICYCLE -> ActivityType.ON_BICYCLE
                DetectedActivity.WALKING -> ActivityType.WALKING
                DetectedActivity.RUNNING -> ActivityType.RUNNING
                DetectedActivity.STILL -> ActivityType.STILL
                else -> continue
            }
            StepTracker.activity(StepTracker.wallFromElapsedNanos(e.elapsedRealTimeNanos), type, e.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER)
        }
        // receiving these events is one of the cases where Android lets us restart the service
        val cfg = StepTracker.config()
        if (cfg.enabled && System.currentTimeMillis() - StepTracker.lastHeartbeat > StepTracker.STALE_MS) StepService.start(ctx)
    }
}

/** Fires just after midnight: take a reading so the old day is closed accurately, then book the next alarm. */
class MidnightReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        StepTracker.init(ctx)
        if (StepTracker.config().enabled) {
            if (!StepService.start(ctx, StepService.ACTION_SAMPLE)) StepTracker.catchUp(ctx)
            StepTracker.scheduleMidnight(ctx)
        }
    }
}
