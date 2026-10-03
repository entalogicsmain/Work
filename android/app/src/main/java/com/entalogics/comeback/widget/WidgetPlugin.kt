package com.entalogics.comeback.widget

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Receives the small snapshot the page builds for the home-screen widget (see www/js/widget.js). Nothing leaves the phone. */
@CapacitorPlugin(name = "Widget")
class WidgetPlugin : Plugin() {
    @PluginMethod fun setWidgetSnapshot(call: PluginCall) {
        val snap = WidgetModel.parse(call.data.toString())
        if (snap == null) { call.reject("Not a usable snapshot"); return }
        WidgetStore.save(context, snap)
        WidgetUpdater.refresh(context)
        call.resolve(JSObject().put("saved", true))
    }
}
