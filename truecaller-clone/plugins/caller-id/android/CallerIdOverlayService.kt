package com.truecallerclone.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.ContactsContract
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class CallerIdOverlayService : Service() {

    companion object {
        const val ACTION_INCOMING_CALL = "com.truecallerclone.INCOMING_CALL"
        const val ACTION_CALL_ANSWERED = "com.truecallerclone.CALL_ANSWERED"
        const val ACTION_MISSED_CALL = "com.truecallerclone.MISSED_CALL"
        const val ACTION_CALL_ENDED = "com.truecallerclone.CALL_ENDED"
        const val ACTION_START_PERSISTENT = "com.truecallerclone.START_PERSISTENT"
        const val ACTION_STOP_PERSISTENT = "com.truecallerclone.STOP_PERSISTENT"
        const val EXTRA_PHONE_NUMBER = "phone_number"
        const val EXTRA_RING_DURATION = "ring_duration"
        const val EXTRA_CALL_DURATION = "call_duration"
        private const val CHANNEL_ID = "caller_id_channel"
        private const val FOREGROUND_NOTIFICATION_ID = 9001
        @Volatile var isRunning = false
            private set

        // Colors
        private const val BLUE_PRIMARY = "#1565C0"
        private const val BLUE_LIGHT = "#1E88E5"
        private const val BLUE_PALE = "#BBDEFB"
        private const val BLUE_BRAND = "#90CAF9"
        private const val SPAM_RED = "#F44336"
        private const val WHITE = "#FFFFFF"
        private const val DARK_BG = "#1A1A2E"
        private const val DARK_SURFACE = "#16213E"
        private const val DARK_CARD = "#0F3460"
        private const val GREEN_CALL = "#4CAF50"
        private const val ORANGE_SAVE = "#FF9800"
        private const val RED_BLOCK = "#F44336"
        private const val BLUE_WA = "#25D366"
    }

    private var windowManager: WindowManager? = null
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()

    // Incoming overlay
    private var incomingOverlay: View? = null
    private var badgeTextView: TextView? = null
    private var numberTextView: TextView? = null
    private var subtitleTextView: TextView? = null

    // After-call overlay
    private var afterCallOverlay: View? = null
    private var afterCallDismissRunnable: Runnable? = null

    // Lookup state
    private var currentNumber: String? = null
    private var lookupName: String? = null
    private var lookupIsSpam = false
    private var lookupSpamScore = 0
    private var lookupDone = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
        isRunning = true
    }

    override fun onDestroy() {
        isRunning = false
        dismissIncomingOverlay()
        dismissAfterCallOverlay()
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // MUST call startForeground() within 5 seconds when started with startForegroundService()
        promoteToForeground()

        // Handle stop request
        if (intent?.action == ACTION_STOP_PERSISTENT) {
            isRunning = false
            dismissIncomingOverlay()
            dismissAfterCallOverlay()
            stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }

        // For persistent start, just keep running
        if (intent?.action == ACTION_START_PERSISTENT) {
            return START_STICKY
        }

        if (!Settings.canDrawOverlays(this)) {
            // Can't show overlays but keep service alive for when permission is granted
            return START_STICKY
        }

        val prefs = getSharedPreferences("caller_id", MODE_PRIVATE)
        if (!prefs.getBoolean("active", false)) {
            isRunning = false
            stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }

        when (intent?.action) {
            ACTION_INCOMING_CALL -> handleIncoming(intent)
            ACTION_CALL_ANSWERED -> handleAnswered()
            ACTION_MISSED_CALL -> handleMissed(intent)
            ACTION_CALL_ENDED -> handleEnded(intent)
        }
        // START_STICKY so Android restarts the service if it gets killed
        return START_STICKY
    }

    // ── Action Handlers ──────────────────────────────────────

    private fun handleIncoming(intent: Intent) {
        val number = intent.getStringExtra(EXTRA_PHONE_NUMBER) ?: return
        currentNumber = number
        lookupName = null
        lookupIsSpam = false
        lookupSpamScore = 0
        lookupDone = false
        dismissAfterCallOverlay()
        showIncomingOverlay(number)

        // Step 1: Check device contacts first (instant, no network)
        val contactName = lookupContactName(number)
        if (!contactName.isNullOrEmpty()) {
            lookupName = contactName
            lookupDone = true
            handler.post { updateIncomingOverlay(contactName, false, 0) }
        }

        // Step 2: Also check backend (may have spam info or better name)
        lookupNumber(normalizePhoneForLookup(number))
    }

    private fun handleAnswered() {
        dismissIncomingOverlay()
        // Service stays alive — persistent mode
    }

    private fun handleMissed(intent: Intent) {
        dismissIncomingOverlay()
        val number = intent.getStringExtra(EXTRA_PHONE_NUMBER) ?: currentNumber ?: return
        val ringDuration = intent.getIntExtra(EXTRA_RING_DURATION, 0)
        showAfterCallOverlay(number, true, ringDuration)
    }

    private fun handleEnded(intent: Intent) {
        dismissIncomingOverlay()
        val number = intent.getStringExtra(EXTRA_PHONE_NUMBER) ?: currentNumber ?: return
        val duration = intent.getIntExtra(EXTRA_CALL_DURATION, 0)
        showAfterCallOverlay(number, false, duration)
    }

    // ── Incoming Call Overlay ────────────────────────────────

    private fun showIncomingOverlay(phoneNumber: String) {
        dismissIncomingOverlay()

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.parseColor(BLUE_PRIMARY))
                cornerRadius = dp(16).toFloat()
            }
            elevation = dp(12).toFloat()
        }

        // ── Row 1: Badge + Close ──
        val headerRow = hLayout().apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        badgeTextView = TextView(this).apply {
            text = "★  Identifying caller..."
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, lp_wrap, 1f)
        }

        val closeBtn = TextView(this).apply {
            text = "✕"
            setTextColor(Color.parseColor(BLUE_PALE))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setPadding(dp(12), 0, dp(4), 0)
            setOnClickListener { dismissIncomingOverlay(); stopSelfIfIdle() }
        }

        headerRow.addView(badgeTextView)
        headerRow.addView(closeBtn)
        card.addView(headerRow)

        // ── Row 2: Icon + Number ──
        val numberRow = hLayout().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, dp(4))
        }

        val iconCircle = TextView(this).apply {
            text = "👤"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
            setPadding(0, 0, dp(14), 0)
        }

        val numberColumn = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, lp_wrap, 1f)
        }

        numberTextView = TextView(this).apply {
            text = formatPhone(phoneNumber)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }

        subtitleTextView = TextView(this).apply {
            text = "Checking database..."
            setTextColor(Color.parseColor(BLUE_PALE))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        }

        numberColumn.addView(numberTextView)
        numberColumn.addView(subtitleTextView)
        numberRow.addView(iconCircle)
        numberRow.addView(numberColumn)
        card.addView(numberRow)

        // ── Row 3: Brand ──
        val brandRow = hLayout().apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            setPadding(0, dp(6), 0, 0)
        }

        brandRow.addView(TextView(this).apply {
            text = "truecaller"
            setTextColor(Color.parseColor(BLUE_BRAND))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        })
        card.addView(brandRow)

        // Wrap card in container with margins
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(4))
            addView(card)
        }

        val params = overlayParams(Gravity.TOP).apply {
            y = dp(80)
        }

        // Drag support
        setupDrag(container, params)

        try {
            windowManager?.addView(container, params)
            incomingOverlay = container
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun updateIncomingOverlay(name: String?, isSpam: Boolean, spamScore: Int) {
        if (incomingOverlay == null) return

        if (isSpam) {
            badgeTextView?.text = "⚠  Likely spam  •  Score: $spamScore"
            badgeTextView?.setTextColor(Color.parseColor("#FFCDD2"))
            // Change card background to red-ish
            val card = (incomingOverlay as? LinearLayout)?.getChildAt(0)
            (card as? LinearLayout)?.background = GradientDrawable().apply {
                setColor(Color.parseColor("#C62828"))
                cornerRadius = dp(16).toFloat()
            }
        } else if (!name.isNullOrEmpty()) {
            badgeTextView?.text = "★  First time caller"
            badgeTextView?.setTextColor(Color.WHITE)
        } else {
            badgeTextView?.text = "★  Unknown Number"
        }

        if (!name.isNullOrEmpty()) {
            subtitleTextView?.text = name
            subtitleTextView?.setTextColor(Color.WHITE)
            subtitleTextView?.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            subtitleTextView?.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        } else {
            subtitleTextView?.text = if (isSpam) "Reported as spam" else "Unknown Number"
            subtitleTextView?.setTextColor(Color.parseColor(BLUE_PALE))
        }
    }

    private fun dismissIncomingOverlay() {
        incomingOverlay?.let {
            try { windowManager?.removeView(it) } catch (_: Exception) {}
        }
        incomingOverlay = null
        badgeTextView = null
        numberTextView = null
        subtitleTextView = null
    }

    // ── After-Call Overlay ───────────────────────────────────

    private fun showAfterCallOverlay(phoneNumber: String, isMissed: Boolean, seconds: Int) {
        dismissAfterCallOverlay()

        var name = lookupName
        val isSpam = lookupIsSpam

        // If backend returned null, check device contacts
        if (name.isNullOrEmpty()) {
            name = lookupContactName(phoneNumber)
            lookupName = name
        }

        val displayName = if (!name.isNullOrEmpty()) name else "Unknown Number"
        val statusText = if (isMissed) "Missed call, rang ${seconds}s" else "Call ended  •  ${formatDuration(seconds)}"

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(4))
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.parseColor(DARK_SURFACE))
                cornerRadius = dp(18).toFloat()
            }
            elevation = dp(16).toFloat()
            clipChildren = true
            clipToPadding = true
        }

        // ── Blue Header ──
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.parseColor(if (isSpam) SPAM_RED else BLUE_PRIMARY))
                cornerRadii = floatArrayOf(
                    dp(18f), dp(18f), dp(18f), dp(18f),
                    0f, 0f, 0f, 0f
                )
            }
        }

        val statusIcon = TextView(this).apply {
            text = if (isMissed) "📞" else "📱"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setPadding(0, 0, dp(10), 0)
        }

        val statusLabel = TextView(this).apply {
            text = statusText
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, lp_wrap, 1f)
        }

        val headerClose = TextView(this).apply {
            text = "✕"
            setTextColor(Color.parseColor(BLUE_PALE))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setPadding(dp(12), 0, 0, 0)
            setOnClickListener { dismissAfterCallOverlay(); stopSelfIfIdle() }
        }

        header.addView(statusIcon)
        header.addView(statusLabel)
        header.addView(headerClose)
        card.addView(header)

        // ── Body: Name + Phone ──
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(12))
            setBackgroundColor(Color.parseColor(DARK_SURFACE))
        }

        // Name row
        val nameRow = hLayout().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, dp(6))
        }

        nameRow.addView(TextView(this).apply {
            text = "👤"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            setPadding(0, 0, dp(14), 0)
        })

        val nameColumn = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, lp_wrap, 1f)
        }

        nameColumn.addView(TextView(this).apply {
            text = displayName
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        })

        if (!name.isNullOrEmpty()) {
            nameColumn.addView(TextView(this).apply {
                text = formatPhone(phoneNumber)
                setTextColor(Color.parseColor("#8E8E93"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(0, dp(2), 0, 0)
            })
        }

        if (isSpam) {
            nameColumn.addView(TextView(this).apply {
                text = "⚠ Reported as spam  •  Score: $lookupSpamScore"
                setTextColor(Color.parseColor(SPAM_RED))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(0, dp(4), 0, 0)
            })
        }

        nameRow.addView(nameColumn)
        body.addView(nameRow)

        // Divider
        body.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#2C2C2E"))
            layoutParams = LinearLayout.LayoutParams(lp_match, dp(1)).apply {
                topMargin = dp(8)
                bottomMargin = dp(8)
            }
        })

        // Brand row
        body.addView(hLayout().apply {
            gravity = Gravity.END
            addView(TextView(this@CallerIdOverlayService).apply {
                text = "truecaller"
                setTextColor(Color.parseColor(BLUE_BRAND))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            })
        })

        card.addView(body)

        // ── Action Buttons ──
        val actionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(8), dp(8), dp(14))
            setBackgroundColor(Color.parseColor(DARK_SURFACE))
            // Round bottom corners
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#111827"))
                cornerRadii = floatArrayOf(0f, 0f, 0f, 0f, dp(18f), dp(18f), dp(18f), dp(18f))
            }
        }

        actionsRow.addView(createActionButton("📞", "CALL", GREEN_CALL) {
            val callIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phoneNumber")).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(callIntent)
            dismissAfterCallOverlay(); stopSelfIfIdle()
        })

        actionsRow.addView(createActionButton("💬", "WHATSAPP", BLUE_WA) {
            val clean = phoneNumber.replace(Regex("[^0-9]"), "")
            val waNum = if (clean.length == 10) "91$clean" else clean
            try {
                val waIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$waNum")).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                startActivity(waIntent)
            } catch (_: Exception) {
                Toast.makeText(this, "WhatsApp not installed", Toast.LENGTH_SHORT).show()
            }
            dismissAfterCallOverlay(); stopSelfIfIdle()
        })

        actionsRow.addView(createActionButton("💾", "SAVE", ORANGE_SAVE) {
            val saveIntent = Intent(ContactsContract.Intents.Insert.ACTION).apply {
                type = ContactsContract.RawContacts.CONTENT_TYPE
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                putExtra(ContactsContract.Intents.Insert.PHONE, phoneNumber)
                if (!name.isNullOrEmpty()) putExtra(ContactsContract.Intents.Insert.NAME, name)
            }
            startActivity(saveIntent)
            dismissAfterCallOverlay(); stopSelfIfIdle()
        })

        actionsRow.addView(createActionButton("🚫", "BLOCK", RED_BLOCK) {
            reportSpamToBackend(phoneNumber)
            Toast.makeText(this, "Reported as spam", Toast.LENGTH_SHORT).show()
            dismissAfterCallOverlay(); stopSelfIfIdle()
        })

        card.addView(actionsRow)
        container.addView(card)

        val params = overlayParams(Gravity.TOP).apply {
            y = dp(100)
        }

        setupDrag(container, params)

        try {
            windowManager?.addView(container, params)
            afterCallOverlay = container
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Auto-dismiss after 30 seconds
        afterCallDismissRunnable = Runnable {
            dismissAfterCallOverlay()
            stopSelfIfIdle()
        }
        handler.postDelayed(afterCallDismissRunnable!!, 30_000)
    }

    private fun dismissAfterCallOverlay() {
        afterCallDismissRunnable?.let { handler.removeCallbacks(it) }
        afterCallDismissRunnable = null
        afterCallOverlay?.let {
            try { windowManager?.removeView(it) } catch (_: Exception) {}
        }
        afterCallOverlay = null
    }

    // ── Network Lookup ──────────────────────────────────────

    private fun lookupNumber(phoneNumber: String) {
        val prefs = getSharedPreferences("caller_id", MODE_PRIVATE)
        val apiUrl = prefs.getString("api_url", null)
        val token = prefs.getString("token", null)

        if (apiUrl.isNullOrEmpty()) {
            handler.post { updateIncomingOverlay(null, false, 0) }
            return
        }

        executor.execute {
            var attempt = 0
            val maxAttempts = 2  // Original + 1 retry
            var success = false

            while (attempt < maxAttempts && !success) {
                try {
                    val url = URL("$apiUrl/numbers/lookup")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json")
                    if (!token.isNullOrEmpty()) {
                        conn.setRequestProperty("Authorization", "Bearer $token")
                    }
                    conn.connectTimeout = 12000  // Increased from 5s to 12s for slower networks
                    conn.readTimeout = 12000     // Increased from 5s to 12s for backend processing
                    conn.doOutput = true

                    val bodyJson = JSONObject().apply { put("phoneNumber", phoneNumber) }
                    conn.outputStream.bufferedWriter().use { it.write(bodyJson.toString()) }

                    if (conn.responseCode in 200..299) {
                        val response = conn.inputStream.bufferedReader().readText()
                        val json = JSONObject(response)

                        // Handle possible wrapper: { data: { ... } }
                        val data = if (json.has("data") && json.get("data") is JSONObject)
                            json.getJSONObject("data") else json

                        // Handle null/empty/"null" string cases properly
                        var apiName = data.optString("name", "")
                        if (apiName.isEmpty() || apiName.equals("null", ignoreCase = true)) {
                            apiName = data.optString("bestName", "")
                            if (apiName.isEmpty() || apiName.equals("null", ignoreCase = true)) {
                                apiName = ""  // Treat as empty, not "null" string
                            }
                        }
                        val finalName = apiName.ifEmpty { null }
                        val spamScore = data.optInt("spamScore", 0)
                        val isSpam = data.optBoolean("isLikelySpam", false)

                        // NEVER overwrite a good name with null — only upgrade
                        if (!finalName.isNullOrEmpty()) {
                            lookupName = finalName
                        }
                        lookupIsSpam = isSpam
                        lookupSpamScore = spamScore
                        lookupDone = true
                        success = true

                        // Show API name if better, or keep existing name
                        val displayName = if (!finalName.isNullOrEmpty()) finalName else lookupName
                        handler.post { updateIncomingOverlay(displayName, isSpam, spamScore) }
                    } else {
                        // Non-200 response - retry if we have attempts left
                        attempt++
                        if (attempt >= maxAttempts) {
                            lookupDone = true
                            // Don't overwrite existing name on error
                            if (lookupName == null) {
                                handler.post { updateIncomingOverlay(null, false, 0) }
                            }
                        } else {
                            Thread.sleep(1000)  // Wait 1s before retry
                        }
                    }
                    conn.disconnect()
                } catch (e: Exception) {
                    e.printStackTrace()
                    attempt++
                    if (attempt >= maxAttempts) {
                        lookupDone = true
                        // Don't overwrite existing name on error
                        if (lookupName == null) {
                            handler.post { updateIncomingOverlay(null, false, 0) }
                        }
                    } else {
                        Thread.sleep(1000)  // Wait 1s before retry
                    }
                }
            }
        }
    }

    private fun reportSpamToBackend(phoneNumber: String) {
        val prefs = getSharedPreferences("caller_id", MODE_PRIVATE)
        val apiUrl = prefs.getString("api_url", null)
        val token = prefs.getString("token", null)
        if (apiUrl.isNullOrEmpty() || token.isNullOrEmpty()) return

        executor.execute {
            try {
                val url = URL("$apiUrl/numbers/report-spam")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.doOutput = true

                val body = JSONObject().apply {
                    put("phoneNumber", phoneNumber)
                    put("reason", "blocked_from_overlay")
                }
                conn.outputStream.bufferedWriter().use { it.write(body.toString()) }
                conn.responseCode // trigger request
                conn.disconnect()
            } catch (_: Exception) {}
        }
    }

    // ── UI Helpers ──────────────────────────────────────────

    /**
     * Look up a phone number in device contacts using ContentResolver.
     * Returns the contact display name, or null if not found.
     */
    private fun lookupContactName(phoneNumber: String): String? {
        try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber)
            )
            val cursor = contentResolver.query(
                uri,
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null, null, null
            )
            cursor?.use {
                if (it.moveToFirst()) {
                    return it.getString(0)
                }
            }
        } catch (_: Exception) {}
        return null
    }

    private fun createActionButton(icon: String, label: String, color: String, onClick: () -> Unit): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(6), dp(4), dp(6))
            layoutParams = LinearLayout.LayoutParams(0, lp_wrap, 1f)

            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
            }

            setOnClickListener { onClick() }

            // Ripple-like press effect
            isClickable = true
            isFocusable = true

            addView(TextView(this@CallerIdOverlayService).apply {
                text = icon
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                gravity = Gravity.CENTER
            })

            addView(TextView(this@CallerIdOverlayService).apply {
                text = label
                setTextColor(Color.parseColor(color))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                gravity = Gravity.CENTER
                setPadding(0, dp(4), 0, 0)
            })
        }
    }

    private fun overlayParams(gravity: Int): WindowManager.LayoutParams {
        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
            PixelFormat.TRANSLUCENT
        ).apply {
            this.gravity = gravity
        }
    }

    private fun setupDrag(view: View, params: WindowManager.LayoutParams) {
        var initialY = 0
        var touchY = 0f

        view.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialY = params.y
                    touchY = event.rawY
                    false // Allow click events to propagate
                }
                MotionEvent.ACTION_MOVE -> {
                    params.y = initialY + (event.rawY - touchY).toInt()
                    try { windowManager?.updateViewLayout(view, params) } catch (_: Exception) {}
                    true
                }
                else -> false
            }
        }
    }

    private fun hLayout(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(lp_match, lp_wrap)
        }
    }

    private fun dp(dp: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp.toFloat(), resources.displayMetrics).toInt()

    private fun dp(dp: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, resources.displayMetrics)

    private val lp_match get() = LinearLayout.LayoutParams.MATCH_PARENT
    private val lp_wrap get() = LinearLayout.LayoutParams.WRAP_CONTENT

    private fun formatPhone(number: String): String {
        val clean = number.replace(Regex("[^+0-9]"), "")
        return when {
            clean.length == 10 -> "${clean.substring(0, 5)} ${clean.substring(5)}"
            clean.length == 12 && clean.startsWith("91") ->
                "+91 ${clean.substring(2, 7)} ${clean.substring(7)}"
            clean.length == 13 && clean.startsWith("+91") ->
                "+91 ${clean.substring(3, 8)} ${clean.substring(8)}"
            else -> clean
        }
    }

    private fun formatDuration(seconds: Int): String {
        return when {
            seconds < 60 -> "${seconds}s"
            else -> "${seconds / 60}m ${seconds % 60}s"
        }
    }

    /** Normalize phone to +91XXXXXXXXXX format for consistent API lookup */
    private fun normalizePhoneForLookup(phone: String): String {
        val clean = phone.replace(Regex("[^+0-9]"), "")
        return when {
            clean.length == 10 && clean.all { it.isDigit() } -> "+91$clean"
            clean.startsWith("91") && clean.length == 12 -> "+$clean"
            clean.startsWith("091") && clean.length == 13 -> "+${clean.drop(1)}"
            !clean.startsWith("+") && clean.length > 5 -> "+$clean"
            else -> clean
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Caller ID", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shows caller identification overlays"
                setShowBadge(false)
                setSound(null, null)
                enableLights(false)
                enableVibration(false)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    /**
     * Promote this service to a foreground service with a low-priority notification.
     * This is REQUIRED on Android 8+ when started via startForegroundService().
     * Must be called within 5 seconds of onStartCommand.
     */
    private fun promoteToForeground() {
        createNotificationChannel()

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = if (launchIntent != null) {
            PendingIntent.getActivity(this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        } else null

        val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Caller ID Active")
                .setContentText("Identifying incoming calls")
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Caller ID Active")
                .setContentText("Identifying incoming calls")
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setOngoing(true)
                .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
                .build()
        }

        try {
            if (Build.VERSION.SDK_INT >= 34) {
                // Android 14+ requires foreground service type
                startForeground(FOREGROUND_NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(FOREGROUND_NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopSelfIfIdle() {
        // Persistent service — do NOT stop; just dismiss overlays
        // Service stays running for next call event
    }
}
