package com.serviceflow.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.util.UUID

/**
 * An in-memory stand-in for the Supabase RPCs, following the server rules
 * of `record_time_entry_command` closely enough to exercise the tracker.
 */
class FakeServer(private val employeeId: String) : TimeTrackingBackend {
    private var online = true
    val rows = linkedMapOf<String, JSONValue>() // by client_entry_id
    val calls = mutableListOf<String>()
    val locationPoints = mutableListOf<JSONValue>()
    val issues = mutableListOf<JSONValue>()

    fun setOnline(value: Boolean) {
        online = value
    }

    fun seed(row: JSONValue) {
        rows[row["client_entry_id"].stringValue!!] = row
    }

    override suspend fun recordTimeEntryCommand(action: String, command: JSONValue, nextCommand: JSONValue?): JSONValue {
        if (!online) throw BackendError.Offline("The Internet connection appears to be offline.")
        calls.add(action)
        return apply(action, command, nextCommand)
    }

    private fun apply(action: String, command: JSONValue, next: JSONValue?): JSONValue {
        val clientId = command["client_entry_id"].stringValue ?: ""
        when (action) {
            "clock_in" -> {
                rows[clientId]?.let { return it }
                if (rows.values.any { it["status"].stringValue == "active" && it["employee_id"].stringValue == employeeId }) {
                    throw BackendError.Server("P0001", "Employee already has an active time entry", 400)
                }
                val jobId = command["job_id"].nonEmptyString
                    ?: throw BackendError.Server("P0001", "A valid job_id is required", 400)
                val row = jsonObject(
                    "id" to (command["server_id"] ?: JsonPrimitive(UUID.randomUUID().toString().lowercase())),
                    "client_entry_id" to clientId, "employee_id" to employeeId, "job_id" to jobId,
                    "job_name" to (command["project_name"] ?: JsonPrimitive("Job")), "employee_name" to "Pat Painter",
                    "original_started_at" to (command["original_started_at"] ?: JsonNull),
                    "started_at" to (command["started_at"] ?: JsonNull),
                    "ended_at" to null, "status" to "active", "segments" to (command["segments"] ?: JsonArray(emptyList())),
                    "adjustment_history" to JsonArray(emptyList()),
                )
                rows[clientId] = row
                return row
            }
            "clock_out", "adjust", "delete", "observation" -> {
                val row = rows[clientId] ?: run {
                    if (action == "delete") return JsonPrimitive(false)
                    throw BackendError.Server("P0001", "Time entry not found", 400)
                }
                val existing = row as? JsonObject ?: return row
                val fields = existing.toMutableMap()
                if (action == "clock_out" && fields["status"].stringValue == "active") {
                    fields["ended_at"] = command["ended_at"] ?: JsonPrimitive(ISODate.string(Instant.now()))
                    fields["status"] = JsonPrimitive("completed")
                } else if (action == "adjust") {
                    command["started_at"]?.let { fields["started_at"] = it }
                    val ended = command["ended_at"]
                    if (ended != null && !ended.isNull) {
                        fields["ended_at"] = ended
                        fields["status"] = JsonPrimitive("completed")
                    }
                } else if (action == "delete") {
                    fields["status"] = JsonPrimitive("deleted")
                }
                val updated = JsonObject(fields)
                rows[clientId] = updated
                return if (action == "delete") JsonPrimitive(true) else updated
            }
            "switch" -> {
                val completed = apply("clock_out", command, null)
                val active = apply("clock_in", next ?: JsonNull, null)
                return jsonObject("completed_entry" to completed, "active_entry" to active)
            }
            "job_issue" -> {
                issues.add(command)
                return jsonObject("id" to "issue", "duplicate" to false)
            }
            else -> throw BackendError.Server("P0001", "Unsupported", 400)
        }
    }

    override suspend fun fetchOwnTimeEntries(userId: String, since: Instant?, limit: Int): List<JSONValue> {
        if (!online) throw BackendError.Offline("offline")
        return rows.values.filter { it["employee_id"].stringValue == userId }
    }

    override suspend fun recordLocationUpdate(point: JSONValue, tracking: JSONValue?) {
        if (!online) throw BackendError.Offline("offline")
        locationPoints.add(point)
    }

    override suspend fun ensureLeadClockInJob(leadId: String): JSONValue =
        jsonObject("id" to "22222222-2222-4222-8222-222222222222", "name" to "Converted lead", "status" to "active")

    fun allRows(): List<JSONValue> = rows.values.toList()
    fun callLog(): List<String> = calls.toList()
    fun points(): List<JSONValue> = locationPoints.toList()
}

class FakeLocation(
    override var authorization: LocationAuthorization = LocationAuthorization.Authorized,
    var answer: LocationAuthorization = LocationAuthorization.Authorized,
    var point: LocationPoint? = null,
) : LocationProviding {
    var requests = 0
    var fixes = 0

    override suspend fun requestAuthorizationIfNeeded(): LocationAuthorization {
        if (authorization == LocationAuthorization.NotDetermined) {
            requests += 1
            authorization = answer
        }
        return authorization
    }

    override suspend fun currentPoint(timeoutSeconds: Double): LocationPoint? {
        fixes += 1
        return point
    }
}

class FakeReminders : ShiftReminderScheduling {
    val scheduled = mutableListOf<String>()
    var cancels = 0
    override fun scheduleReminders(shift: TimeEntry, now: Instant) {
        scheduled.add(shift.localId)
    }

    override fun cancelReminders() {
        cancels += 1
    }
}

/** A clock the checks can move forward. */
class TestClock(var date: Instant) {
    fun advance(minutes: Double) {
        date = date.addingTimeInterval(minutes * 60)
    }
}
