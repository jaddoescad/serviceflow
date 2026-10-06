package com.serviceflow.app.features.projectdetail

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.design.Palette
import com.serviceflow.app.features.timesheet.TimeEntryEditModel
import com.serviceflow.core.DateText
import com.serviceflow.core.DistanceFormat
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.SegmentSummary
import com.serviceflow.core.TimeEntry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Edit one of your own clock-ins from Project Detail (pushed).
 * [onChanged] is called after a successful save or delete.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailEditTime(entry: TimeEntry, painterName: String, onChanged: (deleted: Boolean) -> Unit, onBack: () -> Unit) {
    val tracker = LocalTracker.current
    val scope = rememberCoroutineScope()
    val edit = remember(entry.localId) { TimeEntryEditModel(entry) }
    var confirmDelete by remember { mutableStateOf(false) }
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            now = Instant.now()
        }
    }

    fun save() {
        scope.launch {
            if (!edit.save(tracker)) return@launch
            onChanged(false)
            onBack()
        }
    }

    fun delete() {
        scope.launch {
            edit.delete(tracker)
            onChanged(true)
            onBack()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Edit Time") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    if (edit.busy) {
                        CircularProgressIndicator(Modifier.padding(horizontal = 16.dp).size(20.dp), strokeWidth = 2.dp)
                    } else {
                        TextButton(onClick = ::save, enabled = edit.canSave) { Text("Save") }
                    }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            GroupCard {
                Field("Crew member") { Text(painterName) }
                HorizontalDivider(Modifier.padding(start = 16.dp))
                Field("Job") {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Place, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(edit.entry.project.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                HorizontalDivider(Modifier.padding(start = 16.dp))
                Field("Location") { Text(locationText(edit.entry)) }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SectionLabel("Time")
                GroupCard {
                    DateTimeField("Clock in", edit.startAt, earliest = null, latest = now) { edit.startAt = it }
                    HorizontalDivider(Modifier.padding(start = 16.dp))
                    if (edit.isActive) {
                        Field("Clock out") { Text("In progress") }
                    } else {
                        DateTimeField("Clock out", edit.endAt, earliest = edit.startAt, latest = now) { edit.endAt = it }
                    }
                    HorizontalDivider(Modifier.padding(start = 16.dp))
                    Field("Duration") { Text(DurationFormat.hoursMinutes(edit.duration(now))) }
                }
                val footer = listOfNotNull(edit.originalTimeNote, if (edit.isActive) TimeEntryEditModel.IN_PROGRESS_HINT else null)
                footer.forEach { line ->
                    Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                         modifier = Modifier.padding(horizontal = 16.dp))
                }
            }

            edit.error?.let { error ->
                GroupCard { Text(error, color = Palette.red, modifier = Modifier.padding(16.dp)) }
            }

            GroupCard {
                TextButton(onClick = { confirmDelete = true }, enabled = !edit.busy, modifier = Modifier.fillMaxWidth()) {
                    Text("Delete Time Entry", color = if (edit.busy) Color.Unspecified else Palette.red)
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete time entry?") },
            text = { Text("This can't be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    delete()
                }) { Text("Delete", color = Palette.red) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

private fun locationText(entry: TimeEntry): String {
    val summary = SegmentSummary(entry, now = Instant.now())
    val status = ProjectDetailSiteStatus.of(summary.status).label
    val distance = summary.latestDistance ?: return status
    return "$status · ${DistanceFormat.meters(distance)} from site"
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
         modifier = Modifier.padding(horizontal = 16.dp))
}

/** A label with its value on the trailing side. */
@Composable
private fun Field(label: String, value: @Composable () -> Unit) {
    ListItem(
        headlineContent = { Text(label) },
        trailingContent = value,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/** A date and a time, each opening its picker; the result is kept within [earliest]…[latest]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateTimeField(label: String, value: Instant, earliest: Instant?, latest: Instant, onChange: (Instant) -> Unit) {
    val zone = ZoneId.systemDefault()
    val context = LocalContext.current
    var picking by remember { mutableStateOf<String?>(null) }
    val local = value.atZone(zone)

    fun set(date: LocalDate, time: LocalTime) {
        var next = date.atTime(time).atZone(zone).toInstant()
        if (next > latest) next = latest
        if (earliest != null && next < earliest) next = earliest
        onChange(next)
    }

    ListItem(
        headlineContent = { Text(label) },
        trailingContent = {
            Row {
                TextButton(onClick = { picking = "date" }) { Text(DateText.format(value, "MMMdy")) }
                TextButton(onClick = { picking = "time" }) { Text(DateText.time(value)) }
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )

    when (picking) {
        "date" -> {
            val firstDay = earliest?.atZone(zone)?.toLocalDate()
            val lastDay = latest.atZone(zone).toLocalDate()
            val state = rememberDatePickerState(
                initialSelectedDateMillis = local.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
                selectableDates = object : SelectableDates {
                    override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                        val day = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                        return !day.isAfter(lastDay) && (firstDay == null || !day.isBefore(firstDay))
                    }
                },
            )
            DatePickerDialog(
                onDismissRequest = { picking = null },
                confirmButton = {
                    TextButton(onClick = {
                        state.selectedDateMillis?.let { millis ->
                            set(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate(), local.toLocalTime())
                        }
                        picking = null
                    }) { Text("OK") }
                },
                dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel") } },
            ) { DatePicker(state) }
        }
        "time" -> {
            val state = rememberTimePickerState(local.hour, local.minute, is24Hour = DateFormat.is24HourFormat(context))
            AlertDialog(
                onDismissRequest = { picking = null },
                confirmButton = {
                    TextButton(onClick = {
                        set(local.toLocalDate(), LocalTime.of(state.hour, state.minute))
                        picking = null
                    }) { Text("OK") }
                },
                dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel") } },
                text = { TimePicker(state) },
            )
        }
    }
}
