package com.serviceflow.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.time.Instant

/** A row for `employee_location_points`, sent through `record_location_update`. */
@Serializable
data class LocationRow(
    val clientEventId: String,
    val clientEntryId: String,
    val jobId: String?,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double?,
    val speedMps: Double?,
    val headingDegrees: Double?,
    val isMocked: Boolean?,
    val trackingMode: TrackingMode,
    val eventType: LocationEventType,
    val distanceFromJobMeters: Int?,
    val isOnSite: Boolean?,
    @Serializable(with = InstantSerializer::class) val capturedAt: Instant,
) {
    constructor(entry: TimeEntry, point: LocationPoint, mode: TrackingMode, event: LocationEventType, status: LocationStatus?) : this(
        clientEventId = listOf(
            entry.localId, ISODate.string(point.capturedAt),
            formatFixed(point.latitude, 5), formatFixed(point.longitude, 5), event.rawValue,
        ).joinToString(":"),
        clientEntryId = entry.localId,
        jobId = if (TimeEntryCommand.isUUID(entry.project.id)) entry.project.id else null,
        latitude = point.latitude,
        longitude = point.longitude,
        accuracyMeters = point.accuracy,
        speedMps = point.speed,
        headingDegrees = point.heading,
        isMocked = point.mocked,
        trackingMode = mode,
        eventType = event,
        distanceFromJobMeters = status?.activeDistance?.let { it.roundedSwift().toInt() },
        isOnSite = status?.onSite,
        capturedAt = point.capturedAt,
    )

    /**
     * The RPC `point` argument. `time_entry_id` is only sent once the entry
     * exists on the server (entry row ids equal their client ids).
     */
    fun payload(timeEntryId: String?): JSONValue = jsonObject(
        "client_event_id" to clientEventId,
        "time_entry_id" to timeEntryId,
        "client_entry_id" to clientEntryId,
        "job_id" to jobId,
        "latitude" to latitude,
        "longitude" to longitude,
        "accuracy_meters" to accuracyMeters,
        "speed_mps" to speedMps,
        "heading_degrees" to headingDegrees,
        "is_mocked" to isMocked,
        "tracking_mode" to trackingMode.rawValue,
        "event_type" to eventType.rawValue,
        "distance_from_job_meters" to distanceFromJobMeters,
        "is_on_site" to isOnSite,
        "captured_at" to capturedAt,
    )
}

/** The latest tracking state shown to managers (`employee_tracking_status`). */
@Serializable
data class TrackingStatusUpdate(
    val clientEntryId: String?,
    val jobId: String?,
    val point: LocationPoint?,
    val mode: TrackingMode,
    val taskStatus: TaskStatus,
    val permissionForeground: Boolean?,
    val appVersion: String,
    val lastErrorCode: String? = null,
    val onSite: Boolean? = null,
    val distanceMeters: Int? = null,
    val reason: String? = null,
    @Serializable(with = InstantSerializer::class) val updatedAt: Instant,
) {
    @Serializable
    enum class TaskStatus(val rawValue: String) {
        @SerialName("running") Running("running"),
        @SerialName("paused") Paused("paused"),
        @SerialName("stopped") Stopped("stopped"),
        @SerialName("error") Error("error");

        companion object {
            fun fromRaw(value: String?): TaskStatus? = entries.firstOrNull { it.rawValue == value }
        }
    }

    /**
     * The RPC `tracking` argument. `background_tracking: false` in the
     * metadata tells the stale-location alert that this device only records
     * location while the app is open.
     */
    fun payload(timeEntryId: String?, now: Instant): JSONValue = jsonObject(
        "time_entry_id" to timeEntryId,
        "client_entry_id" to clientEntryId,
        "job_id" to jobId,
        "latitude" to point?.latitude,
        "longitude" to point?.longitude,
        "accuracy_meters" to point?.accuracy,
        "last_location_at" to point?.capturedAt,
        "last_sync_at" to now,
        "tracking_mode" to mode.rawValue,
        "task_status" to taskStatus.rawValue,
        "permission_foreground" to permissionForeground,
        "permission_background" to false,
        "platform" to PLATFORM,
        "app_version" to appVersion,
        "last_error_code" to lastErrorCode,
        "metadata" to jsonObject(
            "on_site" to onSite,
            "distance_from_project_meters" to distanceMeters,
            "reason" to reason,
            "background_tracking" to false,
            "client" to CLIENT,
        ),
    )

    /** A point to carry the status when no fix is queued with it. */
    internal fun carrierPoint(): JSONValue? {
        val point = point ?: return null
        val stamp = ISODate.string(point.capturedAt)
        return jsonObject(
            "client_event_id" to "tracking-status-${clientEntryId ?: "none"}-$stamp",
            "time_entry_id" to null,
            "client_entry_id" to (clientEntryId ?: "tracking-status"),
            "job_id" to jobId,
            "latitude" to point.latitude,
            "longitude" to point.longitude,
            "accuracy_meters" to point.accuracy,
            "tracking_mode" to mode.rawValue,
            "event_type" to LocationEventType.TrackingStatus.rawValue,
            "captured_at" to stamp,
        )
    }

    companion object {
        /** `employee_tracking_status.platform` (the iOS app sends `ios`). */
        const val PLATFORM = "android"

        /** `metadata.client` (the iOS app sends `ios-native`). */
        const val CLIENT = "android-native"
    }
}

@Serializable
internal data class LocationQueueState(
    val rows: List<LocationRow> = emptyList(),
    val status: TrackingStatusUpdate? = null,
)

/**
 * Location points and the latest tracking status waiting to upload.
 * A Swift actor there; here a mutex guards each change, and (like the actor)
 * it is not held while a point is on the network.
 */
class LocationQueue(storeURL: File) {
    private val store = JSONFileStore(storeURL, LocationQueueState.serializer())
    private val mutex = Mutex()

    @Volatile
    private var state: LocationQueueState = store.load() ?: LocationQueueState()

    @Volatile
    private var syncing = false

    val pendingRows: List<LocationRow> get() = state.rows
    val pendingStatus: TrackingStatusUpdate? get() = state.status

    suspend fun enqueue(row: LocationRow) = mutex.withLock {
        var rows = state.rows.filter { it.clientEventId != row.clientEventId } + row
        if (rows.size > capacity) rows = rows.drop(rows.size - capacity)
        state = state.copy(rows = rows)
        store.save(state)
    }

    suspend fun setStatus(status: TrackingStatusUpdate) = mutex.withLock {
        state = state.copy(status = status)
        store.save(state)
    }

    /**
     * Uploads queued points in order, the status riding on the last one sent.
     * Points of entries the server doesn't have yet wait for the next sync.
     */
    suspend fun sync(heldBack: Set<String>, now: Instant, send: suspend (point: JSONValue, tracking: JSONValue?) -> Unit) {
        val start = mutex.withLock {
            if (syncing) return
            syncing = true
            state
        }
        try {
            val status = start.status
            val statusHeld = status?.clientEntryId?.let { it in heldBack } ?: false
            val ready = start.rows.filter { it.clientEntryId !in heldBack }
            val timeEntryId: (String?) -> String? = { id ->
                if (id != null && TimeEntryCommand.isUUID(id) && id !in heldBack) id.lowercase() else null
            }
            var statusSent = false

            for ((index, row) in ready.withIndex()) {
                val isLast = index == ready.size - 1
                val tracking = if (isLast && !statusHeld) status?.payload(timeEntryId(status.clientEntryId), now) else null
                try {
                    send(row.payload(timeEntryId(row.clientEntryId)), tracking)
                    removeRow(row.clientEventId)
                    if (tracking != null) statusSent = true
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    val failure = BackendError.from(error)
                    if (failure is BackendError.Offline) return
                    // A point the server refuses for good is dropped, not retried forever.
                    if (!failure.isRetryable) removeRow(row.clientEventId)
                }
            }

            if (ready.isEmpty() && !statusHeld && status != null) {
                val carrier = status.carrierPoint()
                if (carrier != null) {
                    try {
                        send(carrier, status.payload(timeEntryId(status.clientEntryId), now))
                        statusSent = true
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                    }
                }
            }

            if (statusSent) {
                mutex.withLock {
                    if (state.status == status) {
                        state = state.copy(status = null)
                        store.save(state)
                    }
                }
            }
        } finally {
            syncing = false
        }
    }

    suspend fun removeAll() = mutex.withLock {
        state = LocationQueueState()
        store.save(state)
    }

    private suspend fun removeRow(clientEventId: String) = mutex.withLock {
        state = state.copy(rows = state.rows.filter { it.clientEventId != clientEventId })
        store.save(state)
    }

    companion object {
        const val capacity = 2000
    }
}
