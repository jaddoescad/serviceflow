package com.serviceflow.core

import java.io.IOException

/** A failed backend call, classified so offline queues know whether to retry. */
sealed class BackendError(override val message: String) : Exception(message) {
    /** No connection, timeout, or the request never completed. */
    class Offline(message: String) : BackendError(message)

    /** The session is missing or expired; retry after the session refreshes. */
    class Unauthorized(message: String) : BackendError(message)

    /**
     * The server answered and refused. `code` is the Postgres/PostgREST code
     * (`P0001` for raised exceptions, `42501` for permission errors).
     */
    class Server(val code: String?, message: String, val status: Int?) : BackendError(message)

    /** Worth retrying later without changing anything. */
    val isRetryable: Boolean
        get() = when (this) {
            is Offline, is Unauthorized -> true
            is Server -> status?.let { it >= 500 || it == 408 || it == 429 } ?: false
        }

    override fun equals(other: Any?): Boolean = other is BackendError && other::class == this::class &&
        other.message == message && (other as? Server)?.code == (this as? Server)?.code &&
        (other as? Server)?.status == (this as? Server)?.status

    override fun hashCode(): Int = message.hashCode()

    companion object {
        fun from(error: Throwable): BackendError = when (error) {
            is BackendError -> error
            is IOException -> Offline(error.message ?: "The connection failed.")
            else -> Server(null, error.message ?: error.toString(), null)
        }
    }
}

/** Time-entry and location calls used by the time tracker. */
interface TimeTrackingBackend {
    /** `public.record_time_entry_command(action, command, next_command)`. */
    suspend fun recordTimeEntryCommand(action: String, command: JSONValue, nextCommand: JSONValue?): JSONValue

    /** The signed-in person's own entries (not deleted), newest first. */
    suspend fun fetchOwnTimeEntries(userId: String, since: java.time.Instant?, limit: Int): List<JSONValue>

    /** `public.record_location_update(point, tracking)`. */
    suspend fun recordLocationUpdate(point: JSONValue, tracking: JSONValue?)

    /** `public.ensure_lead_clock_in_job(requested_lead_id)`: the job to clock into for a lead. */
    suspend fun ensureLeadClockInJob(leadId: String): JSONValue
}
