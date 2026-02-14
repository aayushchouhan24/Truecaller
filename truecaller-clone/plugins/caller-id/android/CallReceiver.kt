package com.truecallerclone.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.TelephonyManager
import android.util.Log

class CallReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallReceiver"
        private var lastState = TelephonyManager.CALL_STATE_IDLE
        private var incomingNumber: String? = null
        private var callStartTime: Long = 0
        private var isIncoming = false
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        // Check if caller ID is active
        val prefs = context.getSharedPreferences("caller_id", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("active", false)) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        Log.d(TAG, "Phone state: $state, number: $number, serviceRunning: ${CallerIdOverlayService.isRunning}")

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                isIncoming = true
                if (!number.isNullOrEmpty()) {
                    incomingNumber = number
                }
                callStartTime = System.currentTimeMillis()

                if (!incomingNumber.isNullOrEmpty()) {
                    val serviceIntent = Intent(context, CallerIdOverlayService::class.java).apply {
                        action = CallerIdOverlayService.ACTION_INCOMING_CALL
                        putExtra(CallerIdOverlayService.EXTRA_PHONE_NUMBER, incomingNumber)
                    }
                    startOverlayService(context, serviceIntent)
                }
                lastState = TelephonyManager.CALL_STATE_RINGING
            }

            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                if (lastState == TelephonyManager.CALL_STATE_RINGING && isIncoming) {
                    val serviceIntent = Intent(context, CallerIdOverlayService::class.java).apply {
                        action = CallerIdOverlayService.ACTION_CALL_ANSWERED
                    }
                    startOverlayService(context, serviceIntent)
                }
                lastState = TelephonyManager.CALL_STATE_OFFHOOK
            }

            TelephonyManager.EXTRA_STATE_IDLE -> {
                when (lastState) {
                    TelephonyManager.CALL_STATE_RINGING -> {
                        val ringDuration = ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
                        val serviceIntent = Intent(context, CallerIdOverlayService::class.java).apply {
                            action = CallerIdOverlayService.ACTION_MISSED_CALL
                            putExtra(CallerIdOverlayService.EXTRA_PHONE_NUMBER, incomingNumber)
                            putExtra(CallerIdOverlayService.EXTRA_RING_DURATION, ringDuration)
                        }
                        startOverlayService(context, serviceIntent)
                    }
                    TelephonyManager.CALL_STATE_OFFHOOK -> {
                        if (isIncoming) {
                            val duration = ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
                            val serviceIntent = Intent(context, CallerIdOverlayService::class.java).apply {
                                action = CallerIdOverlayService.ACTION_CALL_ENDED
                                putExtra(CallerIdOverlayService.EXTRA_PHONE_NUMBER, incomingNumber)
                                putExtra(CallerIdOverlayService.EXTRA_CALL_DURATION, duration)
                            }
                            startOverlayService(context, serviceIntent)
                        }
                    }
                }
                lastState = TelephonyManager.CALL_STATE_IDLE
                isIncoming = false
                incomingNumber = null
                callStartTime = 0
            }
        }
    }

    /**
     * Deliver intent to the overlay service.
     * If the service is already running as foreground (persistent mode),
     * startService() just delivers a new onStartCommand.
     * If the service was killed, try startForegroundService() to restart it.
     */
    private fun startOverlayService(context: Context, intent: Intent) {
        try {
            if (CallerIdOverlayService.isRunning) {
                // Service is alive — just deliver the intent
                context.startService(intent)
            } else {
                // Service was killed — restart it as foreground
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start overlay service", e)
            // Last resort: try startForegroundService anyway
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e2: Exception) {
                Log.e(TAG, "Fallback also failed", e2)
            }
        }
    }
}
