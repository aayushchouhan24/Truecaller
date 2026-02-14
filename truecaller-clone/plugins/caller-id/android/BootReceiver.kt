package com.truecallerclone.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Re-activates the caller ID persistent foreground service after device reboot.
 * If caller ID was enabled before reboot, this starts the service again
 * so it's ready to show overlays on incoming calls.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val prefs = context.getSharedPreferences("caller_id", Context.MODE_PRIVATE)
        val isActive = prefs.getBoolean("active", false)

        Log.d("BootReceiver", "Device booted / app updated. Caller ID active: $isActive")

        if (isActive) {
            // Restart the persistent foreground service
            try {
                val serviceIntent = Intent(context, CallerIdOverlayService::class.java).apply {
                    action = CallerIdOverlayService.ACTION_START_PERSISTENT
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                Log.d("BootReceiver", "Caller ID service restarted after boot")
            } catch (e: Exception) {
                Log.e("BootReceiver", "Failed to restart caller ID service", e)
            }
        }
    }
}
