package com.entalogics.comeback.steps

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Battery-optimisation and brand-specific "autostart" screens that decide whether background counting survives. */
object DeviceHelper {
    fun brand(): String {
        val m = (Build.MANUFACTURER ?: "").lowercase(); val b = (Build.BRAND ?: "").lowercase()
        val s = "$m $b"
        return when {
            s.contains("xiaomi") || s.contains("redmi") || s.contains("poco") -> "xiaomi"
            s.contains("oppo") || s.contains("realme") || s.contains("oneplus") -> "oppo"
            s.contains("vivo") || s.contains("iqoo") -> "vivo"
            s.contains("samsung") -> "samsung"
            s.contains("huawei") || s.contains("honor") -> "huawei"
            s.contains("infinix") || s.contains("tecno") || s.contains("itel") || s.contains("transsion") -> "transsion"
            else -> "other"
        }
    }

    fun ignoringBatteryOptimizations(c: Context): Boolean = try {
        (c.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(c.packageName)
    } catch (e: Exception) { false }

    private fun launch(a: Activity, i: Intent): Boolean = try {
        // No resolveActivity(): on Android 11+ package visibility hides other apps' screens from it. Starting and catching works.
        a.startActivity(i); true
    } catch (e: Exception) { false }

    // Sideloaded personal app, not distributed through Google Play, so the Play policy on this permission does not apply.
    @SuppressLint("BatteryLife")
    fun requestIgnoreBatteryOptimizations(a: Activity): String {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${a.packageName}"))
        if (launch(a, direct)) return "dialog"
        if (launch(a, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) return "settings"
        return if (openAppSettings(a)) "app" else "none"
    }

    fun openAppSettings(a: Activity): Boolean =
        launch(a, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${a.packageName}")))

    fun openBatterySettings(a: Activity): Boolean =
        launch(a, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) || launch(a, Intent(Intent.ACTION_POWER_USAGE_SUMMARY)) || openAppSettings(a)

    /** Opens the brand's autostart / background-activity screen when one is known; otherwise the app's settings page. */
    fun openAutostart(a: Activity): String {
        val comps: List<Pair<String, String>> = when (brand()) {
            "xiaomi" -> listOf("com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity")
            "oppo" -> listOf("com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity", "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity", "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity")
            "vivo" -> listOf("com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity", "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
            "samsung" -> listOf("com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity", "com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity")
            "huawei" -> listOf("com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity", "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity")
            "transsion" -> listOf("com.transsion.phonemaster" to "com.cyin.himgr.autostart.AutoStartActivity", "com.itel.autostart" to "com.itel.autostart.AutoStartActivity")
            else -> emptyList()
        }
        for ((pkg, cls) in comps) {
            val i = Intent().setComponent(ComponentName(pkg, cls))
            if (launch(a, i)) return "brand"
        }
        return if (openBatterySettings(a)) "battery" else "none"
    }
}
