package com.serviceflow.app.features.projectdetail

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.serviceflow.app.SessionContext
import com.serviceflow.app.backend.budgets
import com.serviceflow.app.backend.labourPlan
import com.serviceflow.app.backend.setTaskStatus
import com.serviceflow.core.BackendError
import com.serviceflow.core.BudgetProgress
import com.serviceflow.core.JSONFileStore
import com.serviceflow.core.LabourPlan
import com.serviceflow.core.LabourTask
import com.serviceflow.core.LabourTaskErrors
import com.serviceflow.core.QueuedTaskStatus
import com.serviceflow.core.TaskStatusQueue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import java.time.Instant

/** One queue of task checkbox changes per signed-in person. */
object LabourTaskQueues {
    private val queues = mutableMapOf<String, TaskStatusQueue>()

    fun queue(session: SessionContext): TaskStatusQueue = synchronized(queues) {
        queues.getOrPut(session.user.id) {
            TaskStatusQueue(session.storage.store("task-status-queue", ListSerializer(QueuedTaskStatus.serializer())))
        }
    }
}

/**
 * Loads a job's task plan, keeps a cached copy, and applies checkbox changes
 * optimistically.
 */
class LabourTasksModel(val jobId: String) : ViewModel() {
    var plan by mutableStateOf<LabourPlan?>(null)
        private set
    var budget by mutableStateOf<BudgetProgress?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var syncNotice by mutableStateOf<String?>(null)
        private set
    var pendingTaskIds by mutableStateOf<Set<String>>(emptySet())
        private set

    private var requestId = 0
    private var cache: JSONFileStore<LabourPlan>? = null
    private var debounce: Job? = null
    private var session: SessionContext? = null
    /** The Clock In screen also shows the job's budget meter. */
    private var includeBudget = false

    /** Shows the cached plan straight away; call once before refreshing. */
    fun start(session: SessionContext, includeBudget: Boolean) {
        this.session = session
        this.includeBudget = includeBudget
        if (cache != null) return
        val store = session.storage.store("labour-plan-$jobId", LabourPlan.serializer())
        cache = store
        plan = store.load()
        loading = plan == null
    }

    /** Sends queued checkbox changes, then reloads the plan (and budget). */
    suspend fun refresh(silent: Boolean) {
        val session = session ?: return
        requestId += 1
        val request = requestId
        if (!silent) loading = plan == null
        val api = session.api
        val queue = LabourTaskQueues.queue(session)
        queue.flush { item -> api.setTaskStatus(taskId = item.taskId, completed = item.completed) }
        try {
            val fetched = api.labourPlan(jobId)
            var progress: BudgetProgress? = null
            if (includeBudget) {
                progress = try {
                    api.budgets(listOf(jobId))[jobId]
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Throwable) {
                    null
                }
            }
            if (request != requestId) return
            val merged = applyPending(fetched, queue.pending)
            plan = merged
            cache?.save(merged)
            if (includeBudget) budget = progress ?: budget
            error = null
            syncNotice = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (request != requestId) return
            error = LabourTaskErrors.friendly(e.message)
        } finally {
            loading = false
        }
    }

    /** Changes still queued on the device win over the fetched state. */
    private fun applyPending(plan: LabourPlan, queued: List<QueuedTaskStatus>): LabourPlan {
        if (queued.isEmpty()) return plan
        val byTask = queued.associateBy { it.taskId }
        return plan.copy(tasks = plan.tasks.map { task ->
            val item = byTask[task.id] ?: return@map task
            task.copy(isCompleted = item.completed, completedAt = if (item.completed) task.completedAt ?: item.createdAt else null)
        })
    }

    /** A change from realtime or a timer; bursts are coalesced. */
    fun scheduleRefresh() {
        debounce?.cancel()
        debounce = viewModelScope.launch {
            delay(150)
            refresh(silent = true)
        }
    }

    /**
     * Flips a checkbox right away; a failed save is queued when it's only the
     * connection, and undone when the server refused it.
     */
    suspend fun toggle(task: LabourTask) {
        val session = session ?: return
        val current = plan ?: return
        if (current.tasks.none { it.id == task.id } || task.id in pendingTaskIds) return
        val previous = current
        val completed = !task.isCompleted
        pendingTaskIds = pendingTaskIds + task.id
        requestId += 1 // drop any refresh in flight so the checkbox doesn't flicker
        val next = current.copy(tasks = current.tasks.map {
            if (it.id == task.id) it.copy(isCompleted = completed, completedAt = if (completed) Instant.now() else null) else it
        })
        plan = next
        cache?.save(next)
        try {
            session.api.setTaskStatus(taskId = task.id, completed = completed)
            error = null
            refresh(silent = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            val failure = BackendError.from(e)
            if (failure.isRetryable) {
                LabourTaskQueues.queue(session).enqueue(QueuedTaskStatus(taskId = task.id, completed = completed, createdAt = Instant.now()))
                syncNotice = "Saved on this device. It will sync when ServiceFlow reconnects."
            } else {
                plan = previous
                cache?.save(previous)
                error = LabourTaskErrors.friendly(failure.message)
            }
        } finally {
            pendingTaskIds = pendingTaskIds - task.id
        }
    }
}
