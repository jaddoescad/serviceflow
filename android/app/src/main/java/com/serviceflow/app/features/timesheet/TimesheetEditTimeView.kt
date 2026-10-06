package com.serviceflow.app.features.timesheet

import android.text.format.DateFormat
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.SwapHorizontalCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.Spinner
import com.serviceflow.core.DateText
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.SegmentSummary
import com.serviceflow.core.TimeEntry
import com.serviceflow.core.TimesheetDay
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

/** A pushed edit screen; the entry is looked up by id in its day. */
@Composable
fun TimesheetEditTimeScreen(dayId: String, entryId: String, onBack: () -> Unit, onFinished: () -> Unit) {
    val session = LocalSession.current
    val now = rememberTimesheetNow()
    val entries = rememberTimesheetEntries()
    val day = timesheetDay(dayId, entries, now)
    val entry = day?.entries?.firstOrNull { it.localId == entryId }
    // The form keeps the entry it opened with, like the iOS screen's state.
    val opened = remember(entryId) { mutableStateOf<Pair<TimeEntry, TimesheetDay>?>(null) }
    if (opened.value == null && entry != null && day != null) opened.value = entry to day
    val shown = opened.value
    if (shown != null) {
        TimesheetEditTimeView(shown.first, shown.second, session.displayName, onBack, onFinished)
    } else {
        TimesheetUnavailable("Edit Time", "Clock-in not found", "It may have been changed or deleted.", onBack)
    }
}

private const val STEP_SECONDS = 5L * 60

/** Edit the start and end of one of your own clock-ins, or delete it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimesheetEditTimeView(
    entry: TimeEntry,
    day: TimesheetDay,
    painterName: String,
    onBack: () -> Unit,
    /** Saved or deleted: return to the list. */
    onFinished: () -> Unit,
) {
    val tracker = LocalTracker.current
    val scope = rememberCoroutineScope()
    val edit = remember(entry.localId) { TimeEntryEditModel(entry) }
    var confirmingDelete by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<Boolean?>(null) } // true: clock-in, false: clock-out
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = Instant.now()
        }
    }
    val info = TimesheetEntryInfo(edit.entry, now)

    BackHandler(enabled = edit.busy) {}

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Edit Time") },
                navigationIcon = { if (!edit.busy) BackButton(onBack) },
                actions = {
                    if (edit.busy) {
                        Spinner(TimesheetColors.teal, Modifier.padding(end = 16.dp))
                    } else {
                        TextButton(
                            onClick = { scope.launch { if (edit.save(tracker)) onFinished() } },
                            enabled = edit.canSave,
                            modifier = Modifier.semantics { contentDescription = "Save changes" },
                        ) { Text("Save", fontWeight = FontWeight.SemiBold) }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            // Shift
            val status = editStatus(info.summary.status)
            ListItem(
                leadingContent = { AppIcon(Icons.Filled.Work, 20.dp, TimesheetColors.ink) },
                headlineContent = { Text(info.job, fontWeight = FontWeight.SemiBold, color = TimesheetColors.ink) },
                supportingContent = { Text(info.address, maxLines = 2) },
            )
            ValueRow("Crew member", painterName)
            ValueRow("Date", day.fullDate())
            ListItem(
                leadingContent = { AppIcon(status.icon, 22.dp, status.color) },
                headlineContent = { Text(status.label) },
            )
            ValueRow("Distance", info.summary.distanceLabel)

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text("Time", style = MaterialTheme.typography.titleSmall, color = TimesheetColors.teal,
                 modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))

            TimeRow("Clock-in", info.startSource, edit.startAt, enabled = !edit.busy) { picking = true }
            StepRow("clock-in time", enabled = !edit.busy) { edit.startAt = edit.startAt.plusSeconds(it) }

            if (edit.isActive) {
                ValueRow("Clock-out", "In progress")
            } else {
                TimeRow("Clock-out", info.endSource, edit.endAt, enabled = !edit.busy) { picking = false }
                StepRow("clock-out time", enabled = !edit.busy) { edit.endAt = edit.endAt.plusSeconds(it) }
            }
            ValueRow("Duration", DurationFormat.hoursMinutes(edit.duration(now)))

            val notes = listOfNotNull(edit.originalTimeNote, if (edit.isActive) TimeEntryEditModel.IN_PROGRESS_HINT else null)
            if (notes.isNotEmpty()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }

            edit.error?.let { error ->
                ListItem(
                    leadingContent = { AppIcon(Icons.Filled.Warning, 20.dp, TimesheetColors.redInk) },
                    headlineContent = { Text(error, color = TimesheetColors.redInk) },
                )
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            ListItem(
                modifier = Modifier
                    .clickable(enabled = !edit.busy) { confirmingDelete = true }
                    .semantics { contentDescription = "Delete time entry" },
                leadingContent = { Icon(Icons.Filled.Delete, contentDescription = null) },
                headlineContent = { Text("Delete Time Entry") },
                colors = ListItemDefaults.colors(
                    headlineColor = if (edit.busy) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                    leadingIconColor = if (edit.busy) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                ),
            )
        }
    }

    picking?.let { start ->
        TimePickerDialog(
            initial = if (start) edit.startAt else edit.endAt,
            onDismiss = { picking = null },
            onPick = { picked ->
                if (start) edit.startAt = picked else edit.endAt = picked
                picking = null
            },
        )
    }

    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text("Delete time entry?") },
            text = { Text("This can't be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    scope.launch {
                        edit.delete(tracker)
                        onFinished()
                    }
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ValueRow(label: String, value: String) {
    ListItem(
        headlineContent = { Text(label) },
        trailingContent = { Text(value, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) },
    )
}

@Composable
private fun TimeRow(title: String, source: String, time: Instant, enabled: Boolean, onPick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(source) },
        trailingContent = {
            TextButton(onClick = onPick, enabled = enabled) {
                Text(DateText.time(time), style = MaterialTheme.typography.titleMedium)
            }
        },
    )
}

/** −5m / +5m nudges for a time. */
@Composable
private fun StepRow(label: String, enabled: Boolean, change: (Long) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp, androidx.compose.ui.Alignment.End),
    ) {
        OutlinedButton(onClick = { change(-STEP_SECONDS) }, enabled = enabled,
                       modifier = Modifier.semantics { contentDescription = "Subtract 5 minutes from $label" }) { Text("-5m") }
        OutlinedButton(onClick = { change(STEP_SECONDS) }, enabled = enabled,
                       modifier = Modifier.semantics { contentDescription = "Add 5 minutes to $label" }) { Text("+5m") }
    }
}

/** Hour and minute on the same day as [initial]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimePickerDialog(initial: Instant, onDismiss: () -> Unit, onPick: (Instant) -> Unit) {
    val context = LocalContext.current
    val zone = ZoneId.systemDefault()
    val local = initial.atZone(zone)
    val state = rememberTimePickerState(local.hour, local.minute, is24Hour = DateFormat.is24HourFormat(context))
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { TimePicker(state) },
        confirmButton = {
            TextButton(onClick = {
                if (state.hour == local.hour && state.minute == local.minute) {
                    onDismiss()
                } else {
                    onPick(local.withHour(state.hour).withMinute(state.minute).withSecond(0).withNano(0).toInstant())
                }
            }) { Text("OK") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** How the edit screen describes where the clock-in happened. */
private class EditStatus(val icon: ImageVector, val label: String, val color: Color)

private fun editStatus(status: SegmentSummary.Status): EditStatus = when (status) {
    SegmentSummary.Status.Unavailable ->
        EditStatus(Icons.Filled.Help, "Location was not recorded for this clock-in", TimesheetColors.muted)
    SegmentSummary.Status.OnSite -> EditStatus(Icons.Filled.CheckCircle, "On site during clock-in", TimesheetColors.teal)
    SegmentSummary.Status.Mixed -> EditStatus(Icons.Filled.SwapHorizontalCircle, "On and off site during clock-in", TimesheetColors.teal)
    SegmentSummary.Status.OffSite -> EditStatus(Icons.Filled.Error, "Off site during clock-in", TimesheetColors.red)
}
