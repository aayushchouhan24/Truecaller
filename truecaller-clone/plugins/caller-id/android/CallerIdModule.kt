package com.truecallerclone.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class CallerIdModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CallerIdModule"

    private fun getPrefs() =
        reactContext.getSharedPreferences("caller_id", 0)

    @ReactMethod
    fun startService(apiUrl: String, token: String, promise: Promise) {
        try {
            getPrefs().edit()
                .putString("api_url", apiUrl)
                .putString("token", token)
                .putBoolean("active", true)
                .apply()

            // Actually start the persistent foreground service
            val intent = Intent(reactContext, CallerIdOverlayService::class.java).apply {
                action = CallerIdOverlayService.ACTION_START_PERSISTENT
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("START_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopService(promise: Promise) {
        try {
            getPrefs().edit()
                .putBoolean("active", false)
                .apply()

            // Stop the persistent foreground service
            val intent = Intent(reactContext, CallerIdOverlayService::class.java).apply {
                action = CallerIdOverlayService.ACTION_STOP_PERSISTENT
            }
            try {
                reactContext.startService(intent)
            } catch (_: Exception) {
                // Service might already be stopped
                reactContext.stopService(Intent(reactContext, CallerIdOverlayService::class.java))
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message)
        }
    }

    @ReactMethod
    fun isActive(promise: Promise) {
        promise.resolve(getPrefs().getBoolean("active", false))
    }

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        promise.resolve(Settings.canDrawOverlays(reactContext))
    }

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${reactContext.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PERMISSION_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getConfig(promise: Promise) {
        try {
            val prefs = getPrefs()
            val map = com.facebook.react.bridge.Arguments.createMap().apply {
                putBoolean("active", prefs.getBoolean("active", false))
                putString("apiUrl", prefs.getString("api_url", ""))
                putBoolean("hasToken", !prefs.getString("token", "").isNullOrEmpty())
                putBoolean("serviceRunning", CallerIdOverlayService.isRunning)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("CONFIG_ERROR", e.message)
        }
    }
}
