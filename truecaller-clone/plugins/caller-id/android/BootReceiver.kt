package com.truecallerclone.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Re-activates the caller ID service after device reboot.
 * The CallReceiver checks SharedPreferences on each call event,
 * so we just need to ensure the "active" flag persists through reboots
 * (which it does since SharedPreferences survive reboots).
 *
 * This receiver ensures Android doesn't garbage-collect our broadcast
 * receiver registration after a reboot.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            val prefs = context.getSharedPreferences("caller_id", Context.MODE_PRIVATE)
            val isActive = prefs.getBoolean("active", false)

            Log.d("BootReceiver", "Device booted / app updated. Caller ID active: $isActive")

            // Nothing else needed — CallReceiver will activate on next phone state change
            // because the SharedPreferences "active" flag persists across reboots.
        }
    }
}
