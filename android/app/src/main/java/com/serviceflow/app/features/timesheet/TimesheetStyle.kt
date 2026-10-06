package com.serviceflow.app.features.timesheet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Handyman
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.DateText
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.PayPeriod
import com.serviceflow.core.SegmentSummary
import com.serviceflow.core.TimeEntry
import com.serviceflow.core.TimesheetBuilder
import com.serviceflow.core.TimesheetDay
import kotlinx.coroutines.delay
import java.time.Instant

/** The Timesheet's own palette (it differs from the app palette on purpose). */
object TimesheetColors {
    val green = hex(0x173f37)
    val teal = hex(0x2f8d7f)
    val tealSoft = hex(0xe6f3f0)
    val tealInk = hex(0x1e6b60)
    val surface = Color.White
    val divider = hex(0xeef1f2)
    val ink = hex(0x10222b)
    val inkSoft = hex(0x3c4c54)
    val red = hex(0xd24a4a)
    val redInk = hex(0xa83838)
    val redBg = hex(0xfdecec)
    val redBorder = hex(0xf3c8c8)
    val bg = hex(0xf4f6f7)
    val border = hex(0xe2e6e8)
    val muted = hex(0x6b7a7e)
    val summaryLabel = hex(0xa8c7c0)
    val greySoft = hex(0xeef1f3)
    val unknownBg = hex(0xeef1ef)
}

/** Icon and colours for an entry's location status. */
data class TimesheetStatusStyle(val icon: ImageVector, val circle: Color, val pill: Color, val dot: Color, val text: Color) {
    companion object {
        fun of(status: SegmentSummary.Status): TimesheetStatusStyle = when (status) {
            SegmentSummary.Status.OnSite -> TimesheetStatusStyle(
                Icons.Filled.Handyman, TimesheetColors.teal, TimesheetColors.tealSoft, TimesheetColors.teal, TimesheetColors.tealInk,
            )
            SegmentSummary.Status.Mixed -> TimesheetStatusStyle(
                Icons.Filled.SwapHoriz, TimesheetColors.teal, TimesheetColors.tealSoft, TimesheetColors.teal, TimesheetColors.tealInk,
            )
            SegmentSummary.Status.OffSite -> TimesheetStatusStyle(
                Icons.Filled.DirectionsCar, TimesheetColors.inkSoft, TimesheetColors.redBg, TimesheetColors.red, TimesheetColors.redInk,
            )
            SegmentSummary.Status.Unavailable -> TimesheetStatusStyle(
                Icons.Filled.QuestionMark, TimesheetColors.muted, TimesheetColors.unknownBg, TimesheetColors.muted, TimesheetColors.inkSoft,
            )
        }
    }
}

/** Display values for one clock-in on the Timesheet. */
class TimesheetEntryInfo(entry: TimeEntry, now: Instant) {
    val job: String = entry.project.name
    val address: String = entry.project.fullAddress ?: "No address on file"
    val start: String = DateText.time(entry.startedAt)
    val startSource: String = if (entry.startedLocation != null) "GPS" else "Manual"
    val end: String = if (entry.isActive) "Now" else DateText.time(entry.endedAt)
    val endSource: String = if (entry.lastLocation != null) "GPS" else "Manual"
    val duration: String = DurationFormat.hoursMinutes(entry.duration(now))
    val summary: SegmentSummary = SegmentSummary(entry, now = now)

    /** `On Site · 42 m from site`. */
    val statusLine: String get() = "${summary.status.rawValue} · ${summary.distanceLabel}"
}

/** Uppercased section label used across the Timesheet. */
@Composable
fun TimesheetSectionLabel(text: String) {
    Text(text.uppercase(), style = appText(12, FontWeight.ExtraBold, TimesheetColors.muted, tracking = 0.8))
}

/**
 * The time the Timesheet is built for: refreshed on return to the app, when
 * the date changes, and every minute while a shift runs.
 */
@Composable
fun rememberTimesheetNow(): Instant {
    val tracker = LocalTracker.current
    val context = LocalContext.current
    val active by tracker.activeShift.collectAsStateWithLifecycle()
    var now by remember { mutableStateOf(Instant.now()) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { now = Instant.now() }
    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                now = Instant.now()
            }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(Intent.ACTION_DATE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose { context.unregisterReceiver(receiver) }
    }
    // Keep the running shift's duration moving while it is on screen.
    LaunchedEffect(active?.localId) {
        now = Instant.now()
        if (active == null) return@LaunchedEffect
        while (true) {
            delay(60_000)
            now = Instant.now()
        }
    }
    return now
}

/** The signed-in person's entries, the running shift first; recomposes when they change. */
@Composable
fun rememberTimesheetEntries(): List<TimeEntry> {
    val tracker = LocalTracker.current
    val active by tracker.activeShift.collectAsStateWithLifecycle()
    val entries by tracker.entries.collectAsStateWithLifecycle()
    return remember(active, entries) { listOfNotNull(active) + entries }
}

/** A pushed day by id, from whichever of the recent periods holds it. */
fun timesheetDay(id: String, entries: List<TimeEntry>, now: Instant): TimesheetDay? {
    val period = PayPeriod.recent(now = now).firstOrNull { it.contains(dayKey = id) } ?: return null
    return TimesheetBuilder.days(period, entries = entries, now = now).firstOrNull { it.id == id }
}
