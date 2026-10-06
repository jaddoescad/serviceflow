package com.serviceflow.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant
import kotlin.math.max

/**
 * A GPS fix as stored on entries and segments.
 *
 * `LocationPoint(latitude = …, …)` goes through the companion `invoke`, which
 * (like the Swift initializer) drops non-positive accuracy and negative
 * speed/heading.
 */
@ConsistentCopyVisibility
@Serializable
data class LocationPoint private constructor(
    val latitude: Double,
    val longitude: Double,
    /** Horizontal accuracy in metres; null when unknown. */
    val accuracy: Double? = null,
    val speed: Double? = null,
    val heading: Double? = null,
    val mocked: Boolean? = null,
    @Serializable(with = InstantSerializer::class) val capturedAt: Instant,
) {
    val coordinate: Coordinate get() = Coordinate(latitude, longitude)

    companion object {
        operator fun invoke(
            latitude: Double, longitude: Double, accuracy: Double? = null, speed: Double? = null,
            heading: Double? = null, mocked: Boolean? = null, capturedAt: Instant,
        ): LocationPoint = LocationPoint(
            latitude, longitude,
            accuracy?.takeIf { it > 0 },
            speed?.takeIf { it >= 0 },
            heading?.takeIf { it >= 0 },
            mocked, capturedAt,
        )
    }
}

/** Unknown raw values decode as [SiteMode.Unknown]. */
@Serializable(with = SiteModeSerializer::class)
enum class SiteMode(val rawValue: String) {
    OnSite("on_site"),
    OffSite("off_site"),
    Unknown("unknown");

    companion object {
        fun fromRaw(value: String?): SiteMode? = entries.firstOrNull { it.rawValue == value }

        /** `SiteMode(onSite = true)`. */
        operator fun invoke(onSite: Boolean?): SiteMode = when (onSite) {
            true -> OnSite
            false -> OffSite
            null -> Unknown
        }
    }
}

object SiteModeSerializer : KSerializer<SiteMode> {
    override val descriptor = PrimitiveSerialDescriptor("SiteMode", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: SiteMode) = encoder.encodeString(value.rawValue)
    override fun deserialize(decoder: Decoder): SiteMode = SiteMode.fromRaw(decoder.decodeString()) ?: SiteMode.Unknown
}

/** A stretch of a shift spent in one location mode. */
@Serializable
data class ShiftSegment(
    val mode: SiteMode,
    @Serializable(with = InstantSerializer::class) val startedAt: Instant,
    @Serializable(with = InstantSerializer::class) val endedAt: Instant?,
    val distanceMeters: Double? = null,
    val location: LocationPoint? = null,
)

/**
 * One edit in `adjustment_history`. The server writes snake_case items
 * (`adjusted_at`, `previous_started_at`); older app builds wrote camelCase.
 * Both are read, and the app never writes history itself.
 */
@Serializable
data class AdjustmentRecord(
    @Serializable(with = InstantSerializer::class) val adjustedAt: Instant? = null,
    val adjustedBy: String? = null,
    val adjustedByName: String? = null,
    val source: String? = null,
    @Serializable(with = InstantSerializer::class) val previousStartedAt: Instant? = null,
    @Serializable(with = InstantSerializer::class) val previousEndedAt: Instant? = null,
) {
    companion object {
        /** `AdjustmentRecord(json = item)`. */
        operator fun invoke(json: JSONValue): AdjustmentRecord {
            fun pick(vararg keys: String): JSONValue? = keys.asSequence().mapNotNull { json[it] }.firstOrNull { !it.isNull }
            return AdjustmentRecord(
                adjustedAt = pick("adjusted_at", "adjustedAt").dateValue,
                adjustedBy = pick("adjusted_by", "adjustedByUserId").nonEmptyString,
                adjustedByName = pick("adjusted_by_name", "adjustedByName", "adjustedByEmail").nonEmptyString,
                source = pick("source").nonEmptyString,
                previousStartedAt = pick("previous_started_at", "previousStartedAt").dateValue,
                previousEndedAt = pick("previous_ended_at", "previousEndedAt").dateValue,
            )
        }
    }
}

@Serializable
enum class ClockOutReason(val rawValue: String) {
    @SerialName("active") Active("active"),
    @SerialName("manual") Manual("manual"),
    @SerialName("project_detail") ProjectDetail("project_detail"),
    @SerialName("notification") Notification("notification"),
    @SerialName("switched_project") SwitchedProject("switched_project"),
    @SerialName("server") Server("server");

    companion object {
        fun fromRaw(value: String?): ClockOutReason? = entries.firstOrNull { it.rawValue == value }
    }
}

/** A time entry. While `endedAt` is null it is the running shift. */
@Serializable
data class TimeEntry(
    /** The `client_entry_id`. Created on the device at clock-in and never changed. */
    val localId: String,
    /** `time_entries.id` once the server has acknowledged the entry. */
    val serverId: String? = null,
    val userId: String,
    val userEmail: String?,
    val userName: String,
    val project: Project,
    @Serializable(with = InstantSerializer::class) val originalStartedAt: Instant,
    @Serializable(with = InstantSerializer::class) val startedAt: Instant,
    @Serializable(with = InstantSerializer::class) val startEditedAt: Instant? = null,
    @Serializable(with = InstantSerializer::class) val endedAt: Instant? = null,
    val clockOutReason: ClockOutReason = ClockOutReason.Active,
    val startedLocation: LocationPoint? = null,
    val lastLocation: LocationPoint? = null,
    val lastDistanceMeters: Double? = null,
    val onSite: Boolean? = null,
    @Serializable(with = InstantSerializer::class) val travelStartedAt: Instant? = null,
    val segments: List<ShiftSegment> = emptyList(),
    val adjustmentHistory: List<AdjustmentRecord> = emptyList(),
) {
    val id: String get() = localId
    val isActive: Boolean get() = endedAt == null

    /** Seconds worked, up to [at] while running. */
    fun duration(at: Instant): Double = max(0.0, (endedAt ?: at).timeIntervalSince(startedAt))

    /** Keys under which the server or the device may know this entry. */
    val identityKeys: Set<String> get() = listOf(serverId, localId).mapNotNull { it.nonBlank }.toSet()

    fun isSameEntry(other: TimeEntry): Boolean = identityKeys.any { it in other.identityKeys }

    /** Net start-time edit in minutes (`Edited -10m`), null when unchanged. */
    val startAdjustmentMinutes: Int?
        get() {
            val minutes = (startedAt.timeIntervalSince(originalStartedAt) / 60).roundedSwift().toInt()
            return if (minutes == 0) null else minutes
        }

    companion object {
        /** Builds an entry from a `time_entries` row. */
        fun fromServerRow(row: JSONValue?, now: Instant = Instant.now()): TimeEntry? {
            val id = row["id"].nonEmptyString ?: return null
            val startedAt = row["started_at"].dateValue ?: return null
            val status = row["status"].stringValue
            val isActive = status == "active" && row["ended_at"].isNull
            val jobId = row["job_id"].nonEmptyString ?: ""
            val address = row["job_address"].nonEmptyString

            fun point(lat: String, lng: String): LocationPoint? {
                val latitude = row[lat].doubleValue ?: return null
                val longitude = row[lng].doubleValue ?: return null
                return LocationPoint(latitude = latitude, longitude = longitude, capturedAt = startedAt)
            }

            val segments = (row["segments"].arrayValue ?: emptyList()).mapNotNull {
                runCatching { JSONCoding.decode(ShiftSegment.serializer(), it) }.getOrNull()
            }
            return TimeEntry(
                localId = row["client_entry_id"].nonEmptyString ?: id,
                serverId = id,
                userId = row["employee_id"].nonEmptyString ?: "",
                userEmail = row["employee_email"].nonEmptyString,
                userName = row["employee_name"].nonEmptyString ?: "Crew member",
                project = Project(id = jobId, name = row["job_name"].nonEmptyString ?: "Job", formattedAddress = address),
                originalStartedAt = row["original_started_at"].dateValue ?: startedAt,
                startedAt = startedAt,
                startEditedAt = row["start_edited_at"].dateValue,
                endedAt = if (isActive) null else (row["ended_at"].dateValue ?: now),
                clockOutReason = if (isActive) ClockOutReason.Active else ClockOutReason.Server,
                startedLocation = point("clock_in_latitude", "clock_in_longitude"),
                lastLocation = point("clock_out_latitude", "clock_out_longitude"),
                lastDistanceMeters = row["last_distance_meters"].doubleValue,
                onSite = row["is_on_site"].boolValue,
                segments = segments,
                adjustmentHistory = (row["adjustment_history"].arrayValue ?: emptyList()).map { AdjustmentRecord(json = it) },
            )
        }
    }
}

/** Server status of a time entry row. */
object TimeEntryRowStatus {
    fun of(row: JSONValue?): String? = row["status"].stringValue

    /** The server writes `completed` (the RN app checked `complete`, so it never reconciled). */
    fun isCompleted(row: JSONValue?): Boolean = of(row) == "completed" && !row["ended_at"].isNull

    fun isActive(row: JSONValue?): Boolean = of(row) == "active" && row["ended_at"].isNull
}
