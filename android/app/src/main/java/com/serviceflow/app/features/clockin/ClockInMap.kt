package com.serviceflow.app.features.clockin

import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdate
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.JointType
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.MapStyleOptions
import com.google.android.gms.maps.model.RoundCap
import com.google.maps.android.compose.Circle
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.Palette
import com.serviceflow.core.Coordinate
import com.serviceflow.core.LocationPoint
import com.serviceflow.core.Project
import com.serviceflow.core.TrackingConstants
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max

/**
 * Google Maps with the company's jobs as markers. The selected job gets a
 * 150 m circle and a line from the person's location.
 */
@Composable
fun ClockInMap(
    projects: List<Project>,
    selected: Project?,
    userPoint: LocationPoint?,
    onUserPoint: (LocationPoint) -> Unit,
    onSelect: (Project) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val session = LocalSession.current
    val context = LocalContext.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val authorized = session.locationAuthorization.isAuthorized
    val camera = rememberCameraPositionState()
    var mapLoaded by remember { mutableStateOf(false) }
    var didInitialFit by rememberSaveable { mutableStateOf(false) }
    var centredId by rememberSaveable { mutableStateOf<String?>(null) }
    // Read from effects, which outlive the composition that started them.
    val currentSelected by rememberUpdatedState(selected)
    val currentUser by rememberUpdatedState(userPoint)
    val currentProjects by rememberUpdatedState(projects)

    // Active jobs with coordinates, plus the selected one if it isn't among them.
    val seen = mutableSetOf<String>()
    val markers = (projects + listOfNotNull(selected))
        .filter { (it.id == selected?.id || !it.isArchived) && seen.add(it.id) }
        .mapNotNull { project -> project.coordinate?.let { project to it.latLng } }

    fun move(update: CameraUpdate) {
        scope.launch { runCatching { camera.animate(update) } }
    }

    fun fitInitially(user: Coordinate? = currentUser?.coordinate) {
        if (didInitialFit || !mapLoaded) return
        val selected = currentSelected
        val job = selected?.coordinate
        if (job == null && user == null && currentProjects.isEmpty()) return
        didInitialFit = true
        move(region(job, user, currentProjects))
        centredId = selected?.id
    }

    fun centreOnSelection() {
        val selected = currentSelected ?: return
        val coordinate = selected.coordinate ?: return
        if (selected.id == centredId || !mapLoaded) return
        centredId = selected.id
        didInitialFit = true
        move(CameraUpdateFactory.newLatLngBounds(bounds(coordinate.latLng, 0.012, 0.012), 0))
    }

    LaunchedEffect(mapLoaded, projects.size) { fitInitially() }
    LaunchedEffect(selected?.id) { centreOnSelection() }
    // A one-shot fix, only when location is already allowed. Never prompts.
    LaunchedEffect(authorized) {
        if (!authorized) return@LaunchedEffect
        val point = session.location.currentPoint(TrackingConstants.clockInLocationTimeout) ?: return@LaunchedEffect
        onUserPoint(point)
        if (currentSelected == null) {
            didInitialFit = false
            fitInitially(point.coordinate)
        }
    }

    // Without a Maps key (dev builds) the map stays blank.
    val hasKey = remember { mapsKeyConfigured(context) }
    if (!hasKey) {
        Box(modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant))
        return
    }

    GoogleMap(
        modifier = modifier.fillMaxSize(),
        cameraPositionState = camera,
        contentPadding = contentPadding,
        properties = MapProperties(isMyLocationEnabled = authorized, mapStyleOptions = noPointsOfInterest),
        uiSettings = MapUiSettings(
            myLocationButtonEnabled = authorized, compassEnabled = true,
            mapToolbarEnabled = false, zoomControlsEnabled = false,
        ),
        onMapLoaded = { mapLoaded = true },
    ) {
        val site = selected?.coordinate?.latLng
        if (site != null) {
            Circle(
                center = site, radius = TrackingConstants.siteRadius,
                fillColor = Palette.teal.copy(alpha = 0.18f), strokeColor = Palette.teal.copy(alpha = 0.55f),
                strokeWidth = with(density) { 2.dp.toPx() },
            )
            val user = userPoint?.coordinate?.latLng
            if (authorized && user != null) {
                Polyline(
                    points = listOf(user, site), color = Palette.teal, width = with(density) { 4.dp.toPx() },
                    startCap = RoundCap(), endCap = RoundCap(), jointType = JointType.ROUND,
                )
            }
        }
        markers.forEach { (project, position) ->
            key(project.id) {
                val isSelected = project.id == selected?.id
                val state = remember { MarkerState(position) }
                state.position = position
                MarkerComposable(
                    project.id, isSelected, project.isLead,
                    state = state,
                    title = project.name,
                    zIndex = if (isSelected) 1f else 0f,
                    onClick = {
                        onSelect(project)
                        it.showInfoWindow()
                        true
                    },
                ) {
                    MarkerPin(if (project.isLead) Icons.Filled.Person else Icons.Filled.Work,
                              if (isSelected) Palette.teal else Palette.navy)
                }
            }
        }
    }
}

@Composable
private fun MarkerPin(icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    Box(
        Modifier.size(32.dp).background(color, CircleShape).border(2.dp, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        AppIcon(icon, 16.dp, Color.White)
    }
}

private val Coordinate.latLng: LatLng get() = LatLng(latitude, longitude)

private val noPointsOfInterest = MapStyleOptions("""[{"featureType":"poi","stylers":[{"visibility":"off"}]}]""")

private fun bounds(center: LatLng, latitudeDelta: Double, longitudeDelta: Double): LatLngBounds = LatLngBounds(
    LatLng(center.latitude - latitudeDelta / 2, center.longitude - longitudeDelta / 2),
    LatLng(center.latitude + latitudeDelta / 2, center.longitude + longitudeDelta / 2),
)

/** Both points: their midpoint with some padding. One: that point close up. */
private fun region(job: Coordinate?, user: Coordinate?, fallback: List<Project>): CameraUpdate {
    val box = when {
        job != null && user != null -> bounds(
            LatLng((job.latitude + user.latitude) / 2, (job.longitude + user.longitude) / 2),
            max(abs(job.latitude - user.latitude) * 1.35, 0.035),
            max(abs(job.longitude - user.longitude) * 1.35, 0.035),
        )
        job != null || user != null -> bounds((job ?: user)!!.latLng, 0.012, 0.012)
        else -> fallback.firstNotNullOfOrNull { it.coordinate }?.let { bounds(it.latLng, 0.2, 0.2) }
            ?: bounds(LatLng(45.0, -95.0), 40.0, 60.0)
    }
    return CameraUpdateFactory.newLatLngBounds(box, 0)
}

private fun mapsKeyConfigured(context: Context): Boolean = runCatching {
    @Suppress("DEPRECATION")
    val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    !info.metaData?.getString("com.google.android.geo.API_KEY").isNullOrBlank()
}.getOrDefault(false)
