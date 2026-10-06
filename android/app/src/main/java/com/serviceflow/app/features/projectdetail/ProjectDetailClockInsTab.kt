package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.OverBudgetPromptItem
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.jobs.BudgetHoursPanel
import com.serviceflow.app.features.jobs.ContentUnavailable
import com.serviceflow.app.features.media.JobPhotosPanel
import com.serviceflow.core.DateText
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.HoursFormat
import com.serviceflow.core.Initials
import com.serviceflow.core.Project
import com.serviceflow.core.ProjectClockIns
import com.serviceflow.core.TimeEntry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Project Detail's Clock Ins tab: the job, its hours, the clock button,
 * photos, time by crew member and the task list.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailClockInsTab(
    project: Project,
    title: String,
    model: ProjectDetailModel,
    clockIns: JobClockIns,
    onOpenMedia: () -> Unit,
    onOverBudget: (OverBudgetPromptItem) -> Unit,
    onOpenPainter: (userId: String) -> Unit,
) {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val activeShift by tracker.activeShift.collectAsStateWithLifecycle()
    val clockingOut by tracker.isClockingOut.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                model.refresh(session.api)
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            GroupCard {
                InfoRow(project, title)
                val shift = activeShift
                if (shift != null && shift.project.id == project.id && !clockingOut) {
                    HorizontalDivider(Modifier.padding(start = 16.dp))
                    CurrentRow(shift)
                }
            }

            GroupCard { HoursPanel(model, clockIns) }

            ProjectDetailClockButton(
                project = project, title = title, onOverBudget = onOverBudget,
                onHoursChanged = { model.refreshBudget(session.api) },
            )

            JobPhotosPanel(project = project, showCamera = false, onOpenAll = onOpenMedia)

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val summaries = clockIns.summaries
                Row(Modifier.padding(horizontal = 16.dp)) {
                    val days = ProjectClockIns.dayCount(summaries, userId = session.user.id)
                    Text(if (session.isManager) "Hours by Crew" else "Your Clock-ins", style = MaterialTheme.typography.titleSmall,
                         color = colors.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(
                        if (session.isManager) "${summaries.size} crew" else "$days ${if (days == 1) "day" else "days"}",
                        style = MaterialTheme.typography.titleSmall, color = colors.onSurfaceVariant,
                    )
                }
                GroupCard {
                    if (summaries.isEmpty()) {
                        ContentUnavailable(
                            icon = Icons.Outlined.Schedule,
                            title = "No clock-ins yet",
                            description = { Text("Time entries will appear here after the crew clocks into this project.") },
                        )
                    } else {
                        summaries.forEachIndexed { index, summary ->
                            if (index > 0) HorizontalDivider(Modifier.padding(start = 62.dp))
                            ProjectDetailPainterRow(
                                summary,
                                Modifier.fillMaxWidth().clickable { onOpenPainter(summary.userId) }.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            }

            LabourTasksPanel(project = project, showHoursMeter = false, enabled = true)

            // Room above the floating camera button.
            Spacer(Modifier.height(60.dp))
        }
    }
}

@Composable
private fun InfoRow(project: Project, title: String) {
    val colors = MaterialTheme.colorScheme
    Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(42.dp).background(DetailPalette.brand.copy(alpha = 0.12f), CircleShape), contentAlignment = Alignment.Center) {
            Text(Initials.of(title, fallback = "P"), style = appText(14, FontWeight.SemiBold, DetailPalette.brand))
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = appText(16, FontWeight.SemiBold, colors.onSurface), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Filled.Place, contentDescription = null, tint = colors.onSurfaceVariant, modifier = Modifier.size(15.dp).padding(top = 1.dp))
                Text(project.fullAddress ?: "No address on file", style = appText(13, color = colors.onSurfaceVariant),
                     maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun CurrentRow(shift: TimeEntry) {
    val colors = MaterialTheme.colorScheme
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            now = Instant.now()
        }
    }
    Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).background(DetailPalette.brand, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Schedule, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Current clock-in · since ${DateText.time(shift.startedAt)}", style = appText(13, color = colors.onSurfaceVariant))
            Text(DurationFormat.elapsedClock(shift.duration(now)),
                 style = appText(22, FontWeight.SemiBold, colors.onSurface).copy(fontFeatureSettings = "tnum"))
        }
        Box(Modifier.size(10.dp).background(hex(0x27ae60), CircleShape))
    }
}

@Composable
private fun HoursPanel(model: ProjectDetailModel, clockIns: JobClockIns) {
    val session = LocalSession.current
    val me = session.user
    val isMine: (TimeEntry) -> Boolean = { it.userId == me.id || (it.userEmail != null && it.userEmail == me.email) }
    val yourSeconds = clockIns.entries.filter(isMine).sumOf { it.duration(clockIns.now) }
    val teamSeconds = clockIns.entries.sumOf { it.duration(clockIns.now) }
    BudgetHoursPanel(
        progress = model.shownBudget,
        loading = model.budgetLoading,
        yourHours = HoursFormat.fromMilliseconds(yourSeconds * 1000),
        secondaryLabel = if (session.isManager) "Team total" else "Entries shown",
        secondaryValue = HoursFormat.fromMilliseconds(teamSeconds * 1000),
        modifier = Modifier.padding(16.dp),
    )
}
