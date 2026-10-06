package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.TimerOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LeadingIconTab
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.serviceflow.app.CameraRequest
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.ProjectRoute
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.features.jobs.ContentUnavailable
import com.serviceflow.app.features.media.ProjectMediaPanel
import com.serviceflow.core.DateText
import com.serviceflow.core.PainterClockInSummary
import com.serviceflow.core.ProjectClockIns
import com.serviceflow.core.TimeEntry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

/** This job's entries (crew only get their own), grouped by person, as of [now]. */
class JobClockIns(val entries: List<TimeEntry>, val summaries: List<PainterClockInSummary>, val now: Instant)

/** Built once per render and shared by the tab and the pushed screens; running shifts tick every 15 s. */
@Composable
fun rememberJobClockIns(model: ProjectDetailModel): JobClockIns {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val activeShift by tracker.activeShift.collectAsStateWithLifecycle()
    val entries by tracker.entries.collectAsStateWithLifecycle()
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(15_000)
            if (tracker.activeShift.value != null || model.hasRunningEntry) now = Instant.now()
        }
    }
    val all = model.entries(local = listOfNotNull(activeShift) + entries)
    val visible = if (session.isManager) all else all.filter { it.userId == session.user.id }
    val summaries = ProjectClockIns.summaries(entries = visible, activeShift = null, projectId = model.jobId,
                                              userId = session.user.id, now = now)
    return JobClockIns(visible, summaries, now)
}

private enum class DetailTab { Clock, Media }

/** A job or lead: its clock-ins, hours, tasks, photos and videos. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailScreen(route: ProjectRoute, onBack: () -> Unit) {
    val session = LocalSession.current
    val project = route.project
    val jobId = project.id
    val model = viewModel { ProjectDetailModel(project, session) }
    val store = model.mediaStore
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf(if (project.isLead || route.action != null) DetailTab.Media else DetailTab.Clock) }
    var handledAction by rememberSaveable { mutableStateOf(false) }
    var mediaRefreshing by remember { mutableStateOf(false) }
    val clockIns = rememberJobClockIns(model)

    val title = project.name.trim().ifEmpty { project.contactName?.trim().orEmpty().ifEmpty { "Project" } }
    val addedLabel = project.createdAt?.let { "Added ${DateText.canadianShortDate(it)}" } ?: "Added recently"
    val deleting = store.deletingId != null

    fun openCamera() {
        if (jobId.isEmpty() || store.deletingId != null) return
        tab = DetailTab.Media
        session.uploads?.clearCompleted()
        session.navigator.openCamera(CameraRequest(projectName = title, projectId = jobId, projectKind = project.kind,
                                                   onClose = { tab = DetailTab.Media }))
    }

    fun openEdit(entryId: String) {
        session.navigator.push { onBackFromEdit ->
            val found = rememberJobClockIns(model).entries.firstOrNull { it.localId == entryId }
            // Keep the entry being edited on screen even once it's deleted.
            val entry = remember { found }
            if (entry == null) {
                MissingScreen("Clock-in not found", Icons.Outlined.TimerOff, onBackFromEdit)
            } else {
                ProjectDetailEditTime(entry = entry, painterName = session.displayName, onBack = onBackFromEdit, onChanged = { deleted ->
                    if (deleted) model.removeLocally(entry)
                    model.viewModelScope.launch { model.refresh(session.api) }
                })
            }
        }
    }

    fun openPainter(userId: String) {
        session.navigator.push { onBackFromPainter ->
            val painterClockIns = rememberJobClockIns(model)
            ProjectDetailPainterDetail(
                summary = painterClockIns.summaries.firstOrNull { it.userId == userId },
                now = painterClockIns.now,
                onBack = onBackFromPainter,
                onEdit = { openEdit(it.localId) },
            )
        }
    }

    LaunchedEffect(Unit) {
        // Showing Media (including opening straight onto it) always reloads it.
        snapshotFlow { tab }.collect { if (it == DetailTab.Media) store.load() }
    }
    LaunchedEffect(Unit) {
        if (route.action == ProjectRoute.Action.Camera && !handledAction) openCamera()
        handledAction = true
    }
    LaunchedEffect(jobId) {
        // Team time and budget, every 45 s while the screen is open.
        if (project.isLead) return@LaunchedEffect
        while (true) {
            model.refresh(session.api)
            delay(45_000)
        }
    }
    OnAppForeground { scope.launch { model.refreshBudget(session.api) } }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Column {
                            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(addedLabel, style = MaterialTheme.typography.bodySmall,
                                 color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                    },
                )
                if (!project.isLead) {
                    PrimaryTabRow(selectedTabIndex = tab.ordinal) {
                        LeadingIconTab(
                            selected = tab == DetailTab.Clock,
                            onClick = { tab = DetailTab.Clock },
                            text = { Text("Clock Ins") },
                            icon = { Icon(Icons.Outlined.Schedule, contentDescription = null) },
                        )
                        LeadingIconTab(
                            selected = tab == DetailTab.Media,
                            onClick = { tab = DetailTab.Media },
                            text = { Text("Media") },
                            icon = { Icon(Icons.Outlined.PhotoLibrary, contentDescription = null) },
                        )
                    }
                }
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = ::openCamera,
                containerColor = DetailPalette.brand,
                contentColor = Color.White,
                shape = CircleShape,
                modifier = Modifier.semantics { contentDescription = "Take project photo" },
            ) {
                if (deleting) {
                    CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Filled.PhotoCamera, contentDescription = null)
                }
            }
        },
        containerColor = if (tab == DetailTab.Clock) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                DetailTab.Clock -> ProjectDetailClockInsTab(
                    project = project, title = title, model = model, clockIns = clockIns,
                    onOpenMedia = { tab = DetailTab.Media },
                    onOverBudget = { session.navigator.overBudget = it },
                    onOpenPainter = ::openPainter,
                )
                DetailTab.Media -> PullToRefreshBox(
                    isRefreshing = mediaRefreshing,
                    onRefresh = {
                        scope.launch {
                            mediaRefreshing = true
                            store.load()
                            mediaRefreshing = false
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 96.dp)) {
                        ProjectMediaPanel(store = store, project = project)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MissingScreen(title: String, icon: ImageVector, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxWidth().padding(padding)) { ContentUnavailable(icon, title) }
    }
}
