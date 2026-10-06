package com.serviceflow.app.backend

import com.serviceflow.core.LabourPlan
import com.serviceflow.core.TimeEntry
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.util.UUID

// Job time entries and labour tasks. The signed-in person's own time entries
// and location (`TimeTrackingBackend`) are in `ServiceFlowAPI.kt`.

/** Everyone's entries on one job (company members can read them). */
suspend fun ServiceFlowAPI.jobTimeEntries(jobId: String): List<TimeEntry> =
    rows("time_entries", "*") {
        filter {
            eq("job_id", jobId)
            neq("status", "deleted")
        }
        order("started_at", Order.DESCENDING)
        limit(1000)
    }.mapNotNull { TimeEntry.fromServerRow(it) }

// MARK: Labour tasks

suspend fun ServiceFlowAPI.labourPlan(jobId: String): LabourPlan = coroutineScope {
    val tasks = async {
        rows("job_tasks", "*") {
            filter { eq("job_id", jobId) }
            order("sort_order", Order.ASCENDING)
        }
    }
    val budget = async {
        rows("job_budgets", "id,job_id,instructions,budget_minutes,version,status") {
            filter {
                eq("job_id", jobId)
                isIn("status", listOf("active", "closed"))
            }
            order("version", Order.DESCENDING)
            limit(1)
        }
    }
    LabourPlan(taskRows = tasks.await(), budgetRow = budget.await().firstOrNull(), fetchedAt = Instant.now())
}

suspend fun ServiceFlowAPI.setTaskStatus(taskId: String, completed: Boolean) {
    rpc("set_job_task_status", mapOf(
        "requested_task_id" to JsonPrimitive(taskId),
        "requested_status" to JsonPrimitive(if (completed) "completed" else "pending"),
    ))
}

/**
 * Calls [onChange] (on [scope]) whenever a task on the job changes. Pass the
 * returned channel to [stopWatching] when done.
 */
suspend fun ServiceFlowAPI.watchTasks(jobId: String, scope: CoroutineScope, onChange: () -> Unit): RealtimeChannel {
    val suffix = UUID.randomUUID().toString().take(8)
    val channel = client.channel("project-labour-task-state:$jobId:watch-$suffix")
    channel.postgresChangeFlow<PostgresAction>(schema = "public") {
        table = "job_tasks"
        filter("job_id", FilterOperator.EQ, jobId)
    }.onEach { onChange() }.launchIn(scope)
    runCatching { channel.subscribe(blockUntilSubscribed = true) }
    return channel
}

suspend fun ServiceFlowAPI.stopWatching(channel: RealtimeChannel) {
    runCatching { client.realtime.removeChannel(channel) }
}
