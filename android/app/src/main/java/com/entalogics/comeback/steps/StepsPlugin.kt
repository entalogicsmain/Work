package com.entalogics.comeback.steps

import android.Manifest
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
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
    override fun load() {
        StepTracker.init(context)
        StepTracker.listener = { notifyListeners("stepsChanged", daysObject()) }
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
        o.put("config", JSObject().put("heightCm", cfg.heightCm).put("strictness", cfg.strictness).put("sensitivity", cfg.sensitivity).put("useLocation", cfg.useLocation))
        return o
    }

    private fun daysObject(): JSObject {
        val days = JSObject()
        for ((k, d) in StepTracker.view()) {
            val h = JSArray(); for (v in d.hourly) h.put(v)
            days.put(k, JSObject().put("steps", d.steps).put("filtered", d.filtered).put("hourly", h))
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
            call.getBoolean("useLocation", old.useLocation) == true
        )
        StepTracker.saveConfig(c)
        if (c.enabled && !old.enabled) {
            StepTracker.resetBaseline()   // counting starts from the moment it is turned on
        }
        if (c.enabled) {
            if (!old.enabled || old.useLocation != c.useLocation) StepService.stop(context)
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

    @PluginMethod fun requestIgnoreBatteryOptimizations(call: PluginCall) {
        val a = activity ?: run { call.reject("No activity"); return }
        call.resolve(JSObject().put("result", DeviceHelper.requestIgnoreBatteryOptimizations(a)))
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
