package com.umar.resetlog.steps

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Safety net (every 15 minutes): if the system killed the service, try to bring it back or at least catch up the counter. */
class StepWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val c = applicationContext
        StepTracker.init(c)
        val cfg = StepTracker.config()
        if (!cfg.enabled || !StepTracker.hasActivityPermission(c)) return Result.success()
        if (System.currentTimeMillis() - StepTracker.lastHeartbeat > StepTracker.STALE_MS) {
            if (!StepService.start(c)) StepTracker.catchUp(c)
        }
        StepTracker.scheduleMidnight(c)
        return Result.success()
    }
}
