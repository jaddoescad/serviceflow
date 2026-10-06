package com.serviceflow.app.features.clockin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.Spinner
import com.serviceflow.core.Project

/** "Change Job": pick another active job (or search jobs and leads). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectSwitcherSheet(
    currentProject: Project?,
    switching: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onPick: (Project) -> Unit,
) {
    val session = LocalSession.current
    val search = rememberProjectSearch()
    val isSwitching by rememberUpdatedState(switching)
    val sheetState = rememberModalBottomSheetState(confirmValueChange = { it != SheetValue.Hidden || !isSwitching })
    val hasQuery = search.hasQuery

    val seen = mutableSetOf<String>()
    val options = (if (hasQuery) search.results else session.mappedProjects)
        .filter { it.id.isNotEmpty() && it.id != currentProject?.id && !it.isArchived && seen.add(it.id) }
        .take(if (hasQuery) 50 else 40)

    ModalBottomSheet(onDismissRequest = { if (!switching) onDismiss() }, sheetState = sheetState) {
        CenterAlignedTopAppBar(
            title = { Text("Change Job") },
            navigationIcon = {
                IconButton(onClick = onDismiss, enabled = !switching) { Icon(Icons.Filled.Close, contentDescription = "Cancel") }
            },
            actions = { if (switching) Spinner(Palette.teal, Modifier.padding(end = 16.dp)) },
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        )
        ProjectSearchField(search, "Search all jobs", Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
        LazyColumn(Modifier.fillMaxWidth()) {
            if (error != null) {
                item { Text(error, color = Palette.red, modifier = Modifier.padding(16.dp)) }
            }
            item {
                Text(
                    if (hasQuery) "Search results" else "Active jobs",
                    style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
                )
            }
            if (options.isEmpty()) {
                item {
                    if (search.isSearching) {
                        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { Spinner(Palette.teal) }
                    } else {
                        Text(
                            search.error ?: if (hasQuery) "No matching jobs found." else "No other active jobs are available.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp),
                        )
                    }
                }
            }
            items(options, key = { it.id }) { project ->
                ProjectListRow(
                    project,
                    Modifier
                        .clickable(enabled = !switching) { onPick(project) }
                        .semantics { contentDescription = "Switch to ${project.name}" },
                )
            }
            if (currentProject != null) {
                item {
                    Text(
                        "Currently at ${currentProject.name}.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                    )
                }
            }
        }
    }
}
