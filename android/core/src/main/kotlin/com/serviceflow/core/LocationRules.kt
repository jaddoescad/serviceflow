package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object TrackingConstants {
    /** Clocked-out screen auto-targets the nearest job within this distance. */
    const val nearestProjectRadius: Double = 2000.0
    /** A fix this close to the job counts as on site. */
    const val siteRadius: Double = 150.0
    /** "Switch to …" is suggested for another job this close. */
    const val jobSuggestionRadius: Double = 175.0
    /** Fixes less accurate than this are not trusted. */
    const val maximumAcceptedAccuracy: Double = 250.0
    /** Seconds between recorded samples beyond which the gap is "not recorded". */
    const val recordingGap: Double = 15.0 * 60
    const val foregroundHeartbeat: Double = 4.0 * 60
    const val foregroundDistanceFilter: Double = 25.0
    const val clockInLocationTimeout: Double = 12.0
    const val clockOutLocationTimeout: Double = 8.0
}

/** The closest job and its distance in metres. */
data class NearestProject(val project: Project, val distance: Double)

object Geo {
    /** Haversine distance in metres, rounded to a whole metre. */
    fun distance(a: Coordinate, b: Coordinate): Double {
        val radius = 6_371_000.0
        val dLat = (b.latitude - a.latitude) * Math.PI / 180
        val dLng = (b.longitude - a.longitude) * Math.PI / 180
        val lat1 = a.latitude * Math.PI / 180
        val lat2 = b.latitude * Math.PI / 180
        val h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
        return (radius * 2 * atan2(sqrt(h), sqrt(1 - h))).roundedSwift()
    }

    /** The closest non-archived job with coordinates. */
    fun nearest(projects: List<Project>, to: Coordinate): NearestProject? =
        projects
            .filter { !it.isArchived }
            .mapNotNull { project -> project.coordinate?.let { NearestProject(project, distance(to, it)) } }
            .minByOrNull { it.distance }
}

@Serializable
enum class TrackingMode(val rawValue: String) {
    @SerialName("painting") Painting("painting"),
    @SerialName("stationary") Stationary("stationary"),
    @SerialName("travel") Travel("travel"),
    @SerialName("unknown") Unknown("unknown"),
    @SerialName("unavailable") Unavailable("unavailable"),
    @SerialName("clocked_out") ClockedOut("clocked_out");

    companion object {
        fun fromRaw(value: String?): TrackingMode? = entries.firstOrNull { it.rawValue == value }
    }
}

/**
 * Where a fix puts the painter relative to their job.
 * Built with `LocationStatus(point = …, project = …, projects = …)`.
 */
data class LocationStatus(
    val point: LocationPoint,
    val activeDistance: Double?,
    val onSite: Boolean?,
    val suggestedProject: Project?,
    val reliable: Boolean,
) {
    val mode: TrackingMode
        get() {
            if (!reliable) return TrackingMode.Travel
            return when (onSite) {
                true -> TrackingMode.Painting
                false -> TrackingMode.Travel
                null -> TrackingMode.Unknown
            }
        }

    /** The status line on the active clock-in card. */
    val label: String
        get() {
            if (!reliable) return "Location accuracy is still improving."
            val activeDistance = activeDistance ?: return "Location captured. Job-site distance unavailable."
            val distance = DistanceFormat.meters(activeDistance)
            return if (onSite == true) "On site, $distance from job." else "Off site, $distance from job."
        }

    companion object {
        operator fun invoke(point: LocationPoint, project: Project, projects: List<Project>): LocationStatus {
            val reliable = (point.accuracy ?: 0.0) <= TrackingConstants.maximumAcceptedAccuracy
            val distance = project.coordinate?.let { Geo.distance(point.coordinate, it) }
            if (!reliable) return LocationStatus(point, distance, null, null, false)
            val onSite = distance?.let { it <= TrackingConstants.siteRadius }
            val nearest = Geo.nearest(projects, to = point.coordinate)
            val suggested = if (nearest != null && nearest.project.id != project.id &&
                nearest.distance <= TrackingConstants.jobSuggestionRadius
            ) nearest.project else null
            return LocationStatus(point, distance, onSite, suggested, true)
        }
    }
}

@Serializable
enum class LocationEventType(val rawValue: String) {
    @SerialName("location") Location("location"),
    @SerialName("clock_in") ClockIn("clock_in"),
    @SerialName("clock_out") ClockOut("clock_out"),
    @SerialName("project_switch") ProjectSwitch("project_switch"),
    @SerialName("tracking_status") TrackingStatus("tracking_status");

    companion object {
        fun fromRaw(value: String?): LocationEventType? = entries.firstOrNull { it.rawValue == value }
    }
}

object LocationSampling {
    /**
     * Whether a fix is worth uploading as a location point. Lifecycle events
     * are always kept; routine fixes are thinned by distance and time.
     */
    fun shouldRecord(previous: LocationPoint?, point: LocationPoint, mode: TrackingMode, event: LocationEventType): Boolean {
        if (event != LocationEventType.Location) return true
        if ((point.accuracy ?: 0.0) > TrackingConstants.maximumAcceptedAccuracy) return false
        previous ?: return true
        val steady = mode == TrackingMode.Painting || mode == TrackingMode.Stationary
        val distance = Geo.distance(previous.coordinate, point.coordinate)
        val elapsed = point.capturedAt.timeIntervalSince(previous.capturedAt)
        return distance >= (if (steady) 60 else 100) || elapsed >= (if (steady) 15.0 * 60 else 3.0 * 60)
    }
}

object SegmentBuilder {
    /**
     * Adds a sample to the shift's segments. Without background location the
     * app sees nothing while it is closed, so a gap longer than
     * `recordingGap` since the last sample becomes an `unknown` segment
     * instead of silently stretching the previous mode across it.
     */
    fun append(
        segments: List<ShiftSegment>, mode: SiteMode, at: Instant, distance: Double?,
        location: LocationPoint?, shiftStart: Instant,
    ): List<ShiftSegment> {
        val now = at
        val result = segments.toMutableList()
        val lastEnd = result.lastOrNull()?.let { it.endedAt ?: it.startedAt } ?: shiftStart
        if (now.timeIntervalSince(lastEnd) > TrackingConstants.recordingGap) {
            if (result.lastOrNull()?.mode == SiteMode.Unknown) {
                result[result.size - 1] = result.last().copy(endedAt = now)
            } else {
                result.add(ShiftSegment(mode = SiteMode.Unknown, startedAt = lastEnd, endedAt = now))
            }
        }
        val last = result.lastOrNull()
        if (last != null && last.mode == mode) {
            result[result.size - 1] = last.copy(endedAt = now, distanceMeters = distance, location = location)
        } else {
            result.add(ShiftSegment(mode = mode, startedAt = now, endedAt = now, distanceMeters = distance, location = location))
        }
        return result
    }

    /** Closes the segments at clock-out, marking an unobserved tail as `unknown`. */
    fun close(segments: List<ShiftSegment>, at: Instant): List<ShiftSegment> {
        val end = at
        val last = segments.lastOrNull() ?: return segments
        val result = segments.toMutableList()
        val lastEnd = last.endedAt ?: last.startedAt
        if (end.timeIntervalSince(lastEnd) > TrackingConstants.recordingGap) {
            if (last.mode == SiteMode.Unknown) {
                result[result.size - 1] = last.copy(endedAt = end)
            } else {
                result.add(ShiftSegment(mode = SiteMode.Unknown, startedAt = lastEnd, endedAt = end))
            }
        } else {
            result[result.size - 1] = last.copy(endedAt = end)
        }
        return result
    }
}
