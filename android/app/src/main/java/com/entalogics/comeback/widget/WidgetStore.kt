package com.entalogics.comeback.widget

import android.content.Context

/** The widget's own small SharedPreferences file: the last snapshot from the page and whether any widget is on the home screen. */
object WidgetStore {
    private const val PREFS = "comeback_widget"
    private const val K_SNAPSHOT = "snapshot"
    private const val K_ACTIVE = "active"

    private fun prefs(c: Context) = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(c: Context, s: Snapshot) { prefs(c).edit().putString(K_SNAPSHOT, WidgetModel.toJson(s)).apply() }
    fun load(c: Context): Snapshot? = WidgetModel.parse(prefs(c).getString(K_SNAPSHOT, null))

    /** True while at least one widget is placed (set by the provider's onEnabled / onDisabled). Lets the step service skip all widget work otherwise. */
    fun setActive(c: Context, on: Boolean) { prefs(c).edit().putBoolean(K_ACTIVE, on).apply() }
    fun isActive(c: Context): Boolean = prefs(c).getBoolean(K_ACTIVE, false)
}
