package com.entalogics.comeback.steps

import android.annotation.SuppressLint
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
import com.entalogics.comeback.R
import java.text.NumberFormat

/**
 * Foreground service (type "health", plus "location" only when the user switched on a location feature) that listens to the motion sensors all day.
 * Hardware step counter: sensor batching (maxReportLatency) keeps battery use very low; the events carry their
 * own timestamps so nothing is lost by batching. Accelerometer fallback: continuous, so it holds a partial wake lock.
 */
class StepService : Service(), SensorEventListener {
    companion object {
        const val ACTION_SAMPLE = "com.entalogics.comeback.steps.SAMPLE"
        const val CHANNEL = "step_counting"
        const val NOTIF_ID = 4201
        private const val BATCH_US = 20_000_000
        private const val WAKE_MS = 60_000L
        private const val LOC_OFF = 0
        private const val LOC_TRIP = 1      // travel distance only, and only while a vehicle / bicycle trip is active
        private const val LOC_SPEED = 2     // "use location to improve accuracy in vehicles": speed check, all day
        /** Balanced power is enough for trip distance and costs far less than GPS. If trips come out short, try HIGH_ACCURACY. */
        private const val TRAVEL_PRIORITY = Priority.PRIORITY_BALANCED_POWER_ACCURACY
        private const val TRAVEL_INTERVAL_MS = 12_000L
        private const val TRAVEL_MIN_DISTANCE_M = 20f

        fun start(ctx: Context, action: String? = null): Boolean {
            // Without the permission the service could not start in the foreground (Android 14+ refuses the "health" type),
            // and a service started with startForegroundService() that does not do so crashes the app.
            if (!StepTracker.hasActivityPermission(ctx)) return false
            return try {
                val i = Intent(ctx, StepService::class.java); if (action != null) i.action = action
                ContextCompat.startForegroundService(ctx, i); true
            } catch (e: Exception) { false }
        }

        /** True while the running service declared the "location" foreground type (needed to use location in the background). */
        @Volatile var locationType = false

        /** Location is needed (now or later during a trip) and allowed. Decides whether the service declares the location type. */
        fun wantsLocation(ctx: Context, cfg: StepTracker.Config) = (cfg.useLocation || cfg.travelDistance) && StepTracker.hasLocationPermission(ctx)

        fun stop(ctx: Context) { try { ctx.stopService(Intent(ctx, StepService::class.java)) } catch (e: Exception) { } }
    }

    private lateinit var sm: SensorManager
    private val handler = Handler(Looper.getMainLooper())
    private var registered = false
    private var wake: PowerManager.WakeLock? = null
    private var accelDetector: AccelStepDetector? = null
    private var locationClient: com.google.android.gms.location.FusedLocationProviderClient? = null
    private var locationCb: LocationCallback? = null
    private var locationMode = LOC_OFF
    private var transitionPi: PendingIntent? = null
    private var lastText = ""
    private var lastNotifAt = 0L
    private val ticker = object : Runnable {
        override fun run() { tickOnce(); renewWake(); syncLocation(); handler.postDelayed(this, 15_000) }
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
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY
        }
        startInForeground(wantsLocation(this, cfg))
        StepTracker.tripListener = { syncLocation() }
        if (!registered) registerAll(cfg)
        syncLocation()
        if (intent?.action == ACTION_SAMPLE) try { sm.flush(this) } catch (e: Exception) { }
        StepTracker.scheduleMidnight(this)
        StepTracker.scheduleWatchdog(this)
        handler.removeCallbacks(ticker); handler.post(ticker)
        return START_STICKY
    }

    /**
     * The foreground type has to match what is granted: Android 14+ throws SecurityException for "health" without the
     * activity permission and for "location" without a location permission. Before Android 14 there is no health type and
     * no check, so we declare "location" only when it is going to be used (background location needs it) and nothing else.
     * Tries the best type first and falls back, so a refusal never leaves the service without startForeground().
     */
    private fun startInForeground(withLocation: Boolean) {
        // (foreground type, whether it includes "location")
        val types = ArrayList<Pair<Int, Boolean>>()
        when {
            Build.VERSION.SDK_INT >= 34 -> {
                if (withLocation) types.add(Pair(ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION, true))
                types.add(Pair(ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH, false))
            }
            Build.VERSION.SDK_INT >= 29 -> {
                if (withLocation) types.add(Pair(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION, true))
                types.add(Pair(0, false))
            }
            else -> types.add(Pair(0, true))   // Android 8 and 9: a foreground service may use location with no type
        }
        for ((t, loc) in types) {
            try {
                ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), t)
                locationType = loc
                return
            } catch (e: Exception) { }
        }
        stopSelf()
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
                    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "comeback:steps").also { it.setReferenceCounted(false); it.acquire(WAKE_MS) }
                }
            }
        } catch (e: Exception) { }
        registerActivityTransitions()
        registered = true
    }

    /** The accelerometer fallback needs the CPU awake; the lock has a short timeout and is renewed by the ticker. */
    private fun renewWake() {
        try { wake?.acquire(WAKE_MS) } catch (e: Exception) { }
    }

    // Guarded by hasActivityPermission(); a revoked permission throws SecurityException, which is caught.
    @SuppressLint("MissingPermission")
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

    /** Location runs for the speed check (all day, if switched on) or for trip distance (only while a trip is active). */
    private fun syncLocation() {
        val cfg = StepTracker.config()
        val want = when {
            !cfg.enabled || !StepTracker.hasLocationPermission(this) -> LOC_OFF
            cfg.useLocation -> LOC_SPEED
            cfg.travelDistance && StepTracker.tripActive() -> LOC_TRIP
            else -> LOC_OFF
        }
        if (want == locationMode) return
        stopLocation()
        if (want != LOC_OFF && startLocation(want)) locationMode = want
    }

    // Guarded by hasLocationPermission() in syncLocation(); a revoked permission throws SecurityException, which is caught.
    @SuppressLint("MissingPermission")
    private fun startLocation(mode: Int): Boolean {
        try {
            val client = LocationServices.getFusedLocationProviderClient(this)
            val cb = object : LocationCallback() {
                override fun onLocationResult(r: LocationResult) {
                    val cfg = StepTracker.config()
                    for (loc in r.locations) {
                        val ts = loc.time.takeIf { it > 0 } ?: System.currentTimeMillis()
                        if (cfg.useLocation && loc.hasSpeed()) StepTracker.speed(ts, loc.speed * 3.6)
                        // coordinates go straight into the distance sum and are not stored
                        if (cfg.travelDistance && loc.hasAccuracy()) StepTracker.fix(ts, loc.latitude, loc.longitude, loc.accuracy.toDouble())
                    }
                }
            }
            val req = if (mode == LOC_SPEED) LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 10_000).setMinUpdateIntervalMillis(5_000).build()
            else LocationRequest.Builder(TRAVEL_PRIORITY, TRAVEL_INTERVAL_MS).setMinUpdateIntervalMillis(TRAVEL_INTERVAL_MS / 2).setMinUpdateDistanceMeters(TRAVEL_MIN_DISTANCE_M).build()
            client.requestLocationUpdates(req, cb, Looper.getMainLooper())
            locationClient = client; locationCb = cb
            return true
        } catch (e: SecurityException) { } catch (e: Exception) { }
        return false
    }

    @SuppressLint("MissingPermission")
    private fun stopLocation() {
        try { locationCb?.let { locationClient?.removeLocationUpdates(it) } } catch (e: Exception) { }
        locationCb = null; locationClient = null; locationMode = LOC_OFF
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
        com.entalogics.comeback.widget.WidgetUpdater.refreshFromSteps(this)   // home-screen widget: at most once a minute, off the main thread
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
            ch.description = "Quiet notification while Comeback counts your steps"; ch.setShowBadge(false)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(text: String = lastText.ifEmpty { "Counting steps · ${NumberFormat.getIntegerInstance().format(StepTracker.today().steps)} today" }): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_comeback).setContentTitle(text).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW).setCategory(NotificationCompat.CATEGORY_SERVICE).setContentIntent(pi).build()
    }

    @SuppressLint("MissingPermission")
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try { sm.unregisterListener(this) } catch (e: Exception) { }
        stopLocation()
        StepTracker.tripListener = null
        locationType = false
        try { transitionPi?.let { ActivityRecognition.getClient(this).removeActivityTransitionUpdates(it) } } catch (e: Exception) { }
        try { wake?.let { if (it.isHeld) it.release() } } catch (e: Exception) { }
        StepTracker.persist(true)
        super.onDestroy()
    }
}
