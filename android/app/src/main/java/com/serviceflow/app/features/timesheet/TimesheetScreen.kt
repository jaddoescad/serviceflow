package com.serviceflow.app.features.timesheet

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.Work
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.MainTab
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.bordered
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.Initials
import com.serviceflow.core.PayPeriod
import com.serviceflow.core.TimesheetBuilder
import com.serviceflow.core.TimesheetDay
import kotlinx.coroutines.launch

private val sectionTitles = listOf("This Week", "Last Week", "2 Weeks Ago")

/**
 * The signed-in person's own time: three Monday–Sunday weeks, each day of
 * the week since account creation shown (missing days in red). Days and edits are pushed on the
 * tab's back stack.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimesheetScreen() {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val scope = rememberCoroutineScope()
    val now = rememberTimesheetNow()
    val entries = rememberTimesheetEntries()
    var periodId by rememberSaveable { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var showPeriods by remember { mutableStateOf(false) }

    val periods = remember(now) { PayPeriod.recent(now = now) }
    val index = periods.indexOfFirst { it.id == periodId }.coerceAtLeast(0)
    val period = periods.getOrNull(index)
    val days = remember(period, entries, now, session.accountCreatedAt) {
        period?.let { TimesheetBuilder.days(it, entries = entries, now = now, accountCreatedAt = session.accountCreatedAt) } ?: emptyList()
    }
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        containerColor = TimesheetColors.bg,
        topBar = {
            LargeTopAppBar(
                title = { Text("Timesheet") },
                scrollBehavior = scrollBehavior,
                colors = TopAppBarDefaults.topAppBarColors(containerColor = TimesheetColors.bg),
                actions = {
                    Box {
                        IconButton(
                            onClick = { showPeriods = true },
                            modifier = Modifier.semantics { contentDescription = "Select pay period, currently ${period?.label ?: ""}" },
                        ) { Icon(Icons.Filled.CalendarMonth, contentDescription = null) }
                        DropdownMenu(expanded = showPeriods, onDismissRequest = { showPeriods = false }) {
                            periods.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.label) },
                                    leadingIcon = {
                                        if (option.id == period?.id) Icon(Icons.Filled.Check, contentDescription = null)
                                        else Spacer(Modifier.size(24.dp))
                                    },
                                    onClick = {
                                        periodId = option.id
                                        showPeriods = false
                                    },
                                )
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    tracker.refresh()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(start = 16.dp, end = 16.dp, bottom = 36.dp),
            ) {
                SummaryCard(session.displayName, days, Modifier.padding(top = 4.dp))

                Row(Modifier.padding(top = 22.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    TimesheetSectionLabel(sectionTitles[minOf(index, sectionTitles.size - 1)])
                    Spacer(Modifier.weight(1f))
                    Text(period?.label ?: "", style = appText(12, FontWeight.SemiBold, TimesheetColors.muted))
                }

                Timeline(days) { day ->
                    session.navigator.push(MainTab.Timesheet) { onBack -> TimesheetDayScreen(day.id, onBack) }
                }
            }
        }
    }
}

// MARK: Summary

@Composable
private fun SummaryCard(name: String, days: List<TimesheetDay>, modifier: Modifier = Modifier) {
    val total = TimesheetBuilder.weekTotalMinutes(days)
    val jobs = days.flatMap { it.entries }.map { it.project.id }.toSet().size
    val daysWorked = TimesheetBuilder.daysWorked(days)
    Column(
        modifier
            .fillMaxWidth()
            .background(TimesheetColors.green, RoundedCornerShape(16.dp))
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).background(TimesheetColors.teal, CircleShape), contentAlignment = Alignment.Center) {
                Text(Initials.of(name, fallback = "C"), style = appText(15, FontWeight.ExtraBold, Color.White, tracking = 0.4))
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name, style = appText(16, FontWeight.ExtraBold, Color.White), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Weekly Summary", style = appText(12, FontWeight.SemiBold, TimesheetColors.summaryLabel))
            }
        }
        Row(
            Modifier
                .padding(top = 16.dp)
                .fillMaxWidth()
                .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(12.dp))
                .padding(vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Stat(DurationFormat.hoursMinutes(minutes = total), "Logged")
            StatDivider()
            Stat("$daysWorked", if (daysWorked == 1) "Day" else "Days")
            StatDivider()
            Stat("$jobs", if (jobs == 1) "Job" else "Jobs")
        }
    }
}

@Composable
private fun StatDivider() {
    Box(Modifier.width(1.dp).height(26.dp).background(Color.White.copy(alpha = 0.18f)))
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Stat(value: String, label: String) {
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(value, style = appText(16, FontWeight.Black, Color.White, tracking = -0.3), maxLines = 1)
        Text(label.uppercase(), style = appText(11.5, FontWeight.Bold, TimesheetColors.summaryLabel, tracking = 0.4))
    }
}

// MARK: Timeline

@Composable
private fun Timeline(days: List<TimesheetDay>, onOpen: (TimesheetDay) -> Unit) {
    Column(
        Modifier.drawBehind {
            // The vertical line behind the day markers.
            val height = size.height - 56.dp.toPx()
            if (height > 0) {
                drawRoundRect(
                    TimesheetColors.border,
                    topLeft = Offset((56 + 12 - 1).dp.toPx(), 26.dp.toPx()),
                    size = Size(2.dp.toPx(), height),
                    cornerRadius = CornerRadius(1.dp.toPx()),
                )
            }
        },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        days.forEach { day -> TimesheetDayRow(day) { onOpen(day) } }
    }
}

/** One day on the timeline: date, marker and card. Worked days open the day. */
@Composable
private fun TimesheetDayRow(day: TimesheetDay, onOpen: () -> Unit) {
    // No intrinsic height here: a wrapped FlowRow under-reports it and the card gets clipped.
    Row {
        Column(
            Modifier.width(56.dp).align(Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(day.weekday, style = appText(13.5, FontWeight.ExtraBold, TimesheetColors.ink))
            Text(day.date, style = appText(12, FontWeight.SemiBold, TimesheetColors.muted))
        }

        Box(Modifier.width(24.dp).padding(top = 18.dp), contentAlignment = Alignment.TopCenter) {
            Box(
                Modifier
                    .size(22.dp)
                    .background(if (day.isWorked) TimesheetColors.teal else TimesheetColors.red, CircleShape)
                    .border(3.dp, TimesheetColors.bg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                AppIcon(if (day.isWorked) Icons.Filled.Check else Icons.Filled.PriorityHigh, 11.dp, Color.White)
            }
        }

        Box(Modifier.weight(1f).padding(start = 8.dp)) {
            if (day.isWorked) WorkedCard(day, onOpen) else MissingCard()
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorkedCard(day: TimesheetDay, onOpen: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .bordered(12.dp, border = TimesheetColors.border, background = TimesheetColors.surface)
            .clickable(onClick = onOpen)
            .padding(vertical = 12.dp, horizontal = 13.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(day.total, style = appText(17, FontWeight.Black, TimesheetColors.ink, tracking = -0.4), modifier = Modifier.weight(1f))
            AppIcon(Icons.AutoMirrored.Filled.KeyboardArrowRight, 20.dp, MaterialTheme.colorScheme.outline)
        }
        FlowRow(
            Modifier.padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            day.jobs.forEach { job ->
                Row(
                    Modifier
                        .background(TimesheetColors.tealSoft, CircleShape)
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    AppIcon(Icons.Filled.Work, 10.dp, TimesheetColors.tealInk)
                    Text(job, style = appText(11.5, FontWeight.ExtraBold, TimesheetColors.tealInk), maxLines = 1,
                         overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Box(Modifier.padding(top = 10.dp).fillMaxWidth().height(1.dp).background(TimesheetColors.divider))
        FlowRow(
            Modifier.padding(top = 10.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Meta(Icons.Filled.LocationOn, TimesheetColors.teal, "On site ", DurationFormat.hoursMinutes(minutes = day.onSiteMinutes))
            Meta(Icons.Filled.DirectionsCar, TimesheetColors.muted, "Off site ", DurationFormat.hoursMinutes(minutes = day.offSiteMinutes))
            if (day.unknownMinutes > 0) {
                Meta(Icons.Outlined.HelpOutline, TimesheetColors.muted, "Not recorded ",
                     DurationFormat.hoursMinutes(minutes = day.unknownMinutes))
            }
        }
    }
}

@Composable
private fun Meta(icon: ImageVector, color: Color, label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        AppIcon(icon, 12.dp, color)
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = TimesheetColors.muted)) { append(label) }
                withStyle(SpanStyle(fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = TimesheetColors.ink)) { append(value) }
            },
            maxLines = 1,
        )
    }
}

@Composable
private fun MissingCard() {
    Column(
        Modifier
            .fillMaxWidth()
            .bordered(12.dp, border = TimesheetColors.redBorder, background = TimesheetColors.redBg)
            .padding(vertical = 12.dp, horizontal = 13.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AppIcon(Icons.Filled.Cancel, 15.dp, TimesheetColors.red)
            Text("No clock-in", style = appText(14, FontWeight.ExtraBold, TimesheetColors.redInk))
        }
        Text("No time logged", style = appText(12.5, FontWeight.SemiBold, TimesheetColors.red))
    }
}
