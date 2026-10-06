package com.serviceflow.app.features.clockin

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.serviceflow.app.LocalSession
import com.serviceflow.app.backend.ServiceFlowAPI
import com.serviceflow.app.backend.searchProjects
import com.serviceflow.app.design.Debouncer
import com.serviceflow.core.BackendError
import com.serviceflow.core.Project
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope

/**
 * Debounced search of jobs and leads, shared by Clock In and Change Job.
 * Create it with [rememberProjectSearch], which also runs it; type through [update].
 */
class ProjectSearch(scope: CoroutineScope) {
    val query = Debouncer(scope)
    var results by mutableStateOf<List<Project>>(emptyList())
        private set
    var isSearching by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    val hasQuery: Boolean get() = query.text.isNotBlank()

    /** Shows the spinner right away, so "no results" never flashes while the debounce waits. */
    fun update(text: String) {
        query.update(text)
        isSearching = hasQuery
        if (!hasQuery) {
            results = emptyList()
            error = null
        }
    }

    suspend fun run(api: ServiceFlowAPI) {
        val text = query.committed
        if (text.isEmpty()) return
        try {
            val found = api.searchProjects(text)
            if (text != query.committed) return
            results = found
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (text != query.committed) return
            results = emptyList()
            error = (e as? BackendError)?.message ?: e.message ?: e.toString()
        }
        isSearching = false
    }

    fun clear() {
        query.clear()
        results = emptyList()
        error = null
        isSearching = false
    }
}

@Composable
fun rememberProjectSearch(): ProjectSearch {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val search = remember { ProjectSearch(scope) }
    LaunchedEffect(search.query.committed) { search.run(session.api) }
    return search
}
