package com.serviceflow.app.features.jobs

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.Project
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The Jobs tab: the current job, active or assigned jobs, and search. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen(enabled: Boolean) {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val model: JobsModel = viewModel()
    val search = model.search
    val activeShift by tracker.activeShift.collectAsStateWithLifecycle()
    val entries by tracker.entries.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    val isSearching = search.committed.isNotEmpty()
    val myTime = remember(activeShift, entries) { tracker.myTimeByProject() }
    // What to load; any change reloads the list from the first page.
    val query = run {
        val tracked = myTime.keys.filter { it.isNotEmpty() }.sorted()
        val relevant = (session.assignedJobIds.toSet() + tracked).toMutableSet()
        activeShift?.project?.id?.takeIf { it.isNotEmpty() }?.let(relevant::add)
        JobsQuery(search = search.committed, relevantIds = relevant.sorted(), trackedIds = tracked)
    }
    val currentQuery by rememberUpdatedState(query)
    val listing = JobsListing(
        projects = model.projects, filter = model.filter, searching = isSearching,
        relevantIds = query.relevantIds, entries = listOfNotNull(activeShift) + entries, activeShift = activeShift,
    )

    LaunchedEffect(query, model.filter) { model.reloadIfChanged(query, session.api) }
    LaunchedEffect(enabled) {
        // Coming back to the tab refreshes, then every 45 s while it's visible.
        if (!enabled) return@LaunchedEffect
        if (model.hasLoaded) model.refresh(currentQuery, session.api)
        while (true) {
            delay(45_000)
            model.refresh(currentQuery, session.api)
        }
    }

    var refreshing by remember { mutableStateOf(false) }

    Scaffold(topBar = { TopAppBar(title = { Text("Jobs") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = search.text,
                onValueChange = search::update,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                placeholder = { Text("Search jobs and leads") },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                trailingIcon = {
                    if (search.text.isNotEmpty()) {
                        IconButton(onClick = search::clear) { Icon(Icons.Filled.Close, contentDescription = "Clear search") }
                    }
                },
                singleLine = true,
                shape = MaterialTheme.shapes.extraLarge,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Search,
                ),
            )
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        model.refresh(query, session.api)
                        refreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(Modifier.fillMaxSize()) {
                    model.error?.takeIf { it.isNotEmpty() }?.let { error ->
                        item(key = "error") {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Filled.Warning, contentDescription = null, tint = hex(0xb42318), modifier = Modifier.size(18.dp))
                                Text(error, style = appText(13, FontWeight.SemiBold, hex(0xb42318)))
                            }
                        }
                    }
                    if (!isSearching) {
                        item(key = "filter") {
                            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                                JobsModel.Filter.entries.forEachIndexed { index, filter ->
                                    SegmentedButton(
                                        selected = model.filter == filter,
                                        onClick = { model.filter = filter },
                                        shape = SegmentedButtonDefaults.itemShape(index, JobsModel.Filter.entries.size),
                                    ) { Text(if (filter == JobsModel.Filter.Active) "Active" else "Assigned") }
                                }
                            }
                        }
                    }
                    if (model.hasLoaded) {
                        content(listing, myTime, onSite = activeShift?.onSite, isSearching = isSearching, model = model,
                                isManager = session.isManager,
                                onOpen = { session.open(it) },
                                onLoadMore = { scope.launch { model.loadMore(currentQuery, session.api) } })
                    } else {
                        item(key = "loading") {
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 24.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                Text("Loading projects…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: Sections

private fun LazyListScope.content(
    listing: JobsListing,
    myTime: Map<String, Double>,
    onSite: Boolean?,
    isSearching: Boolean,
    model: JobsModel,
    isManager: Boolean,
    onOpen: (Project) -> Unit,
    onLoadMore: () -> Unit,
) {
    listing.featured?.let { featured ->
        item(key = "current-header") { SectionHeader("Current job") }
        item(key = "current:${featured.id}") {
            JobsCurrentCard(
                project = featured, onSite = onSite, myTime = myTime[featured.id],
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Palette.teal)
                    .clickable { onOpen(featured) }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }
    val title = when {
        isSearching -> "Search Results"
        model.filter == JobsModel.Filter.Assigned -> "Assigned Jobs"
        else -> "Active Jobs"
    }
    item(key = "header") { SectionHeader("$title (${listing.count})") }
    items(listing.remaining, key = { it.id }) { project ->
        Column {
            JobsRow(
                project = project, myTime = myTime[project.id],
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(project) }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
            HorizontalDivider(Modifier.padding(start = 70.dp))
        }
    }
    if (listing.remaining.isEmpty() && listing.featured == null) {
        item(key = "empty") { EmptyState(isSearching, model.filter, isManager) }
    }
    if (model.hasMore) {
        item(key = "more") {
            LaunchedEffect(listing.count) { onLoadMore() }
            Box(Modifier.fillMaxWidth().height(44.dp), contentAlignment = Alignment.Center) {
                if (model.loadingMore) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
    )
}

@Composable
private fun EmptyState(isSearching: Boolean, filter: JobsModel.Filter, isManager: Boolean) {
    val (title, detail, icon) = when {
        isSearching -> Triple("No matching jobs", "Try another name, email, phone, address, city, or postal code.", Icons.Outlined.Search)
        filter == JobsModel.Filter.Assigned -> Triple("No assigned jobs", "Assignments can be created from the office.", Icons.Outlined.HowToReg)
        isManager -> Triple("No active jobs yet", "New jobs from the office will appear here.", Icons.Outlined.Folder)
        else -> Triple("No active jobs yet", "Ask a manager to assign you to an active job.", Icons.Outlined.Folder)
    }
    ContentUnavailable(icon = icon, title = title, description = { Text(detail) })
}
