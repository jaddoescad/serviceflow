package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import kotlin.math.max

@Serializable
enum class TimeEntryAction(val rawValue: String) {
    @SerialName("clock_in") ClockIn("clock_in"),
    @SerialName("clock_out") ClockOut("clock_out"),
    @SerialName("switch") SwitchProject("switch"),
    @SerialName("adjust") Adjust("adjust"),
    @SerialName("delete") Delete("delete"),
    @SerialName("observation") Observation("observation"),
    @SerialName("job_issue") JobIssue("job_issue");

    companion object {
        fun fromRaw(value: String?): TimeEntryAction? = entries.firstOrNull { it.rawValue == value }
    }
}

/** Payloads for `record_time_entry_command`. */
object TimeEntryCommand {
    internal val uuidPattern = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

    fun isUUID(value: String?): Boolean {
        value ?: return false
        return uuidPattern.containsMatchIn(value.lowercase())
    }

    /** The value when it's a UUID (the only ids the server accepts), else null. */
    internal fun uuidValue(value: String?): JSONValue = if (value != null && isUUID(value)) JsonPrimitive(value) else JsonNull

    /**
     * The command body for an entry.
     * - includeEndedAt: send `ended_at` (clock-out and edits of completed entries).
     * - reason: stored by the server in `time_entries.notes`; only lifecycle
     *   endings send one, so edits never overwrite the note.
     * - capturedAt: when the action happened on the device. Commands can be
     *   queued offline, so this keeps the event log accurate.
     */
    fun payload(
        entry: TimeEntry, includeEndedAt: Boolean = false, reason: String? = null,
        adjustmentSource: String? = null, capturedAt: Instant,
    ): JSONValue {
        val body = linkedMapOf<String, JSONValue>(
            "client_entry_id" to JsonPrimitive(entry.localId),
            "server_id" to uuidValue(entry.serverId),
            "user_name" to JsonPrimitive(entry.userName),
            "job_id" to uuidValue(entry.project.id),
            "project_name" to JsonPrimitive(entry.project.name),
            "project_address" to json(entry.project.fullAddress),
            "original_started_at" to json(entry.originalStartedAt),
            "started_at" to json(entry.startedAt),
            "clock_in_latitude" to json(entry.startedLocation?.latitude),
            "clock_in_longitude" to json(entry.startedLocation?.longitude),
            "clock_out_latitude" to json(entry.lastLocation?.latitude),
            "clock_out_longitude" to json(entry.lastLocation?.longitude),
            "last_distance_meters" to json(entry.lastDistanceMeters?.let { it.roundedSwift().toInt() }),
            "is_on_site" to json(entry.onSite),
            "segments" to (runCatching { JSONCoding.encode(ListSerializer(ShiftSegment.serializer()), entry.segments) }.getOrNull() ?: JsonArray(emptyList())),
            "reason" to json(reason),
            "source" to JsonPrimitive("mobile"),
            "adjustment_source" to json(adjustmentSource),
            "captured_at" to json(capturedAt),
        )
        if (includeEndedAt) body["ended_at"] = json(entry.endedAt)
        return JsonObject(body)
    }

    /**
     * The clock-in command. New entries use a UUID as their client id and ask
     * the server to use the same value as the row id, so the row id is known
     * on the device before the server has answered.
     */
    fun clockIn(entry: TimeEntry, capturedAt: Instant): JSONValue {
        val body = payload(entry, capturedAt = capturedAt) as? JsonObject ?: return JsonNull
        if (body["server_id"].isNull && isUUID(entry.localId)) {
            return body.with("server_id", entry.localId.lowercase())
        }
        return body
    }

    /** The delete command. */
    fun deletion(of: TimeEntry, capturedAt: Instant): JSONValue = jsonObject(
        "server_id" to uuidValue(of.serverId),
        "client_entry_id" to of.localId,
        "source" to "mobile",
        "captured_at" to capturedAt,
    )

    /** A job over-budget reason (`job_issue`). */
    fun jobIssue(clientId: String, jobId: String, reason: String, note: String?, minutesOver: Int): JSONValue = jsonObject(
        "client_id" to clientId,
        "job_id" to jobId,
        "reason" to reason,
        "note" to note.nonBlank?.take(280),
        "minutes_over" to max(0, minutesOver),
    )

    /** First row of an RPC response (the client accepts an object or an array). */
    fun firstRow(value: JSONValue?): JSONValue? = when (value) {
        is JsonArray -> value.firstOrNull()
        is JsonObject -> value
        else -> null
    }
}
