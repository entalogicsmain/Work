package com.umar.resetlog.steps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.umar.resetlog.R
import java.text.NumberFormat

/**
 * Foreground service (type "health") that listens to the motion sensors all day.
 * Hardware step counter: sensor batching (maxReportLatency) keeps battery use very low; the events carry their
 * own timestamps so nothing is lost by batching. Accelerometer fallback: continuous, so it holds a partial wake lock.
 */
class StepService : Service(), SensorEventListener {
    companion object {
        const val ACTION_SAMPLE = "com.umar.resetlog.steps.SAMPLE"
        const val CHANNEL = "step_counting"
        const val NOTIF_ID = 4201
        private const val BATCH_US = 20_000_000

        fun start(ctx: Context, action: String? = null): Boolean = try {
            val i = Intent(ctx, StepService::class.java); if (action != null) i.action = action
            ContextCompat.startForegroundService(ctx, i); true
        } catch (e: Exception) { false }

        fun stop(ctx: Context) { try { ctx.stopService(Intent(ctx, StepService::class.java)) } catch (e: Exception) { } }
    }

    private lateinit var sm: SensorManager
    private val handler = Handler(Looper.getMainLooper())
    private var registered = false
    private var wake: PowerManager.WakeLock? = null
    private var accelDetector: AccelStepDetector? = null
    private var locationClient: com.google.android.gms.location.FusedLocationProviderClient? = null
    private var locationCb: LocationCallback? = null
    private var transitionPi: PendingIntent? = null
    private var lastText = ""
    private var lastNotifAt = 0L
    private val ticker = object : Runnable {
        override fun run() { tickOnce(); handler.postDelayed(this, 15_000) }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        StepTracker.init(this)
        sm = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val cfg = StepTracker.config()
        if (!cfg.enabled || !StepTracker.hasActivityPermission(this)) {
            // still must call startForeground within 5 s of startForegroundService
            startInForeground(false)
            stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY
        }
        startInForeground(cfg.useLocation && StepTracker.hasLocationPermission(this))
        if (!registered) registerAll(cfg)
        if (intent?.action == ACTION_SAMPLE) try { sm.flush(this) } catch (e: Exception) { }
        StepTracker.scheduleMidnight(this)
        StepTracker.scheduleWatchdog(this)
        handler.removeCallbacks(ticker); handler.post(ticker)
        return START_STICKY
    }

    private fun startInForeground(withLocation: Boolean) {
        val type = when {
            Build.VERSION.SDK_INT >= 34 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or (if (withLocation) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
            Build.VERSION.SDK_INT >= 29 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST
            else -> 0
        }
        try { ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type) }
        catch (e: Exception) { try { startForeground(NOTIF_ID, buildNotification()) } catch (x: Exception) { stopSelf() } }
    }

    private fun registerAll(cfg: StepTracker.Config) {
        val counter = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        val detector = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
        val source = when { counter != null -> CountSource.COUNTER; detector != null -> CountSource.DETECTOR; else -> CountSource.ACCEL }
        StepTracker.setSource(source)
        try {
            if (counter != null) sm.registerListener(this, counter, SensorManager.SENSOR_DELAY_NORMAL, BATCH_US)
            if (detector != null) sm.registerListener(this, detector, SensorManager.SENSOR_DELAY_NORMAL, BATCH_US)
            if (source == CountSource.ACCEL) {
                val acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
                if (acc != null) {
                    accelDetector = AccelStepDetector(AccelStepDetector.Sensitivity.of(cfg.sensitivity)) { ts, amp -> StepTracker.accelStep(ts, amp) }
                    sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_GAME, 1_000_000)
                    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "resetlog:steps").also { it.acquire() }
                }
            }
        } catch (e: Exception) { }
        registerActivityTransitions()
        if (cfg.useLocation && StepTracker.hasLocationPermission(this)) startLocation()
        registered = true
    }

    private fun registerActivityTransitions() {
        if (!StepTracker.playServicesOk(this) || !StepTracker.hasActivityPermission(this)) return   // e.g. Huawei: other layers only
        try {
            val types = listOf(DetectedActivity.IN_VEHICLE, DetectedActivity.ON_BICYCLE, DetectedActivity.WALKING, DetectedActivity.RUNNING, DetectedActivity.STILL)
            val list = ArrayList<ActivityTransition>()
            for (t in types) for (k in listOf(ActivityTransition.ACTIVITY_TRANSITION_ENTER, ActivityTransition.ACTIVITY_TRANSITION_EXIT))
                list.add(ActivityTransition.Builder().setActivityType(t).setActivityTransition(k).build())
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(this, 7, Intent(this, ActivityTransitionReceiver::class.java), flags)
            transitionPi = pi
            ActivityRecognition.getClient(this).requestActivityTransitionUpdates(ActivityTransitionRequest(list), pi)
        } catch (e: Exception) { }
    }

    private fun startLocation() {
        try {
            val client = LocationServices.getFusedLocationProviderClient(this)
            val cb = object : LocationCallback() {
                override fun onLocationResult(r: LocationResult) {
                    for (loc in r.locations) if (loc.hasSpeed()) StepTracker.speed(loc.time.takeIf { it > 0 } ?: System.currentTimeMillis(), loc.speed * 3.6)
                }
            }
            val req = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 10_000).setMinUpdateIntervalMillis(5_000).build()
            client.requestLocationUpdates(req, cb, Looper.getMainLooper())
            locationClient = client; locationCb = cb
        } catch (e: SecurityException) { } catch (e: Exception) { }
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_STEP_COUNTER -> StepTracker.counter(StepTracker.wallFromElapsedNanos(e.timestamp), e.values[0].toLong())
            Sensor.TYPE_STEP_DETECTOR -> StepTracker.detector(StepTracker.wallFromElapsedNanos(e.timestamp))
            Sensor.TYPE_ACCELEROMETER -> accelDetector?.onSample(StepTracker.wallFromElapsedNanos(e.timestamp), e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
        }
    }
    override fun onAccuracyChanged(s: Sensor?, a: Int) {}

    private fun tickOnce() {
        StepTracker.tick()
        val steps = StepTracker.today().steps
        val text = "Counting steps · ${NumberFormat.getIntegerInstance().format(steps)} today"
        val now = SystemClock.elapsedRealtime()
        if (text != lastText && now - lastNotifAt > 20_000) {
            lastText = text; lastNotifAt = now
            try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, buildNotification(text)) } catch (e: Exception) { }
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(CHANNEL, "Step counting", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Quiet notification while Reset Log counts your steps"; ch.setShowBadge(false)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(text: String = lastText.ifEmpty { "Counting steps · ${NumberFormat.getIntegerInstance().format(StepTracker.today().steps)} today" }): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_resetlog).setContentTitle(text).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW).setCategory(NotificationCompat.CATEGORY_SERVICE).setContentIntent(pi).build()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try { sm.unregisterListener(this) } catch (e: Exception) { }
        try { locationCb?.let { locationClient?.removeLocationUpdates(it) } } catch (e: Exception) { }
        try { transitionPi?.let { ActivityRecognition.getClient(this).removeActivityTransitionUpdates(it) } } catch (e: Exception) { }
        try { wake?.let { if (it.isHeld) it.release() } } catch (e: Exception) { }
        StepTracker.persist(true)
        super.onDestroy()
    }
}
