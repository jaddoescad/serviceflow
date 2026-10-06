package com.serviceflow.app.features.clockin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.ProjectRoute
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.Spinner
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.media.JobPhotosPanel
import com.serviceflow.app.features.projectdetail.LabourTasksPanel
import com.serviceflow.core.ClockOutReason
import com.serviceflow.core.DateText
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.Project
import com.serviceflow.core.TimeEntry
import com.serviceflow.core.timeIntervalSince
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

/** The running shift: timer, start-time edits, photos and tasks. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActiveShiftView(enabled: Boolean, onClockedOut: (TimeEntry) -> Unit) {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val shift by tracker.activeShift.collectAsStateWithLifecycle()
    val locationStatus by tracker.locationStatus.collectAsStateWithLifecycle()
    val suggestion by tracker.suggestedProject.collectAsStateWithLifecycle()
    val notice by tracker.notice.collectAsStateWithLifecycle()

    var clockingOut by remember { mutableStateOf(false) }
    var switching by remember { mutableStateOf(false) }
    var adjusting by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var showSwitcher by remember { mutableStateOf(false) }

    val project: Project? = shift?.let { current -> session.mappedProjects.firstOrNull { it.id == current.project.id } ?: current.project }

    fun clockOut() {
        if (clockingOut || project == null) return
        clockingOut = true
        actionError = null
        // Show the job while the shift closes, so the map never flashes.
        session.open(project)
        // The session's scope: this screen leaves as the job is pushed.
        session.scope.launch {
            val entry = session.clockOut(reason = ClockOutReason.Manual)
            if (entry != null) onClockedOut(entry) else actionError = "Clock out could not complete. Try again."
            clockingOut = false
        }
    }

    fun adjust(minutes: Int) {
        if (adjusting) return
        adjusting = true
        actionError = null
        scope.launch {
            try {
                tracker.adjustActiveStart(byMinutes = minutes)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                actionError = e.message ?: e.toString()
            }
            adjusting = false
        }
    }

    fun switchTo(next: Project) {
        if (switching) return
        if (next.id == project?.id) {
            showSwitcher = false
            return
        }
        switching = true
        actionError = null
        scope.launch {
            try {
                session.switchProject(to = next)
                focus.clearFocus()
                showSwitcher = false
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                actionError = e.message?.takeIf { it.isNotEmpty() } ?: "Switch could not complete. Try again."
            }
            switching = false
        }
    }

    val statusMessage = notice?.message
        ?: (if (!session.locationAuthorization.isAuthorized) "Location isn't recorded for this shift." else null)
        ?: locationStatus?.label
    val offSite = locationStatus?.onSite == false

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
        topBar = {
            TopAppBar(
                title = { Text(project?.name ?: "Clocked In", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    IconButton(
                        onClick = {
                            actionError = null
                            showSwitcher = true
                        },
                        enabled = !switching,
                    ) { Icon(Icons.Filled.SwapHoriz, contentDescription = "Change Job") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(project?.cardAddress ?: "No address on file", style = MaterialTheme.typography.bodyMedium,
                             color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (statusMessage != null) {
                            val color = if (offSite) hex(0xb56025) else Palette.teal
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                AppIcon(if (offSite) Icons.Filled.Warning else Icons.Filled.LocationOn, 16.dp, color)
                                Text(statusMessage, style = MaterialTheme.typography.bodySmall, color = color)
                            }
                        }
                    }

                    suggestion?.let { next ->
                        OutlinedButton(onClick = { switchTo(next) }, enabled = !switching, modifier = Modifier.fillMaxWidth(),
                                       colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.teal)) {
                            Icon(Icons.Filled.SwapHoriz, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(if (switching) "Switching…" else "Switch to ${next.name}", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }

                    ShiftTimer(shift?.startedAt)

                    Button(
                        onClick = ::clockOut,
                        enabled = !clockingOut,
                        colors = ButtonDefaults.buttonColors(containerColor = Palette.red),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).semantics { contentDescription = "Clock out current shift" },
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Row(Modifier.alpha(if (clockingOut) 0f else 1f), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.StopCircle, contentDescription = null, modifier = Modifier.size(20.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Clock Out", style = MaterialTheme.typography.titleMedium)
                            }
                            if (clockingOut) Spinner(MaterialTheme.colorScheme.onError)
                        }
                    }

                    actionError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.red) }

                    HorizontalDivider()

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Started", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(DateText.time(shift?.startedAt), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                shift?.startAdjustmentMinutes?.let { minutes ->
                                    Text("Edited ${if (minutes > 0) "+" else ""}${minutes}m", style = MaterialTheme.typography.labelMedium,
                                         color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { adjust(-5) }, enabled = !adjusting,
                                           modifier = Modifier.semantics { contentDescription = "Move start time 5 minutes earlier" }) {
                                Text("−5m")
                            }
                            OutlinedButton(onClick = { adjust(5) }, enabled = !adjusting,
                                           modifier = Modifier.semantics { contentDescription = "Move start time 5 minutes later" }) {
                                Text("+5m")
                            }
                        }
                    }

                    HorizontalDivider()

                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { project?.let { session.open(it) } }
                            .semantics { contentDescription = "View project details" }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppIcon(Icons.Outlined.Folder, 20.dp, Palette.navy)
                        Spacer(Modifier.width(12.dp))
                        Text("View Project", color = Palette.navy, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        AppIcon(Icons.AutoMirrored.Filled.KeyboardArrowRight, 20.dp, MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            if (project != null) {
                JobPhotosPanel(project, showCamera = true, onOpenAll = { session.open(project, ProjectRoute.Action.Photos) })
                LabourTasksPanel(project, showHoursMeter = true, enabled = enabled)
            }
        }
    }

    if (showSwitcher) {
        ProjectSwitcherSheet(
            currentProject = project, switching = switching, error = actionError,
            onDismiss = { showSwitcher = false }, onPick = ::switchTo,
        )
    }
}

/** `02:07` with `:45` seconds, ticking every second. */
@Composable
private fun ShiftTimer(startedAt: Instant?) {
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(1000 - (System.currentTimeMillis() % 1000))
        }
    }
    val parts = DurationFormat.shiftTimer(startedAt?.let { now.timeIntervalSince(it) } ?: 0.0)
    Row(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) { contentDescription = "Shift time ${parts.main} and ${parts.seconds} seconds" },
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(parts.main, fontSize = 48.sp, fontWeight = FontWeight.Bold,
             style = MaterialTheme.typography.displayMedium.copy(fontFeatureSettings = "tnum"),
             modifier = Modifier.alignByBaseline())
        Text(":${parts.seconds}", fontSize = 24.sp, fontWeight = FontWeight.SemiBold,
             color = MaterialTheme.colorScheme.onSurfaceVariant,
             style = MaterialTheme.typography.headlineSmall.copy(fontFeatureSettings = "tnum"),
             modifier = Modifier.alignByBaseline())
    }
}
