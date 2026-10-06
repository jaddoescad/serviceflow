package com.serviceflow.app.features.clockin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.backend.latestActiveProject
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.OverBudgetPromptItem
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.Spinner
import com.serviceflow.core.BackendError
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.Geo
import com.serviceflow.core.LocationPoint
import com.serviceflow.core.Project
import com.serviceflow.core.TimeEntry
import com.serviceflow.core.TrackingConstants
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The Clock In tab: a map to pick a job while clocked out, the running shift while clocked in. */
@Composable
fun ClockInScreen(enabled: Boolean) {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val activeShift by tracker.activeShift.collectAsStateWithLifecycle()

    // Clocking out pushes the job, so this screen leaves; the question is shown by the shell.
    fun promptOverBudget(entry: TimeEntry) {
        session.scope.launch {
            val hours = session.overBudgetHours(jobId = entry.project.id) ?: return@launch
            session.navigator.overBudget = OverBudgetPromptItem(jobId = entry.project.id, projectName = entry.project.name, hoursOver = hours)
        }
    }

    if (activeShift != null) {
        ActiveShiftView(enabled = enabled, onClockedOut = ::promptOverBudget)
    } else {
        ClockedOutView()
    }
}

// MARK: - Clocked out

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClockedOutView() {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    val notice by tracker.notice.collectAsStateWithLifecycle()

    val search = rememberProjectSearch()
    var selected by remember { mutableStateOf<Project?>(null) }
    var latest by remember { mutableStateOf<Project?>(null) }
    var loadingLatest by remember { mutableStateOf(true) }
    var latestError by remember { mutableStateOf<String?>(null) }
    var userPoint by remember { mutableStateOf<LocationPoint?>(null) }
    var clockingIn by remember { mutableStateOf(false) }
    var clockInError by remember { mutableStateOf<String?>(null) }
    var panelHeight by remember { mutableStateOf(0.dp) }

    // The pin or result tapped, else the nearest job within 2 km, else the most recent job.
    val displayProject = selected
        ?: userPoint?.let { point -> Geo.nearest(session.mappedProjects, point.coordinate) }
            ?.takeIf { it.distance <= TrackingConstants.nearestProjectRadius }?.project
        ?: latest

    fun hideKeyboard() {
        focus.clearFocus()
        keyboard?.hide()
    }

    fun select(project: Project) {
        hideKeyboard()
        selected = project
        search.clear()
        clockInError = null
    }

    fun startClockIn() {
        val project = displayProject
        if (clockingIn || project == null) return
        hideKeyboard()
        clockingIn = true
        clockInError = null
        tracker.clearNotice()
        // The session's scope: this view leaves as soon as the shift starts.
        session.scope.launch {
            try {
                session.clockIn(project)
                selected = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                clockInError = e.message?.takeIf { it.isNotEmpty() } ?: "Clock in could not start. Try again."
            }
            clockingIn = false
        }
    }

    LaunchedEffect(Unit) {
        loadingLatest = true
        try {
            latest = session.api.latestActiveProject()
            latestError = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            latestError = (e as? BackendError)?.message
        }
        loadingLatest = false
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(title = { Text("Clock In") })
        ProjectSearchField(search, "Search jobs and leads", Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 8.dp))
        Box(Modifier.fillMaxWidth().weight(1f)) {
            val showPanel = displayProject?.isLead != true
            ClockInMap(
                projects = session.mappedProjects,
                selected = displayProject,
                userPoint = userPoint,
                onUserPoint = { userPoint = it },
                onSelect = ::select,
                contentPadding = PaddingValues(bottom = if (showPanel) panelHeight else 0.dp),
            )
            if (showPanel) {
                ClockInPanel(
                    project = displayProject,
                    loadingLatest = loadingLatest,
                    latestError = latestError,
                    message = notice?.message ?: clockInError,
                    clockingIn = clockingIn,
                    onOpen = { displayProject?.let { session.open(it) } },
                    onClockIn = ::startClockIn,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .onSizeChanged { panelHeight = with(density) { it.height.toDp() } },
                )
            }
            if (search.hasQuery) {
                Surface(Modifier.fillMaxSize()) {
                    LazyColumn {
                        if (search.isSearching && search.results.isEmpty()) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { Spinner(Palette.teal) }
                            }
                        } else if (search.results.isEmpty()) {
                            item {
                                Text(
                                    search.error ?: "No matching jobs or leads found.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp),
                                )
                            }
                        }
                        items(search.results, key = { it.id }) { result ->
                            ProjectListRow(result, Modifier.clickable { select(result) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ClockInPanel(
    project: Project?,
    loadingLatest: Boolean,
    latestError: String?,
    message: String?,
    clockingIn: Boolean,
    onOpen: () -> Unit,
    onClockIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    // Today's total includes the entries list; re-read it every 30 s.
    val entries by tracker.entries.collectAsStateWithLifecycle()
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            tick += 1
        }
    }
    val workedToday = remember(entries, tick) { tracker.workedToday() }

    Surface(
        shape = RoundedCornerShape(22.dp),
        shadowElevation = 6.dp,
        modifier = modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(session.displayName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                     modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${DurationFormat.hoursMinutes(workedToday)} today",
                    style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Row(
                Modifier.fillMaxWidth().clickable(enabled = project != null, onClick = onOpen),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AppIcon(Icons.Filled.LocationOn, 28.dp, Palette.teal)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    when {
                        loadingLatest && project == null -> Spinner(Palette.teal)
                        project != null -> {
                            Text(project.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                                 maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(project.cardAddress ?: "No address on file", style = MaterialTheme.typography.bodyMedium,
                                 color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        else -> {
                            Text("No active job", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(latestError ?: "Search for a job to clock in.", style = MaterialTheme.typography.bodyMedium,
                                 color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                if (project != null) {
                    AppIcon(Icons.AutoMirrored.Filled.KeyboardArrowRight, 20.dp, MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            if (message != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    AppIcon(Icons.Filled.Error, 16.dp, MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            Button(
                onClick = onClockIn,
                enabled = !clockingIn && project != null && !project.isLead,
                colors = ButtonDefaults.buttonColors(containerColor = Palette.navy),
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).semantics { contentDescription = "Start clock in" },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Row(Modifier.alpha(if (clockingIn) 0f else 1f), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Clock In", style = MaterialTheme.typography.titleMedium)
                    }
                    if (clockingIn) Spinner(MaterialTheme.colorScheme.onPrimary)
                }
            }
        }
    }
}
