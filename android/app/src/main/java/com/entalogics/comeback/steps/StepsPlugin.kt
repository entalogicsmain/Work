package com.entalogics.comeback.steps

import android.Manifest
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import androidx.activity.result.ActivityResult
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/** Capacitor bridge for the step counter. The web app only ever sees plain daily totals and a status. */
@CapacitorPlugin(
    name = "Steps",
    permissions = [
        Permission(strings = [Manifest.permission.ACTIVITY_RECOGNITION], alias = "activity"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION], alias = "location")
    ]
)
class StepsPlugin : Plugin() {
    // The page only hears about new totals while the app is on screen; in the background the service just counts.
    @Volatile private var visible = true
    override fun handleOnStart() {
        visible = true
        // Android 14+ only lets a service take the "location" foreground type while the app is on screen. If it had to start
        // without it (boot, alarm) and a location feature is on, take it now so trips can be measured in the background.
        val cfg = StepTracker.config()
        if (cfg.enabled && StepTracker.hasActivityPermission(context) && StepService.wantsLocation(context, cfg) && !StepService.locationType && StepTracker.lastHeartbeat > 0) StepService.start(context)
        super.handleOnStart()
    }
    override fun handleOnStop() { visible = false; super.handleOnStop() }

    override fun load() {
        StepTracker.init(context)
        StepTracker.listener = { if (visible) notifyListeners("stepsChanged", daysObject()) }
        val cfg = StepTracker.config()
        if (cfg.enabled && StepTracker.hasActivityPermission(context)) {
            if (System.currentTimeMillis() - StepTracker.lastHeartbeat > StepTracker.STALE_MS) StepService.start(context)
            StepTracker.scheduleWatchdog(context)
        }
    }

    private fun status(): JSObject {
        val cfg = StepTracker.config()
        val o = JSObject()
        o.put("supported", JSObject(StepTracker.sensors(context).toString()))
        o.put("source", StepTracker.source().key)
        o.put("enabled", cfg.enabled)
        o.put("health", StepTracker.health(context))
        o.put("inVehicle", StepTracker.inVehicle())
        o.put("activityPermission", StepTracker.hasActivityPermission(context))
        o.put("locationPermission", StepTracker.hasLocationPermission(context))
        o.put("batteryIgnored", DeviceHelper.ignoringBatteryOptimizations(context))
        o.put("brand", DeviceHelper.brand())
        o.put("manufacturer", Build.MANUFACTURER)
        o.put("model", Build.MODEL)
        o.put("sdk", Build.VERSION.SDK_INT)
        val t = StepTracker.today()
        o.put("todaySteps", t.steps); o.put("filteredToday", t.filtered)
        o.put("config", JSObject().put("heightCm", cfg.heightCm).put("strictness", cfg.strictness).put("sensitivity", cfg.sensitivity).put("useLocation", cfg.useLocation).put("travelDistance", cfg.travelDistance))
        o.put("travelDistance", cfg.travelDistance && StepTracker.hasLocationPermission(context))
        return o
    }

    private fun daysObject(): JSObject {
        val days = JSObject()
        for ((k, d) in StepTracker.view()) {
            val h = JSArray(); for (v in d.hourly) h.put(v)
            days.put(k, JSObject().put("steps", d.steps).put("filtered", d.filtered).put("hourly", h))
        }
        // Travel record: minutes per mode and trips (no coordinates ever). Days with only travel data are listed too.
        for ((k, t) in StepTracker.travelView()) {
            val day = if (days.has(k)) days.getJSObject(k)!! else JSObject().put("steps", 0).put("filtered", 0).put("hourly", JSArray(IntArray(24).toList())).also { days.put(k, it) }
            val trips = JSArray()
            for (tr in t.trips) {
                val o = JSObject().put("mode", tr.mode).put("start", tr.start).put("end", tr.end).put("min", tr.min)
                if (tr.km != null) o.put("km", tr.km)
                if (tr.avgKmh != null) o.put("avg_kmh", tr.avgKmh)
                trips.put(o)
            }
            day.put("travel", JSObject().put("walk_min", t.walkMin).put("run_min", t.runMin).put("bike_min", t.bikeMin).put("vehicle_min", t.vehicleMin).put("trips", trips))
        }
        val o = JSObject(); o.put("days", days); o.put("health", StepTracker.health(context)); o.put("inVehicle", StepTracker.inVehicle())
        return o
    }

    @PluginMethod fun getStatus(call: PluginCall) { call.resolve(status()) }
    @PluginMethod fun getDays(call: PluginCall) {
        if (StepTracker.config().enabled) StepTracker.tick()
        call.resolve(daysObject())
    }
    @PluginMethod fun getDeviceInfo(call: PluginCall) {
        call.resolve(JSObject().put("brand", DeviceHelper.brand()).put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT).put("batteryIgnored", DeviceHelper.ignoringBatteryOptimizations(context)))
    }

    @PluginMethod fun configure(call: PluginCall) {
        val old = StepTracker.config()
        val c = StepTracker.Config(
            call.getBoolean("enabled", old.enabled) == true,
            call.getInt("heightCm", old.heightCm) ?: old.heightCm,
            call.getString("strictness", old.strictness) ?: old.strictness,
            call.getString("sensitivity", old.sensitivity) ?: old.sensitivity,
            call.getBoolean("useLocation", old.useLocation) == true,
            old.travelDistance
        )
        StepTracker.saveConfig(c)
        if (c.enabled && !old.enabled) {
            StepTracker.resetBaseline()   // counting starts from the moment it is turned on
        }
        if (c.enabled) {
            if (!old.enabled || old.useLocation != c.useLocation) StepService.stop(context)   // the foreground type depends on it
            if (StepTracker.hasActivityPermission(context)) {
                StepService.start(context)
                StepTracker.scheduleWatchdog(context)
                StepTracker.scheduleMidnight(context)
            }
        } else {
            StepService.stop(context)
            StepTracker.cancelWatchdog(context); StepTracker.cancelMidnight(context)
        }
        call.resolve(status())
    }

    @PluginMethod fun requestActivityPermission(call: PluginCall) {
        if (StepTracker.hasActivityPermission(context)) { call.resolve(JSObject().put("granted", true)); return }
        requestPermissionForAlias("activity", call, "activityPermissionResult")
    }
    @PermissionCallback private fun activityPermissionResult(call: PluginCall) {
        val ok = StepTracker.hasActivityPermission(context)
        call.resolve(JSObject().put("granted", ok).put("canAskAgain", !ok && activity?.let { androidx.core.app.ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.ACTIVITY_RECOGNITION) } == true))
    }

    @PluginMethod fun requestLocationPermission(call: PluginCall) {
        if (StepTracker.hasLocationPermission(context)) { call.resolve(JSObject().put("granted", true)); return }
        requestPermissionForAlias("location", call, "locationPermissionResult")
    }
    @PermissionCallback private fun locationPermissionResult(call: PluginCall) { call.resolve(JSObject().put("granted", StepTracker.hasLocationPermission(context))) }

    /**
     * Opt-in trip distance. Turning it on needs the location permission (ask with requestLocationPermission first);
     * without it the switch stays off. Location then runs only while a vehicle or bicycle trip is active.
     */
    @PluginMethod fun setTravelDistance(call: PluginCall) {
        val old = StepTracker.config()
        val want = call.getBoolean("enabled", false) == true
        val on = want && StepTracker.hasLocationPermission(context)
        if (on != old.travelDistance) {
            val c = StepTracker.Config(old.enabled, old.heightCm, old.strictness, old.sensitivity, old.useLocation, on)
            StepTracker.saveConfig(c)
            if (c.enabled && StepTracker.hasActivityPermission(context)) { StepService.stop(context); StepService.start(context) }   // the foreground type depends on it
        }
        call.resolve(JSObject().put("enabled", on).put("locationPermission", StepTracker.hasLocationPermission(context)))
    }

    /** Resolves when the user has answered the system dialog (or left the settings screen), with whether the exemption is now on. */
    @PluginMethod fun requestIgnoreBatteryOptimizations(call: PluginCall) {
        val a = activity ?: run { call.reject("No activity"); return }
        if (DeviceHelper.ignoringBatteryOptimizations(context)) { call.resolve(JSObject().put("result", "already").put("granted", true)); return }
        for (intent in DeviceHelper.batteryIntents(a)) {
            try { startActivityForResult(call, intent, "batteryDialogResult"); return } catch (e: Exception) { }
        }
        call.resolve(JSObject().put("result", DeviceHelper.requestIgnoreBatteryOptimizations(a)).put("granted", false))
    }
    @ActivityCallback private fun batteryDialogResult(call: PluginCall?, result: ActivityResult) {
        call?.resolve(JSObject().put("result", "dialog").put("granted", DeviceHelper.ignoringBatteryOptimizations(context)))
    }

    /** target: "app" | "battery" | "autostart" */
    @PluginMethod fun openSettings(call: PluginCall) {
        val a = activity ?: run { call.reject("No activity"); return }
        val result = when (call.getString("target", "app")) {
            "autostart" -> DeviceHelper.openAutostart(a)
            "battery" -> if (DeviceHelper.openBatterySettings(a)) "battery" else "none"
            else -> if (DeviceHelper.openAppSettings(a)) "app" else "none"
        }
        call.resolve(JSObject().put("result", result))
    }

    override fun handleOnDestroy() { StepTracker.listener = null; super.handleOnDestroy() }
}
