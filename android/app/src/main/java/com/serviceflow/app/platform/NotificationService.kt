package com.serviceflow.app.platform

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import com.serviceflow.app.MainActivity
import com.serviceflow.app.R
import com.serviceflow.core.ShiftReminderScheduling
import com.serviceflow.core.TimeEntry
import java.time.Duration
import java.time.Instant
import kotlin.math.ceil
import kotlin.math.max

/**
 * Local shift reminders and notification permission.
 *
 * Permission is never requested at launch or sign-in: it is asked once, right
 * after a person's first successful clock-in, so the "Still clocked in?"
 * reminders make sense when the prompt appears.
 *
 * Remote push isn't registered: the server only delivers Expo tokens (the iOS
 * app's APNs token isn't delivered either), so there is no Firebase here.
 */
class NotificationService(private val context: Context, private val permissions: PermissionBridge) : ShiftReminderScheduling {
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val prefs = context.getSharedPreferences("serviceflow.platform", Context.MODE_PRIVATE)
    /** A notification tapped before the session was ready; delivered when it connects. */
    private var pendingIntent: Intent? = null

    /** A notification action asked to clock out. */
    var onClockOutAction: (() -> Unit)? = null
        set(value) {
            field = value
            deliverPending()
        }

    /** A notification body tap; the message to show on Clock In. */
    var onReminderTap: ((String) -> Unit)? = null
        set(value) {
            field = value
            deliverPending()
        }

    init {
        val channel = NotificationChannel(CHANNEL_ID, "Shift reminders", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Reminders when a shift has been running for a long time."
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    // MARK: Permission

    fun isAuthorized(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** Asks once, only if the person has never answered. Android 12 and older need no prompt. */
    suspend fun requestIfUndetermined(): Boolean {
        if (Build.VERSION.SDK_INT < 33 || isAuthorized() || prefs.getBoolean(ASKED_KEY, false)) return isAuthorized()
        permissions.request(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) ?: return false
        prefs.edit { putBoolean(ASKED_KEY, true) }
        return isAuthorized()
    }

    // MARK: ShiftReminderScheduling

    override fun scheduleReminders(shift: TimeEntry, now: Instant) {
        cancelReminders()
        val name = shift.project.name
        for (hours in REMINDER_HOURS) {
            val target = shift.originalStartedAt.plus(Duration.ofHours(hours.toLong()))
            val seconds = Duration.between(now, target).toMillis() / 1000.0
            // An overdue reminder is not re-sent every time the app launches.
            if (seconds <= 0) continue
            val intent = Intent(context, ReminderReceiver::class.java)
                .setAction(reminderAction(hours))
                .putExtra(EXTRA_TITLE, "Still clocked in?")
                .putExtra(EXTRA_BODY, "Your shift at $name has been running for $hours hours. Clock out if you are finished.")
                .putExtra(EXTRA_HOURS, hours)
                .putExtra(EXTRA_SHIFT, shift.localId)
            val triggerAt = System.currentTimeMillis() + (max(60.0, ceil(seconds)) * 1000).toLong()
            // A plain set() may be deferred by hours; a short window keeps the
            // reminder on time without the exact-alarm permission.
            alarms.setWindow(AlarmManager.RTC_WAKEUP, triggerAt, REMINDER_WINDOW_MS, reminderIntent(intent, hours))
        }
    }

    override fun cancelReminders() {
        for (hours in REMINDER_HOURS) {
            val intent = Intent(context, ReminderReceiver::class.java).setAction(reminderAction(hours))
            alarms.cancel(reminderIntent(intent, hours))
        }
    }

    private fun reminderIntent(intent: Intent, hours: Int): PendingIntent =
        PendingIntent.getBroadcast(context, hours, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    // MARK: Responses

    /** Handles the activity's launch or new intent when it came from a reminder. */
    fun handle(intent: Intent?) {
        if (intent?.getStringExtra(EXTRA_RESPONSE) == null) return
        pendingIntent = intent
        deliverPending()
    }

    private fun deliverPending() {
        val intent = pendingIntent ?: return
        val hours = intent.getIntExtra(EXTRA_HOURS, 0)
        when (intent.getStringExtra(EXTRA_RESPONSE)) {
            RESPONSE_CLOCK_OUT -> {
                val action = onClockOutAction ?: return
                pendingIntent = null
                NotificationManagerCompat.from(context).cancel(hours)
                action()
            }
            RESPONSE_OPEN -> {
                val tap = onReminderTap ?: return
                pendingIntent = null
                val after = if (hours > 0) " after $hours hours" else ""
                tap("You are still clocked in$after. Clock out if you are finished.")
            }
            else -> pendingIntent = null
        }
    }

    /** Posts a reminder when its alarm goes off. */
    class ReminderReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
            val hours = intent.getIntExtra(EXTRA_HOURS, 0)
            fun open(response: String, requestCode: Int): PendingIntent {
                val launch = Intent(context, MainActivity::class.java)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra(EXTRA_RESPONSE, response)
                    .putExtra(EXTRA_HOURS, hours)
                return PendingIntent.getActivity(context, requestCode, launch,
                                                 PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            }
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(intent.getStringExtra(EXTRA_TITLE))
                .setContentText(intent.getStringExtra(EXTRA_BODY))
                .setStyle(NotificationCompat.BigTextStyle().bigText(intent.getStringExtra(EXTRA_BODY)))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(open(RESPONSE_OPEN, hours * 10))
                .addAction(0, "Clock Out", open(RESPONSE_CLOCK_OUT, hours * 10 + 1))
                .build()
            @Suppress("MissingPermission")
            NotificationManagerCompat.from(context).notify(hours, notification)
        }
    }

    companion object {
        val REMINDER_HOURS = listOf(8, 10)
        private const val CHANNEL_ID = "shift-reminders"
        private const val REMINDER_WINDOW_MS = 10 * 60 * 1000L
        private const val ASKED_KEY = "askedNotifications"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_BODY = "body"
        private const val EXTRA_HOURS = "hours"
        private const val EXTRA_SHIFT = "shiftLocalId"
        private const val EXTRA_RESPONSE = "reminderResponse"
        private const val RESPONSE_OPEN = "open"
        private const val RESPONSE_CLOCK_OUT = "clock_out"

        private fun reminderAction(hours: Int) = "com.serviceflow.app.SHIFT_REMINDER_${hours}H"
    }
}
