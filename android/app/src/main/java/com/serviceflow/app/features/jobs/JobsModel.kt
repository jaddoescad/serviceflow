package com.serviceflow.app.features.jobs

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.serviceflow.app.design.Debouncer
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.app.backend.activeProjects
import com.serviceflow.app.backend.searchProjects
import com.serviceflow.core.Project
import com.serviceflow.core.TimeEntry
import kotlinx.coroutines.CancellationException
import java.text.Collator
import java.time.Instant
import kotlin.math.max

/**
 * What the Jobs list is showing: the search text and which jobs count as
 * "assigned" (assignments, jobs you have time on, and the current job).
 */
data class JobsQuery(val search: String, val relevantIds: List<String>, val trackedIds: List<String>)

/** Loads the Jobs list: active jobs 20 at a time, or search results. */
class JobsModel : ViewModel() {
    enum class Filter { Active, Assigned }

    companion object {
        const val PAGE_SIZE = 20
    }

    var projects by mutableStateOf<List<Project>>(emptyList())
        private set
    var hasLoaded by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var loadingMore by mutableStateOf(false)
        private set
    var hasMore by mutableStateOf(false)
        private set
    var filter by mutableStateOf(Filter.Active)
    /** The search field; kept here so it survives opening a job. */
    val search = Debouncer(viewModelScope)

    /**
     * Pages loaded so far (a silent refresh reloads all of them, so rows
     * already scrolled into view stay).
     */
    private var loadedPages = 0
    private var requestId = 0
    private var fetching = false
    /** Search matches, sliced into pages on the device. */
    private var searchMatches: List<Project> = emptyList()
    /** The query and filter last loaded from the first page. */
    private var loadedKey: Pair<JobsQuery, Filter>? = null

    /** Reloads from the first page when the filter, search or assignments changed. */
    suspend fun reloadIfChanged(query: JobsQuery, api: ServiceFlowAPI) {
        val key = query to filter
        if (key == loadedKey) return
        loadedKey = key
        reload(query, api)
    }

    /** Reloads from the first page (filter, search or assignments changed). */
    suspend fun reload(query: JobsQuery, api: ServiceFlowAPI) {
        loadedPages = 0
        load(query, api, pages = 1, append = false)
    }

    /** Reloads everything already shown, without collapsing to the first page. */
    suspend fun refresh(query: JobsQuery, api: ServiceFlowAPI) {
        load(query, api, pages = max(1, loadedPages), append = false)
    }

    suspend fun loadMore(query: JobsQuery, api: ServiceFlowAPI) {
        if (!hasMore || loadingMore || fetching || !hasLoaded) return
        loadingMore = true
        try {
            load(query, api, pages = 1, append = true)
        } finally {
            loadingMore = false
        }
    }

    private suspend fun load(query: JobsQuery, api: ServiceFlowAPI, pages: Int, append: Boolean) {
        requestId += 1
        val request = requestId
        fetching = true
        try {
            val search = query.search.trim()
            val firstPage = if (append) loadedPages else 0
            val size = PAGE_SIZE * pages

            var rows: List<Project>
            val more: Boolean
            if (search.isNotEmpty()) {
                if (!append) searchMatches = api.searchProjects(search, limit = 1000)
                val start = firstPage * PAGE_SIZE
                rows = searchMatches.drop(start).take(size)
                more = start + rows.size < searchMatches.size
            } else {
                val ids = if (filter == Filter.Assigned) query.relevantIds else null
                rows = if (append) {
                    api.activeProjects(page = firstPage, pageSize = PAGE_SIZE, ids = ids)
                } else {
                    // One request covering every loaded page, so a refresh keeps them.
                    api.activeProjects(page = 0, pageSize = size, ids = ids)
                }
                more = rows.size == (if (append) PAGE_SIZE else size)
                if (!append && filter == Filter.Active && query.trackedIds.isNotEmpty()) {
                    // Jobs you have time on stay visible even when they're older than the first pages.
                    val shown = rows.map { it.id }.toSet()
                    val missing = query.trackedIds.filter { it !in shown }
                    if (missing.isNotEmpty()) {
                        val extra = api.activeProjects(page = 0, pageSize = max(PAGE_SIZE, missing.size), ids = missing)
                        rows = rows + extra.filter { it.id !in shown }
                    }
                }
            }
            if (request != requestId) return
            if (append) {
                val existing = projects.map { it.id }.toSet()
                projects = projects + rows.filter { it.id !in existing }
                loadedPages += 1
            } else {
                val seen = mutableSetOf<String>()
                projects = rows.filter { seen.add(it.id) }
                loadedPages = pages
            }
            hasMore = more
            error = null
            hasLoaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (request != requestId) return
            // Keep what is already on screen.
            error = e.message ?: e.toString()
            hasLoaded = true
        } finally {
            if (request == requestId) fetching = false
        }
    }
}

/**
 * The rows the Jobs list shows, worked out once per render: filtered,
 * ordered by your latest activity, with the current job pulled out on top.
 */
class JobsListing(
    projects: List<Project>,
    filter: JobsModel.Filter,
    searching: Boolean,
    relevantIds: List<String>,
    entries: List<TimeEntry>,
    activeShift: TimeEntry?,
) {
    val featured: Project?
    val remaining: List<Project>
    /** The count in the section header (loaded rows, not a server total). */
    val count: Int

    init {
        val visible = if (searching) projects else projects.filter { !it.isArchived }
        val filtered = if (filter == JobsModel.Filter.Assigned && !searching) {
            val ids = relevantIds.toSet()
            visible.filter { it.id in ids }
        } else {
            visible
        }

        val latestActivity = mutableMapOf<String, Instant>()
        for (entry in entries) {
            val date = entry.endedAt ?: entry.startedAt
            if ((latestActivity[entry.project.id] ?: Instant.MIN) < date) latestActivity[entry.project.id] = date
        }
        val collator = Collator.getInstance()
        val sorted = filtered.sortedWith { lhs, rhs ->
            val l = latestActivity[lhs.id] ?: Instant.MIN
            val r = latestActivity[rhs.id] ?: Instant.MIN
            if (l != r) return@sortedWith r.compareTo(l)
            val lu = lhs.updatedAt ?: Instant.MIN
            val ru = rhs.updatedAt ?: Instant.MIN
            if (lu != ru) return@sortedWith ru.compareTo(lu)
            collator.compare(lhs.name, rhs.name)
        }

        if (activeShift != null && !searching) {
            val current = projects.firstOrNull { it.id == activeShift.project.id } ?: activeShift.project
            featured = current
            remaining = sorted.filter { it.id != current.id }
        } else {
            featured = null
            remaining = sorted
        }
        count = if (filter == JobsModel.Filter.Assigned || searching) filtered.size else visible.size
    }
}
