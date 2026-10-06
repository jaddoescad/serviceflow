package com.serviceflow.app.features.projectdetail

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.serviceflow.app.SessionContext
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.app.backend.budgets
import com.serviceflow.app.backend.jobTimeEntries
import com.serviceflow.app.features.media.MediaStore
import com.serviceflow.core.BudgetProgress
import com.serviceflow.core.Project
import com.serviceflow.core.TimeEntry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** Team time and budget for one job. Lives as long as the job's screen is in the back stack. */
class ProjectDetailModel(val project: Project, session: SessionContext) : ViewModel() {
    /** Everyone's entries on the job from the server. */
    var serverEntries by mutableStateOf<List<TimeEntry>>(emptyList())
        private set
    var budget by mutableStateOf(project.budget)
        private set
    var budgetLoading by mutableStateOf(true)
        private set
    var budgetFailed by mutableStateOf(false)
        private set
    /** Entries deleted on this device; hidden even if a refresh lands before the delete syncs. */
    private val deletedKeys = mutableSetOf<String>()

    val mediaStore = MediaStore(project = project, session = session, includeLinkedLead = true)

    val jobId: String get() = project.id

    /** Someone is clocked into the job right now (the live clock needs ticking). */
    val hasRunningEntry: Boolean get() = serverEntries.any { it.isActive }

    /**
     * Server entries merged with this device's entries for the job. The local
     * copy wins for the same entry, so the running shift and unsynced edits count.
     */
    fun entries(local: List<TimeEntry>): List<TimeEntry> {
        val mine = local.filter { it.project.id == jobId }
        val result = mine.toMutableList()
        for (entry in serverEntries) {
            if (mine.none { it.isSameEntry(entry) } && deletedKeys.none { it in entry.identityKeys }) result.add(entry)
        }
        return result.sortedByDescending { it.startedAt }
    }

    /** Reloads team entries and the budget together. */
    suspend fun refresh(api: ServiceFlowAPI) = coroutineScope {
        launch { refreshBudget(api) }
        launch { refreshEntries(api) }
    }

    suspend fun refreshEntries(api: ServiceFlowAPI) {
        if (project.isLead || jobId.isEmpty()) return
        try {
            serverEntries = api.jobTimeEntries(jobId)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
        }
    }

    suspend fun refreshBudget(api: ServiceFlowAPI) {
        if (project.isLead || jobId.isEmpty()) return
        try {
            api.budgets(listOf(jobId))[jobId]?.let { progress ->
                // Keep the budget hours the list row carried.
                budget = if (progress.budgetHours == null) progress.copy(budgetHours = budget?.budgetHours) else progress
            }
            budgetFailed = false
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            budgetFailed = budget == null
        }
        budgetLoading = false
    }

    fun removeLocally(entry: TimeEntry) {
        deletedKeys.addAll(entry.identityKeys)
        serverEntries = serverEntries.filter { !it.isSameEntry(entry) }
    }

    /** The budget to show; `unavailable` when it could not be loaded at all. */
    val shownBudget: BudgetProgress?
        get() {
            if (budget == null && budgetFailed) {
                return BudgetProgress(jobId = jobId, percentUsed = null, hoursUsed = null, status = BudgetProgress.Status.Unavailable)
            }
            return budget
        }
}
