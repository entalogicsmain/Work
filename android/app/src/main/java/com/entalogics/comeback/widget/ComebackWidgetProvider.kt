package com.entalogics.comeback.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * The home-screen widget. It only draws what is already on the phone (the page's last snapshot and the step engine's count),
 * never uses the network or location, and has no periodic update (updatePeriodMillis is 0): it changes when the page sends a new
 * snapshot, when the step service saves, and at midnight.
 */
class ComebackWidgetProvider : android.appwidget.AppWidgetProvider() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            // the day changed (also when the phone's clock or time zone was changed): yesterday's numbers must not look like today's
            Intent.ACTION_DATE_CHANGED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> WidgetUpdater.refresh(context, goAsync())
            else -> super.onReceive(context, intent)
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) { WidgetUpdater.refresh(context, goAsync()) }

    override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) { WidgetUpdater.refresh(context, goAsync()) }

    override fun onEnabled(context: Context) { WidgetStore.setActive(context, true) }
    override fun onDisabled(context: Context) { WidgetStore.setActive(context, false) }
}
