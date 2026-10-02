package com.umar.resetlog.steps

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Process-wide owner of the step engine. The foreground service, the boot / activity / alarm receivers, the
 * WorkManager watchdog and the Capacitor plugin all go through here, so they share one state that is saved
 * to native storage (SharedPreferences), not to the WebView.
 */
// appCtx is always the application context, so holding it statically does not leak an Activity.
@SuppressLint("StaticFieldLeak")
object StepTracker {
    private const val PREFS = "resetlog_steps"
    private const val K_ENGINE = "engine"
    private const val K_CFG = "config"
    private const val K_SENSORS = "sensors"
    const val STALE_MS = 4 * 60_000L

    class Config(
        var enabled: Boolean = false,
        var heightCm: Int = 180,
        var strictness: String = "balanced",
        var sensitivity: String = "normal",
        var useLocation: Boolean = false
    )

    private val lock = Any()
    private var appCtx: Context? = null
    private var engine = StepEngine()
    private var cfg = Config()
    private var lastPersist = 0L
    private var dirty = false
    private var lastNotifyJs = 0L

    @Volatile var lastHeartbeat = 0L
    /** Called (on the main thread) when totals changed; the plugin forwards it to the web app. */
    @Volatile var listener: (() -> Unit)? = null

    fun init(c: Context) {
        synchronized(lock) {
            if (appCtx != null) return
            appCtx = c.applicationContext
            val p = prefs()
            p.getString(K_CFG, null)?.let { s ->
                try {
                    val o = JSONObject(s)
                    cfg = Config(o.optBoolean("enabled"), o.optInt("heightCm", 180), o.optString("strictness", "balanced"), o.optString("sensitivity", "normal"), o.optBoolean("useLocation"))
                } catch (e: Exception) { }
            }
            p.getString(K_ENGINE, null)?.let { s -> try { engine.loadJson(s) } catch (e: Exception) { engine = StepEngine() } }
            engine.applyStrictness(Strictness.of(cfg.strictness))
            lastHeartbeat = p.getLong("heartbeat", 0)
        }
    }

    private fun prefs() = appCtx!!.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun config(): Config = synchronized(lock) { cfg }

    fun saveConfig(c: Config) = synchronized(lock) {
        cfg = c
        engine.applyStrictness(Strictness.of(c.strictness))
        prefs().edit().putString(K_CFG, JSONObject().put("enabled", c.enabled).put("heightCm", c.heightCm).put("strictness", c.strictness).put("sensitivity", c.sensitivity).put("useLocation", c.useLocation).toString()).apply()
    }

    fun setSource(s: CountSource) = synchronized(lock) { if (engine.source != s) { engine.source = s; dirty = true } }
    fun source(): CountSource = synchronized(lock) { engine.source }

    /** Counting begins now: forget older sensor readings so earlier steps are not pulled in. */
    fun resetBaseline() = synchronized(lock) { engine.lastTotal = -1; dirty = true; persist(true) }

    // ---------- events (all times are wall-clock ms) ----------
    fun counter(ts: Long, total: Long) = synchronized(lock) { engine.onCounterReading(ts, total); touch() }
    fun detector(ts: Long) = synchronized(lock) { engine.onDetectorStep(ts); touch() }
    fun accelStep(ts: Long, amp: Double) = synchronized(lock) { engine.onAccelStep(ts, amp); touch() }
    fun activity(ts: Long, type: ActivityType, enter: Boolean) = synchronized(lock) { engine.onActivity(ts, type, enter); dirty = true; persist(true); notifyJs(true) }
    fun speed(ts: Long, kmh: Double) = synchronized(lock) { engine.onSpeed(ts, kmh); dirty = true }
    fun tick(now: Long = System.currentTimeMillis()) = synchronized(lock) { engine.tick(now); lastHeartbeat = now; touch(); persist(false) }

    private fun touch() { dirty = true; notifyJs(false) }
    private fun notifyJs(force: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastNotifyJs < 5_000) return
        lastNotifyJs = now
        val l = listener ?: return
        Handler(Looper.getMainLooper()).post { try { l() } catch (e: Exception) { } }
    }

    fun persist(force: Boolean) = synchronized(lock) {
        val now = SystemClock.elapsedRealtime()
        if (!dirty && !force) return
        if (!force && now - lastPersist < 20_000) return
        lastPersist = now; dirty = false
        prefs().edit().putString(K_ENGINE, engine.toJson()).putLong("heartbeat", lastHeartbeat).apply()
    }

    // ---------- views ----------
    fun view(): Map<String, DayData> = synchronized(lock) { engine.tick(System.currentTimeMillis()); engine.view(System.currentTimeMillis()) }
    fun today(): DayData = synchronized(lock) { engine.today(System.currentTimeMillis()) }
    fun inVehicle(): Boolean = synchronized(lock) { engine.inVehicle }

    // ---------- device capabilities and health ----------
    fun hasActivityPermission(c: Context): Boolean = Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(c, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
    fun hasLocationPermission(c: Context): Boolean = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun playServicesOk(c: Context): Boolean = try { GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(c) == ConnectionResult.SUCCESS } catch (e: Throwable) { false }

    fun sensors(c: Context): JSONObject {
        val sm = c.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        return JSONObject().put("stepCounter", sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null)
            .put("stepDetector", sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) != null)
            .put("accelerometer", sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)
            .put("activityRecognition", playServicesOk(c))
    }

    /** working | paused_battery | permission_missing | paused_vehicle | off */
    fun health(c: Context): String {
        val conf = config()
        if (!conf.enabled) return "off"
        if (!hasActivityPermission(c)) return "permission_missing"
        if (inVehicle()) return "paused_vehicle"
        if (System.currentTimeMillis() - lastHeartbeat > STALE_MS) return "paused_battery"
        return "working"
    }

    // ---------- safety nets ----------
    fun scheduleWatchdog(c: Context) {
        try {
            val req = PeriodicWorkRequest.Builder(StepWorker::class.java, 15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(c).enqueueUniquePeriodicWork("step-watchdog", ExistingPeriodicWorkPolicy.KEEP, req)
        } catch (e: Exception) { }
    }
    fun cancelWatchdog(c: Context) { try { WorkManager.getInstance(c).cancelUniqueWork("step-watchdog") } catch (e: Exception) { } }

    private fun midnightIntent(c: Context) = PendingIntent.getBroadcast(c, 9, Intent(c, MidnightReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    fun scheduleMidnight(c: Context) {
        try {
            val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val cal = Calendar.getInstance(); cal.add(Calendar.DAY_OF_YEAR, 1)
            cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 1); cal.set(Calendar.MILLISECOND, 0)
            val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, midnightIntent(c))
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, midnightIntent(c))
        } catch (e: Exception) { }
    }
    fun cancelMidnight(c: Context) { try { (c.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(midnightIntent(c)) } catch (e: Exception) { } }

    /** Wall-clock time of a sensor event timestamp (SystemClock.elapsedRealtimeNanos based). */
    fun wallFromElapsedNanos(eventNanos: Long): Long = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - eventNanos) / 1_000_000

    /**
     * Used when the foreground service could not be started: read the hardware counter once so the steps taken
     * meanwhile are not lost. Rhythm cannot be judged for a long gap, so only the vehicle windows apply.
     */
    fun catchUp(c: Context) {
        try {
            init(c)
            if (!config().enabled || !hasActivityPermission(c)) return
            val sm = c.getSystemService(Context.SENSOR_SERVICE) as SensorManager
            val counter = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return
            val latch = CountDownLatch(1)
            val l = object : SensorEventListener {
                override fun onSensorChanged(e: SensorEvent) { counter(wallFromElapsedNanos(e.timestamp), e.values[0].toLong()); latch.countDown() }
                override fun onAccuracyChanged(s: Sensor?, a: Int) {}
            }
            sm.registerListener(l, counter, SensorManager.SENSOR_DELAY_NORMAL, Handler(Looper.getMainLooper()))
            latch.await(3, TimeUnit.SECONDS)
            sm.unregisterListener(l)
            tick(); persist(true)
        } catch (e: Exception) { }
    }
}
