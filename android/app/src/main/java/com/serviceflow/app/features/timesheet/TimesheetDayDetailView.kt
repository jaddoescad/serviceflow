package com.serviceflow.app.features.timesheet

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.MainTab
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.bordered
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.SegmentSummary
import com.serviceflow.core.TimesheetDay

/** A pushed day: looked up again on every change, so edits and deletes show at once. */
@Composable
fun TimesheetDayScreen(dayId: String, onBack: () -> Unit) {
    val now = rememberTimesheetNow()
    val entries = rememberTimesheetEntries()
    val day = timesheetDay(dayId, entries, now)
    if (day != null) {
        TimesheetDayDetailView(day, now, onBack)
    } else {
        TimesheetUnavailable("", "No clock-ins", "This day has no time logged.", onBack)
    }
}

/** One day's clock-ins with on-site / off-site totals. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimesheetDayDetailView(day: TimesheetDay, now: java.time.Instant, onBack: () -> Unit) {
    val session = LocalSession.current
    Scaffold(
        containerColor = TimesheetColors.bg,
        topBar = {
            TopAppBar(
                title = { Text("${day.weekday}, ${day.fullDate()}") },
                navigationIcon = { BackButton(onBack) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = TimesheetColors.bg),
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item { DaySummaryCard(day) }
            item {
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    TimesheetSectionLabel("Clock-ins")
                    Text("${day.entries.size}", style = appText(12, FontWeight.Bold, TimesheetColors.muted))
                }
            }
            items(day.entries, key = { it.localId }) { entry ->
                TimesheetEntryCard(TimesheetEntryInfo(entry, now)) {
                    session.navigator.push(MainTab.Timesheet) { back ->
                        TimesheetEditTimeScreen(dayId = day.id, entryId = entry.localId, onBack = back,
                                                onFinished = { session.navigator.popToRoot(MainTab.Timesheet) })
                    }
                }
            }
        }
    }
}

@Composable
private fun DaySummaryCard(day: TimesheetDay) {
    Column(
        Modifier
            .fillMaxWidth()
            .bordered(16.dp, border = TimesheetColors.border, background = TimesheetColors.surface)
            .padding(16.dp),
    ) {
        Text("TOTAL TIME", style = appText(11, FontWeight.Black, TimesheetColors.teal, tracking = 0.8))
        Text(day.total, style = appText(28, FontWeight.Black, TimesheetColors.ink, tracking = -0.8), modifier = Modifier.padding(top = 4.dp))
        Row(
            Modifier.padding(top = 12.dp).horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Chip(Icons.Filled.LocationOn, TimesheetColors.teal, "${DurationFormat.hoursMinutes(minutes = day.onSiteMinutes)} on site",
                 TimesheetColors.tealSoft, TimesheetColors.tealInk)
            Chip(Icons.Filled.DirectionsCar, TimesheetColors.inkSoft, "${DurationFormat.hoursMinutes(minutes = day.offSiteMinutes)} off site",
                 TimesheetColors.greySoft, TimesheetColors.inkSoft)
            if (day.unknownMinutes > 0) {
                Chip(Icons.Outlined.HelpOutline, TimesheetColors.inkSoft,
                     "${DurationFormat.hoursMinutes(minutes = day.unknownMinutes)} not recorded",
                     TimesheetColors.greySoft, TimesheetColors.inkSoft)
            }
        }
    }
}

@Composable
private fun Chip(icon: ImageVector, iconColor: Color, text: String, background: Color, color: Color) {
    Row(
        Modifier.background(background, CircleShape).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        AppIcon(icon, 13.dp, iconColor)
        Text(text, style = appText(12.5, FontWeight.ExtraBold, color), maxLines = 1)
    }
}

/** A clock-in card on the day screen. */
@Composable
fun TimesheetEntryCard(info: TimesheetEntryInfo, onClick: () -> Unit) {
    val style = TimesheetStatusStyle.of(info.summary.status)
    Column(
        Modifier
            .fillMaxWidth()
            .bordered(14.dp, border = TimesheetColors.border, background = TimesheetColors.surface)
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp, horizontal = 13.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(32.dp).background(style.circle, CircleShape), contentAlignment = Alignment.Center) {
                AppIcon(style.icon, 15.dp, Color.White)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(info.job, style = appText(14.5, FontWeight.Black, TimesheetColors.ink, tracking = -0.2),
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(info.address, style = appText(12, FontWeight.SemiBold, TimesheetColors.muted),
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(info.duration, style = appText(14.5, FontWeight.Black, TimesheetColors.ink))
        }

        Box(Modifier.padding(vertical = 11.dp).fillMaxWidth().height(1.dp).background(TimesheetColors.divider))

        Row(verticalAlignment = Alignment.CenterVertically) {
            TimeColumn("IN", info.start, info.startSource, Modifier.weight(1f))
            AppIcon(Icons.AutoMirrored.Filled.ArrowForward, 15.dp, TimesheetColors.muted, Modifier.padding(horizontal = 8.dp))
            TimeColumn("OUT", info.end, info.endSource, Modifier.weight(1f))
            AppIcon(Icons.AutoMirrored.Filled.KeyboardArrowRight, 20.dp, MaterialTheme.colorScheme.outline, Modifier.padding(start = 8.dp))
        }

        Row(
            Modifier
                .padding(top = 11.dp)
                .background(style.pill, CircleShape)
                .padding(horizontal = 9.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(6.dp).background(style.dot, CircleShape))
            Text(info.statusLine, style = appText(11.5, FontWeight.ExtraBold, style.text), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }

        if (info.summary.status == SegmentSummary.Status.Mixed) {
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("On site ${DurationFormat.hoursMinutes(info.summary.onSite)}", style = appText(11.5, FontWeight.Bold, TimesheetColors.muted))
                Text("·", style = appText(12, FontWeight.Black, TimesheetColors.border))
                Text("Off site ${DurationFormat.hoursMinutes(info.summary.offSite)}", style = appText(11.5, FontWeight.Bold, TimesheetColors.muted))
            }
        }
    }
}

@Composable
private fun TimeColumn(label: String, value: String, source: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(label, style = appText(10.5, FontWeight.ExtraBold, TimesheetColors.muted, tracking = 0.6))
        Text(value, style = appText(14.5, FontWeight.Black, TimesheetColors.ink, tracking = -0.2),
             modifier = Modifier.padding(top = 2.dp), maxLines = 1)
        Text(source, style = appText(11, FontWeight.Bold, TimesheetColors.muted), modifier = Modifier.padding(top = 1.dp))
    }
}

@Composable
internal fun BackButton(onBack: () -> Unit) {
    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
}

/** A pushed screen whose day or clock-in no longer exists. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TimesheetUnavailable(title: String, heading: String, message: String, onBack: () -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text(title) }, navigationIcon = { BackButton(onBack) }) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        ) {
            AppIcon(Icons.Outlined.Schedule, 48.dp, MaterialTheme.colorScheme.onSurfaceVariant)
            Text(heading, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                 textAlign = TextAlign.Center)
        }
    }
}
