package com.serviceflow.app.backend

import com.serviceflow.app.AppConfig
import com.serviceflow.core.BackendError
import com.serviceflow.core.ISODate
import com.serviceflow.core.JSONValue
import com.serviceflow.core.TimeTrackingBackend
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.exception.AuthSessionMissingException
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.exceptions.UnauthorizedRestException
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.exception.PostgrestRestException
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder
import io.github.jan.supabase.postgrest.query.request.SelectRequestBuilder
import io.github.jan.supabase.realtime.Realtime
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CancellationException
import kotlin.time.Duration.Companion.seconds
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.IOException
import java.time.Instant

/**
 * Every Supabase call the app makes, grouped by domain in the
 * `ServiceFlowAPI*.kt` files. Row-level security scopes all reads to the
 * companies the signed-in person belongs to.
 */
class ServiceFlowAPI(config: AppConfig) : TimeTrackingBackend {
    val client: SupabaseClient = createSupabaseClient(config.supabaseURL, config.supabaseKey) {
        httpEngine = OkHttp.create()
        // iOS (URLSession) waits 60 s; the 10 s default fails on slow networks.
        requestTimeout = 60.seconds
        install(Auth) {
            alwaysAutoRefresh = true
            autoLoadFromStorage = true
        }
        install(Postgrest)
        install(Realtime)
        install(Functions)
    }

    /**
     * The company the person is looking at. Company data (jobs, leads) is
     * limited to it; null shows every company they belong to.
     */
    @Volatile
    var activeOrgId: String? = null

    /** Limits a query on a table with an `org_id` column to the active company. */
    fun PostgrestFilterBuilder.scoped() {
        activeOrgId?.let { eq("org_id", it) }
    }

    // MARK: Request helpers

    suspend fun <T> run(work: suspend () -> T): T = try {
        work()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        throw classify(e)
    }

    /** `select` on a table; the rows as JSON. */
    suspend fun rows(table: String, columns: String, request: SelectRequestBuilder.() -> Unit = {}): List<JSONValue> = run {
        val data = client.from(table).select(Columns.raw(columns), request).data
        (parse(data) as? JsonArray)?.toList() ?: emptyList()
    }

    suspend fun rpc(name: String, params: Map<String, JSONValue> = emptyMap()): JSONValue = run {
        parse(client.postgrest.rpc(name, JsonObject(params)).data)
    }

    // MARK: Time entries (TimeTrackingBackend)

    override suspend fun recordTimeEntryCommand(action: String, command: JSONValue, nextCommand: JSONValue?): JSONValue =
        rpc("record_time_entry_command", mapOf("action" to JsonPrimitive(action), "command" to command,
                                              "next_command" to (nextCommand ?: JsonNull)))

    override suspend fun fetchOwnTimeEntries(userId: String, since: Instant?, limit: Int): List<JSONValue> =
        rows("time_entries", "*") {
            filter {
                eq("employee_id", userId)
                if (since != null) gte("started_at", ISODate.string(since))
            }
            order("started_at", Order.DESCENDING)
            this.limit(limit.toLong())
        }

    override suspend fun recordLocationUpdate(point: JSONValue, tracking: JSONValue?) {
        rpc("record_location_update", mapOf("point" to point, "tracking" to (tracking ?: JsonNull)))
    }

    override suspend fun ensureLeadClockInJob(leadId: String): JSONValue =
        rpc("ensure_lead_clock_in_job", mapOf("requested_lead_id" to JsonPrimitive(leadId)))

    companion object {
        /** Postgres and PostgREST codes that mean the server refused for good. */
        private val definiteCodes = setOf("P0001", "P0002", "42501", "42883")
        private val definitePrefixes = listOf("22", "23", "PGRST1", "PGRST2")

        /**
         * `%text%` for `ilike`, with the characters PostgREST filters treat
         * specially neutralised; null for an empty query.
         */
        fun likePattern(text: String): String? {
            val cleaned = text.trim()
                .replace(Regex("[,()]"), " ")
                .replace("%", "\\%")
                .replace("_", "\\_")
            return if (cleaned.isEmpty()) null else "%$cleaned%"
        }

        fun parse(text: String): JSONValue =
            if (text.isBlank()) JsonNull else runCatching { Json.parseToJsonElement(text) }.getOrDefault(JsonNull)

        /**
         * Classifies an error for the offline queues. Anything that isn't a
         * definite refusal from the database is treated as worth retrying, so
         * a time record is never thrown away because of a flaky connection.
         */
        fun classify(error: Throwable): BackendError = when (error) {
            is BackendError -> error
            is IOException -> BackendError.Offline(error.message ?: "The connection failed.")
            is PostgrestRestException -> {
                val code = error.code
                when {
                    code == null -> BackendError.Offline(error.error)
                    code.startsWith("PGRST3") -> BackendError.Unauthorized(error.error)
                    code in definiteCodes || definitePrefixes.any(code::startsWith) ->
                        BackendError.Server(code = code, message = error.error, status = 400)
                    else -> BackendError.Offline(error.error)
                }
            }
            is AuthRestException, is AuthSessionMissingException, is UnauthorizedRestException ->
                BackendError.Unauthorized(error.message ?: "Your session has expired.")
            is RestException -> BackendError.Offline(error.error)
            else -> BackendError.Offline(error.message ?: error.toString())
        }
    }
}

sealed class AccountDeletionResult {
    data object Deleted : AccountDeletionResult()
    data class Blocked(val message: String) : AccountDeletionResult()
    data class Failed(val message: String) : AccountDeletionResult()
}
