package com.serviceflow.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.text.Collator
import java.time.Instant
import java.time.ZoneId
import kotlin.math.max

/** A checklist item on a job (`job_tasks` row). */
@Serializable
data class LabourTask(
    val id: String,
    val jobId: String,
    val title: String,
    val notes: String? = null,
    val budgetedHours: Double = 0.0,
    val isCompleted: Boolean = false,
    @Serializable(with = InstantSerializer::class) val completedAt: Instant? = null,
    val sortOrder: Int = 0,
    val budgetId: String? = null,
) {
    /** `Done · 3:05 PM` today, else `Done · Sep 3, 3:05 PM`. */
    fun doneLabel(now: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
        val completedAt = completedAt ?: return "Done"
        val time = DateText.time(completedAt)
        if (completedAt.atZone(zone).toLocalDate().isEqual(now.atZone(zone).toLocalDate())) return "Done · $time"
        return "Done · ${DateText.format(completedAt, "MMMd", zone = zone)}, $time"
    }

    companion object {
        fun fromRow(row: JSONValue?): LabourTask? {
            val id = row["id"].nonEmptyString ?: return null
            return LabourTask(
                id = id,
                jobId = row["job_id"].nonEmptyString ?: "",
                budgetId = row["budget_id"].nonEmptyString,
                title = row["title"].nonEmptyString ?: "Task",
                notes = row["notes"].nonEmptyString,
                budgetedHours = max(0.0, (row["budget_minutes"].doubleValue ?: 0.0) / 60),
                isCompleted = row["status"].stringValue == "completed",
                completedAt = row["completed_at"].dateValue,
                sortOrder = row["sort_order"].intValue ?: 0,
            )
        }
    }
}

/**
 * A job's task plan: its tasks and the published labour budget.
 * The constructor keeps tasks as given (so `copy` stays public for optimistic
 * edits); [sorted] and the row-based `LabourPlan(taskRows, budgetRow, fetchedAt)`
 * apply the Swift initializer's order.
 */
@Serializable
data class LabourPlan(
    val tasks: List<LabourTask> = emptyList(),
    val instructions: String? = null,
    /** Total hours of the published budget (`job_budgets.budget_minutes`). */
    val budgetedHours: Double? = null,
    @Serializable(with = InstantSerializer::class) val fetchedAt: Instant? = null,
) {
    val hasBudget: Boolean get() = budgetedHours != null
    val completedCount: Int get() = tasks.count { it.isCompleted }

    /** The budget's hours, else the sum of the task hours. */
    val totalHours: Double get() = max(0.0, budgetedHours ?: tasks.sumOf { it.budgetedHours })

    val completionPercent: Double
        get() = if (tasks.isEmpty()) 0.0 else completedCount.toDouble() / tasks.size * 100

    companion object {
        private val titleOrder: Comparator<String> = Collator.getInstance().let { collator -> Comparator { a, b -> collator.compare(a, b) } }

        /** Tasks by sort order, then title. */
        fun sorted(tasks: List<LabourTask>): List<LabourTask> =
            tasks.sortedWith(compareBy<LabourTask> { it.sortOrder }.thenBy(titleOrder) { it.title })

        /** Built from `job_tasks` rows and the job's `job_budgets` row. */
        operator fun invoke(taskRows: List<JSONValue>, budgetRow: JSONValue?, fetchedAt: Instant): LabourPlan {
            val budgetMinutes = budgetRow["budget_minutes"].doubleValue
            return LabourPlan(
                tasks = sorted(taskRows.mapNotNull { LabourTask.fromRow(it) }),
                instructions = budgetRow["instructions"].nonEmptyString,
                budgetedHours = budgetMinutes?.let { max(0.0, it / 60) },
                fetchedAt = fetchedAt,
            )
        }
    }
}

object LabourTaskErrors {
    /** Message shown when loading or saving tasks fails. */
    fun friendly(message: String?): String {
        val text = message?.trim()?.takeIf { it.isNotEmpty() }
            ?: return "Tasks could not sync. Your last saved list is still available."
        if (Regex("not assigned|permission|row-level security|task access denied", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
            return "This job is not assigned to your account."
        }
        if (Regex("function.*does not exist|schema cache", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
            return "Painter tasks are not available in this environment yet."
        }
        return text
    }
}

/** A task checkbox change waiting to reach the server. Last write wins per task. */
@Serializable
data class QueuedTaskStatus(
    val taskId: String,
    val completed: Boolean,
    @Serializable(with = InstantSerializer::class) val createdAt: Instant,
)

/** Durable queue of task checkbox changes (a Swift actor; guarded by a mutex here). */
class TaskStatusQueue(private val store: JSONFileStore<List<QueuedTaskStatus>>) {
    private val mutex = Mutex()

    @Volatile
    private var items: List<QueuedTaskStatus> = store.load() ?: emptyList()

    @Volatile
    private var flushing = false

    val pending: List<QueuedTaskStatus> get() = items

    suspend fun enqueue(item: QueuedTaskStatus) = mutex.withLock {
        items = items.filter { it.taskId != item.taskId } + item
        store.save(items)
    }

    /**
     * Sends queued changes; transient failures stay queued, refusals are dropped.
     * Like the Swift actor, the lock is not held while a change is being sent.
     */
    suspend fun flush(send: suspend (QueuedTaskStatus) -> Unit) {
        val snapshot = mutex.withLock {
            if (flushing) return
            flushing = true
            items
        }
        try {
            for (item in snapshot) {
                try {
                    send(item)
                    remove(item)
                } catch (error: Exception) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    val failure = BackendError.from(error)
                    if (!failure.isRetryable) remove(item)
                    if (failure is BackendError.Offline) return
                }
            }
        } finally {
            flushing = false
        }
    }

    private suspend fun remove(item: QueuedTaskStatus) = mutex.withLock {
        items = items.filter { it != item }
        store.save(items)
    }
}
