package com.entalogics.comeback.steps

import android.annotation.SuppressLint
import android.content.Context

/**
 * Before the app was renamed Comeback, step state was saved in a SharedPreferences file called "resetlog_steps".
 * On first launch it moves to "comeback_steps" and the old file is emptied. Safe to run repeatedly: a key is only removed
 * once the new file holds the same value, and a key that exists in both files with different values is left alone.
 */
object LegacyMigration {
    const val OLD_PREFS = "resetlog_steps"
    const val NEW_PREFS = "comeback_steps"

    /** Pure rule, so it can be tested without a device. Returns how many entries were copied across. */
    fun move(old: MutableMap<String, Any?>, new: MutableMap<String, Any?>): Int {
        var moved = 0
        for (k in old.keys.toList()) {
            val ov = old[k]
            if (!new.containsKey(k)) { new[k] = ov; moved++ }
            else if (new[k] != ov) continue
            old.remove(k)
        }
        return moved
    }

    // commit() on purpose: the old entries are only removed after the new file is known to be saved.
    @SuppressLint("ApplySharedPref")
    fun run(ctx: Context): Int {
        try {
            val oldP = ctx.getSharedPreferences(OLD_PREFS, Context.MODE_PRIVATE)
            if (oldP.all.isEmpty()) return 0
            val newP = ctx.getSharedPreferences(NEW_PREFS, Context.MODE_PRIVATE)
            val old = HashMap<String, Any?>(oldP.all)
            val new = HashMap<String, Any?>(newP.all)
            val before = HashSet(old.keys)
            val moved = move(old, new)
            val handled = before.filter { !old.containsKey(it) }      // copied, or already identical in the new file
            val ne = newP.edit()
            for (k in handled) when (val v = new[k]) {
                is String -> ne.putString(k, v)
                is Long -> ne.putLong(k, v)
                is Int -> ne.putInt(k, v)
                is Boolean -> ne.putBoolean(k, v)
                is Float -> ne.putFloat(k, v)
                is Set<*> -> ne.putStringSet(k, v.filterIsInstance<String>().toSet())
            }
            if (!ne.commit()) return 0           // new file not saved: leave the old one untouched
            val oe = oldP.edit()
            for (k in handled) oe.remove(k)
            oe.commit()
            return moved
        } catch (e: Exception) { return 0 }
    }
}
