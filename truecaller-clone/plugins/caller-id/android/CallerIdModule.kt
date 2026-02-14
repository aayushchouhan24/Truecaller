package com.truecallerclone.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.ContactsContract
import android.provider.Settings
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
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

    /* ── SIM info ──────────────────────────────────── */

    @ReactMethod
    fun getSimInfo(promise: Promise) {
        try {
            val sims = Arguments.createArray()

            if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE)
                != PackageManager.PERMISSION_GRANTED) {
                promise.resolve(sims)
                return
            }

            val telecomManager = reactContext.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
            val subManager = reactContext.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager

            if (telecomManager != null) {
                val accounts = telecomManager.callCapablePhoneAccounts
                for ((index, _) in accounts.withIndex()) {
                    val sim = Arguments.createMap()
                    sim.putInt("slotIndex", index)
                    try {
                        val subInfo = subManager?.getActiveSubscriptionInfoForSimSlotIndex(index)
                        sim.putString("label", subInfo?.displayName?.toString() ?: "SIM ${index + 1}")
                        sim.putString("carrier", subInfo?.carrierName?.toString() ?: "")
                    } catch (_: Exception) {
                        sim.putString("label", "SIM ${index + 1}")
                        sim.putString("carrier", "")
                    }
                    sims.pushMap(sim)
                }
            }

            promise.resolve(sims)
        } catch (e: Exception) {
            promise.reject("SIM_ERROR", e.message)
        }
    }

    /* ── Place call — Android shows native SIM picker ── */

    @ReactMethod
    fun placeCall(phoneNumber: String, promise: Promise) {
        try {
            if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.CALL_PHONE)
                != PackageManager.PERMISSION_GRANTED) {
                val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phoneNumber")).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
                return
            }

            // ACTION_CALL without SIM extras → Android shows native SIM picker if needed
            val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$phoneNumber")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CALL_ERROR", e.message)
        }
    }

    /* ── Get device starred / favorite contacts ───── */

    @ReactMethod
    fun getStarredContacts(promise: Promise) {
        try {
            if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
                promise.resolve(Arguments.createArray())
                return
            }

            val contentResolver = reactContext.contentResolver
            val cursor = contentResolver.query(
                ContactsContract.Contacts.CONTENT_URI,
                arrayOf(
                    ContactsContract.Contacts._ID,
                    ContactsContract.Contacts.DISPLAY_NAME,
                    ContactsContract.Contacts.PHOTO_THUMBNAIL_URI,
                    ContactsContract.Contacts.STARRED
                ),
                "${ContactsContract.Contacts.STARRED} = 1",
                null,
                "${ContactsContract.Contacts.DISPLAY_NAME} ASC"
            )

            val contacts = Arguments.createArray()
            cursor?.use {
                while (it.moveToNext()) {
                    val id = it.getString(0) ?: continue
                    val name = it.getString(1) ?: "Unknown"
                    val thumbnail = it.getString(2)

                    // Get phone numbers
                    val phoneCursor = contentResolver.query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                        "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?",
                        arrayOf(id),
                        null
                    )

                    val phones = Arguments.createArray()
                    phoneCursor?.use { pc ->
                        while (pc.moveToNext()) {
                            pc.getString(0)?.let { num -> phones.pushString(num) }
                        }
                    }

                    if (phones.size() > 0) {
                        val contact = Arguments.createMap()
                        contact.putString("id", id)
                        contact.putString("name", name)
                        contact.putString("thumbnail", thumbnail)
                        contact.putArray("phoneNumbers", phones)
                        contacts.pushMap(contact)
                    }
                }
            }

            promise.resolve(contacts)
        } catch (e: Exception) {
            promise.reject("CONTACTS_ERROR", e.message)
        }
    }
}
