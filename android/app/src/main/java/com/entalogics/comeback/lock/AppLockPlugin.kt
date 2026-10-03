package com.entalogics.comeback.lock

import android.content.Context
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * App lock. The page decides when to lock (see www/js/lock.js); this plugin only asks Android to check who is holding the phone.
 *
 * isAvailable()                       -> { available, reason }   reason: ok, none_enrolled, no_hardware, hw_unavailable, update_required, unsupported, unknown
 * authenticate({title, subtitle})     -> { ok, error? }          error: canceled, lockout, unavailable, failed, busy
 * setSecure({enabled})                -> {}                      FLAG_SECURE: hides the app from the recent-apps list and screenshots
 *
 * One approach for every Android version from 23: BiometricPrompt with BIOMETRIC_WEAK | DEVICE_CREDENTIAL, so a phone without a
 * fingerprint or face sensor can use its PIN, pattern or password (androidx.biometric supplies the fallback screen on API 23 to 29).
 */
@CapacitorPlugin(name = "AppLock")
class AppLockPlugin : Plugin() {
    @Volatile private var busy = false

    override fun load() {
        // If the lock was on last time, hide the window from screenshots and the recents list before the page has loaded.
        val raw = context.getSharedPreferences(LockPolicy.PREFS_GROUP, Context.MODE_PRIVATE).getString(LockPolicy.KEY_LOCK, null)
        if (LockPolicy.isEnabled(raw)) applySecure(true)
    }

    private fun applySecure(on: Boolean) {
        val a = activity ?: return
        a.runOnUiThread {
            if (on) a.window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
            else a.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = try { BiometricManager.from(context).canAuthenticate(LockPolicy.AUTHENTICATORS) } catch (e: Exception) { BiometricManager.BIOMETRIC_STATUS_UNKNOWN }
        val o = JSObject()
        o.put("available", status == BiometricManager.BIOMETRIC_SUCCESS)
        o.put("reason", LockPolicy.reasonFor(status))
        call.resolve(o)
    }

    @PluginMethod
    fun setSecure(call: PluginCall) {
        applySecure(call.getBoolean("enabled", false) == true)
        call.resolve()
    }

    @PluginMethod
    fun authenticate(call: PluginCall) {
        val act = activity as? FragmentActivity
        if (act == null) { call.resolve(result(false, "unavailable")); return }
        if (busy) { call.resolve(result(false, "busy")); return }
        busy = true
        val title = call.getString("title") ?: "Unlock Comeback"
        val subtitle = call.getString("subtitle")
        act.runOnUiThread {
            try {
                val prompt = BiometricPrompt(act, ContextCompat.getMainExecutor(act), object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) { busy = false; call.resolve(result(true, null)) }
                    override fun onAuthenticationError(code: Int, msg: CharSequence) { busy = false; call.resolve(result(false, LockPolicy.errorFor(code))) }
                    // onAuthenticationFailed (a finger that did not match) leaves the prompt open, so there is nothing to report
                })
                val info = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setAllowedAuthenticators(LockPolicy.AUTHENTICATORS)   // no negative button: it is not allowed together with DEVICE_CREDENTIAL
                if (subtitle != null) info.setSubtitle(subtitle)
                prompt.authenticate(info.build())
            } catch (e: Exception) {
                busy = false
                call.resolve(result(false, "unavailable"))
            }
        }
    }

    private fun result(ok: Boolean, error: String?): JSObject {
        val o = JSObject()
        o.put("ok", ok)
        if (error != null) o.put("error", error)
        return o
    }
}
