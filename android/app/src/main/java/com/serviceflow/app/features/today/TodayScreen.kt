package com.serviceflow.app.features.today

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.MarkerState
import com.serviceflow.app.LocalSession
import com.serviceflow.app.backend.todayJobs
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.clockin.latLng
import com.serviceflow.app.features.clockin.mapsKeyConfigured
import com.serviceflow.app.features.clockin.noPointsOfInterest
import com.serviceflow.core.BudgetPresentation
import com.serviceflow.core.DateText
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.TodayBoard
import com.serviceflow.core.TodayJob
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max

/**
 * Owners' and managers' Today tab, as on the website: the jobs someone
 * clocked in to today, on a map and as cards with the crew and the budget.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(enabled: Boolean) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var jobs by remember { mutableStateOf<List<TodayJob>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var startOfDay by remember { mutableStateOf(startOfToday()) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        val day = startOfToday()
        try {
            jobs = session.api.todayJobs(startOfDay = day)
            startOfDay = day
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            // Keep what is already on screen.
            error = e.message ?: e.toString()
        }
    }

    LaunchedEffect(enabled) {
        // Showing the tab refreshes, then every minute while it's visible.
        if (!enabled) return@LaunchedEffect
        while (true) {
            load()
            delay(60_000)
        }
    }

    Scaffold(topBar = { TopAppBar(title = { Text("Today") }) }) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                error?.let { message ->
                    item(key = "error") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Warning, contentDescription = null, tint = hex(0xb42318), modifier = Modifier.size(18.dp))
                            Text(message, style = appText(13, FontWeight.SemiBold, hex(0xb42318)))
                        }
                    }
                }
                val list = jobs
                if (list == null) {
                    if (error == null) {
                        item(key = "loading") {
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 24.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                Text("Loading today…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                } else {
                    item(key = "header") {
                        val date = DateText.format(Instant.now(), "EEEEMMMMd", locale = DateText.canada)
                        Text(
                            if (list.isEmpty()) date else "$date · ${TodayBoard.summary(list)}",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (list.isEmpty()) {
                        item(key = "empty") {
                            Text(
                                "No one has clocked in yet today",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                            )
                        }
                    } else {
                        item(key = "map") {
                            TodayMap(
                                list, onSelect = { session.open(it.project) },
                                modifier = Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(16.dp)),
                            )
                        }
                        items(list, key = { it.id }) { job ->
                            TodayJobCard(job, startOfDay, onClick = { session.open(job.project) })
                        }
                    }
                }
            }
        }
    }
}

private fun startOfToday(): Instant {
    val zone = ZoneId.systemDefault()
    return LocalDate.now(zone).atStartOfDay(zone).toInstant()
}

/** Today's jobs as pins labelled with the crew count and the job name. */
@Composable
private fun TodayMap(jobs: List<TodayJob>, onSelect: (TodayJob) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    // Without a Maps key (dev builds) the map stays blank.
    val hasKey = remember { mapsKeyConfigured(context) }
    if (!hasKey) {
        Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant))
        return
    }
    val pinned = jobs.mapNotNull { job -> job.coordinate?.let { job to it.latLng } }
    val camera = rememberCameraPositionState()
    var mapLoaded by remember { mutableStateOf(false) }
    LaunchedEffect(mapLoaded) {
        if (mapLoaded) region(pinned.map { it.second })?.let { camera.move(CameraUpdateFactory.newLatLngBounds(it, 0)) }
    }
    GoogleMap(
        modifier = modifier,
        cameraPositionState = camera,
        properties = MapProperties(mapStyleOptions = noPointsOfInterest),
        uiSettings = MapUiSettings(mapToolbarEnabled = false, zoomControlsEnabled = false),
        onMapLoaded = { mapLoaded = true },
    ) {
        pinned.forEach { (job, position) ->
            key(job.id) {
                val clockedIn = job.painters.count { it.inTodayAt != null }
                MarkerComposable(
                    job.id, clockedIn,
                    state = remember { MarkerState(position) }.also { it.position = position },
                    title = job.project.name,
                    onClick = {
                        onSelect(job)
                        true
                    },
                ) {
                    Row(
                        Modifier.padding(4.dp).shadow(3.dp, CircleShape).background(Color.White, CircleShape)
                            .padding(start = 3.dp, end = 9.dp, top = 3.dp, bottom = 3.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(20.dp).background(Palette.teal, CircleShape), contentAlignment = Alignment.Center) {
                            Text("$clockedIn", style = appText(11, FontWeight.Bold, Color.White))
                        }
                        Text(job.project.name, style = appText(12, FontWeight.SemiBold, Palette.ink), maxLines = 1)
                    }
                }
            }
        }
    }
}

/** Every pin with room around it for its label. */
private fun region(points: List<LatLng>): LatLngBounds? {
    if (points.isEmpty()) return null
    val minLat = points.minOf { it.latitude }
    val maxLat = points.maxOf { it.latitude }
    val minLng = points.minOf { it.longitude }
    val maxLng = points.maxOf { it.longitude }
    val latHalf = max(0.02, (maxLat - minLat) * 1.8) / 2
    val lngHalf = max(0.04, (maxLng - minLng) * 2.6) / 2
    val lat = (minLat + maxLat) / 2
    val lng = (minLng + maxLng) / 2
    return LatLngBounds(LatLng(lat - latHalf, lng - lngHalf), LatLng(lat + latHalf, lng + lngHalf))
}

/** One job: name, address, labour budget, and its crew with today's clock-ins. */
@Composable
private fun TodayJobCard(job: TodayJob, startOfDay: Instant, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, Palette.border),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(job.project.name, style = appText(16, FontWeight.SemiBold, Palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                job.project.cardAddress?.let {
                    Text(it, style = appText(13, color = Palette.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Budget(job)
            HorizontalDivider(color = Palette.border)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                job.painters.forEach { painter ->
                    val inAt = painter.inTodayAt
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).background(if (inAt != null) Palette.teal else hex(0xc9cfcd), CircleShape))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            painter.name,
                            style = appText(14, if (inAt != null) FontWeight.SemiBold else FontWeight.Normal,
                                            if (inAt != null) Palette.ink else Palette.muted),
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        if (inAt != null) {
                            Spacer(Modifier.width(8.dp))
                            Text(TodayBoard.inLabel(inAt, startOfDay), style = appText(12, color = Palette.muted), maxLines = 1)
                        }
                        Spacer(Modifier.weight(1f))
                        Text(
                            DurationFormat.hoursMinutes(minutes = painter.totalMinutes),
                            style = appText(13, color = Palette.muted), modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Budget(job: TodayJob) {
    val line = TodayBoard.budgetLine(job.project.budget)
    if (line == null) {
        Text("No labour budget", style = appText(12, color = hex(0xaeb7b3)))
        return
    }
    val (label, percent) = line
    val color = hex(BudgetPresentation(job.project.budget).colorHex)
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row {
            Text(label, style = appText(12, color = Palette.muted), maxLines = 1, modifier = Modifier.weight(1f))
            Text(
                "$percent%",
                style = appText(12, if (percent > 100) FontWeight.Bold else FontWeight.Normal, if (percent > 100) color else Palette.ink),
            )
        }
        Box(Modifier.fillMaxWidth().height(4.dp).background(hex(0xe5e9e8), CircleShape)) {
            Box(Modifier.fillMaxWidth((percent / 100f).coerceIn(0f, 1f)).height(4.dp).background(color, CircleShape))
        }
    }
}
