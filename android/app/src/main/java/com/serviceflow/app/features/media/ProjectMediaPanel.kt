package com.serviceflow.app.features.media

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.Spinner
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.bordered
import com.serviceflow.app.design.hex
import com.serviceflow.core.DateText
import com.serviceflow.core.MediaKind
import com.serviceflow.core.MediaRules
import com.serviceflow.core.PendingUpload
import com.serviceflow.core.Project
import kotlinx.coroutines.launch

private const val COLUMNS = 3
private val Danger = hex(0xa6402d)

/** One line of the panel: a full-width part, or a grid tile. */
private sealed interface PanelRow {
    val key: String

    class Full(override val key: String, val content: @Composable () -> Unit) : PanelRow
    class Tile(val entry: MediaEntry) : PanelRow {
        override val key: String get() = entry.id
    }
}

/**
 * Project Detail's Media tab: upload progress, then every photo and video
 * grouped by the day it was taken, three to a row.
 *
 * Given a bounded height it scrolls itself as a lazy grid (wrap it in a
 * `PullToRefreshBox` calling `store.load()` for pull-to-refresh). Inside a
 * vertically scrolling parent it lays everything out in place instead.
 */
@Composable
fun ProjectMediaPanel(
    store: MediaStore,
    project: Project,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
) {
    val scope = rememberCoroutineScope()
    var lightboxId by remember { mutableStateOf<String?>(null) }
    var confirmRemove by remember { mutableStateOf<PendingUpload?>(null) }
    val rows = panelRows(store, onRetryLoad = { scope.launch { store.load() } })
    val tile: @Composable (MediaEntry) -> Unit = { entry ->
        Tile(entry, store, onOpen = {
            when (entry) {
                is MediaEntry.Pending -> if (entry.upload.status == PendingUpload.Status.Failed) store.retry(entry.upload.localId)
                is MediaEntry.Remote -> lightboxId = entry.item.id
            }
        }, onLongPress = { upload -> if (upload.status != PendingUpload.Status.Uploading) confirmRemove = upload })
    }

    BoxWithConstraints(modifier) {
        if (constraints.hasBoundedHeight) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(COLUMNS),
                modifier = Modifier.fillMaxSize(),
                contentPadding = contentPadding,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                items(rows.size, key = { rows[it].key }, span = { index ->
                    GridItemSpan(if (rows[index] is PanelRow.Full) maxLineSpan else 1)
                }) { index ->
                    when (val row = rows[index]) {
                        is PanelRow.Full -> row.content()
                        is PanelRow.Tile -> tile(row.entry)
                    }
                }
            }
        } else {
            Column(Modifier.fillMaxWidth().padding(contentPadding), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                StaticRows(rows, tile)
            }
        }
    }

    lightboxId?.let { id -> MediaLightbox(store, startId = id) { lightboxId = null } }
    confirmRemove?.let { upload ->
        AlertDialog(
            onDismissRequest = { confirmRemove = null },
            title = { Text("Remove pending upload?") },
            text = { Text("This removes the local capture from the upload queue.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        store.discard(upload.localId)
                        confirmRemove = null
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Remove") }
            },
            dismissButton = { TextButton(onClick = { confirmRemove = null }) { Text("Keep") } },
        )
    }
}

/** Without a lazy grid: full-width parts as they are, tiles three to a row. */
@Composable
private fun StaticRows(rows: List<PanelRow>, tile: @Composable (MediaEntry) -> Unit) {
    var index = 0
    while (index < rows.size) {
        val row = rows[index]
        if (row is PanelRow.Full) {
            row.content()
            index += 1
            continue
        }
        val tiles = rows.drop(index).takeWhile { it is PanelRow.Tile }.take(COLUMNS).map { (it as PanelRow.Tile).entry }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            for (slot in 0 until COLUMNS) {
                Box(Modifier.weight(1f)) { tiles.getOrNull(slot)?.let { tile(it) } }
            }
        }
        index += tiles.size
    }
}

@Composable
private fun panelRows(store: MediaStore, onRetryLoad: () -> Unit): List<PanelRow> {
    val entries = MediaEntry.all(store)
    val rows = mutableListOf<PanelRow>()
    rows += PanelRow.Full("top") { Spacer(Modifier.height(11.dp)) }
    val counts = store.pendingCounts
    if (counts.active + counts.failed > 0) rows += PanelRow.Full("uploads") { UploadBanner(store) }
    store.error?.let { message -> rows += PanelRow.Full("error") { ErrorRow(message, onRetryLoad) } }
    when {
        store.isLoading && store.items.isEmpty() -> rows += PanelRow.Full("loading") { LoadingState() }
        entries.isEmpty() -> rows += PanelRow.Full("empty") { EmptyState() }
        else -> {
            rows += PanelRow.Full("header") { Header(entries.size) }
            // Newest day first, newest entry first within a day.
            for (section in MediaRules.sections(entries, timestamp = { it.timestamp })) {
                rows += PanelRow.Full("day-${section.key}") { DayHeader(section.title, section.items.size) }
                section.items.forEach { rows += PanelRow.Tile(it) }
                rows += PanelRow.Full("end-${section.key}") { Spacer(Modifier.height(10.dp)) }
            }
        }
    }
    rows += PanelRow.Full("bottom") { Spacer(Modifier.height(35.dp)) }
    return rows
}

// MARK: Sections

@Composable
private fun DayHeader(title: String, count: Int) {
    Row(
        Modifier
            .fillMaxWidth()
            .drawBehind {
                drawLine(hex(0xdfe5e8), Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1.dp.toPx())
            }
            .padding(bottom = 8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(title, style = appText(15, FontWeight.Black, DetailPalette.navy), modifier = Modifier.weight(1f))
        Text("$count", style = appText(12, FontWeight.Bold, DetailPalette.muted), modifier = Modifier.padding(start = 12.dp))
    }
}

@Composable
private fun Header(count: Int) {
    Row(Modifier.fillMaxWidth().padding(bottom = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("PROJECT RECORD", style = appText(9.5, FontWeight.Black, DetailPalette.brand, tracking = 1.1))
            Text("Photos & Videos", style = appText(22, FontWeight.Black, DetailPalette.ink, tracking = -0.5),
                 modifier = Modifier.padding(top = 2.dp))
        }
        Box(
            Modifier.heightIn(min = 34.dp).widthIn(min = 34.dp).background(hex(0xedf4f5), CircleShape).padding(horizontal = 10.dp),
            contentAlignment = Alignment.Center,
        ) { Text("$count", style = appText(13, FontWeight.Black, DetailPalette.brand)) }
    }
}

// MARK: Tiles

@Composable
private fun Tile(entry: MediaEntry, store: MediaStore, onOpen: () -> Unit, onLongPress: (PendingUpload) -> Unit) {
    val upload = entry.pendingUpload
    val noun = if (entry.kind == MediaKind.Video) "Video" else "Photo"
    val label = if (upload != null) "$noun ${upload.status.rawValue}" else "Open ${noun.lowercase()}"
    Column(
        Modifier
            .bordered(11.dp, border = if (upload == null) DetailPalette.border else hex(0xb9d9df))
            .combinedClickable(onClick = onOpen, onLongClick = upload?.let { { onLongPress(it) } })
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
            },
    ) {
        MediaTileImage(entry, store, MediaTileStyle.Grid, Modifier.fillMaxWidth())
        Row(
            Modifier.fillMaxWidth().heightIn(min = 42.dp).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            AppIcon(Icons.Outlined.Person, 13.dp, DetailPalette.muted)
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                val source = when (entry) {
                    is MediaEntry.Pending -> store.uploaderName
                    is MediaEntry.Remote -> entry.item.sourceName
                }
                val subtitle = when (entry) {
                    is MediaEntry.Pending -> if (entry.upload.status == PendingUpload.Status.Failed) "Upload failed" else "Just captured"
                    is MediaEntry.Remote -> DateText.canadianTime(entry.item.timestamp)
                }
                Text(source, style = appText(8.5, FontWeight.ExtraBold, DetailPalette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = appText(8, FontWeight.Bold, DetailPalette.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

// MARK: States

@Composable
private fun UploadBanner(store: MediaStore) {
    val counts = store.pendingCounts
    val total = counts.active + counts.failed
    val failed = counts.failed > 0
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 7.dp)
            .background(if (failed) hex(0xfbecea) else hex(0xeaf4f6), RoundedCornerShape(14.dp))
            .padding(start = 13.dp, end = 4.dp, top = 11.dp, bottom = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (failed) AppIcon(Icons.Filled.Error, 18.dp, Danger) else Spinner(DetailPalette.brand)
        Column(Modifier.weight(1f)) {
            Text(
                if (failed) "${counts.failed} ${if (counts.failed == 1) "upload needs" else "uploads need"} attention"
                else "Uploading $total ${if (total == 1) "item" else "items"}",
                style = appText(12, FontWeight.ExtraBold, DetailPalette.brand),
            )
            Text("Uploads continue after you close the camera.", style = appText(10.5, FontWeight.SemiBold, DetailPalette.muted),
                 modifier = Modifier.padding(top = 2.dp))
        }
        if (failed) {
            TextButton(onClick = store::retryAllFailed, colors = ButtonDefaults.textButtonColors(contentColor = DetailPalette.brand)) {
                Text("Retry all", style = appText(13, FontWeight.ExtraBold, DetailPalette.brand))
            }
        }
    }
}

@Composable
private fun ErrorRow(message: String, onRetry: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 7.dp)
            .background(hex(0xfbecea), RoundedCornerShape(12.dp))
            .padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AppIcon(Icons.Outlined.ErrorOutline, 20.dp, Danger)
        Text(message, style = appText(12, FontWeight.SemiBold, hex(0x873523)), modifier = Modifier.weight(1f))
        TextButton(onClick = onRetry, colors = ButtonDefaults.textButtonColors(contentColor = DetailPalette.brand)) {
            Text("Retry", style = appText(13, FontWeight.ExtraBold, DetailPalette.brand))
        }
    }
}

@Composable
private fun LoadingState() {
    Column(Modifier.fillMaxWidth().padding(top = 58.dp), horizontalAlignment = Alignment.CenterHorizontally,
           verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CircularProgressIndicator(color = DetailPalette.brand)
        Text("Loading project media", style = appText(12, FontWeight.SemiBold, DetailPalette.muted))
    }
}

@Composable
private fun EmptyState() {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.padding(bottom = 14.dp).size(88.dp).background(hex(0xeef6f8), CircleShape), contentAlignment = Alignment.Center) {
            AppIcon(Icons.Outlined.PhotoLibrary, 34.dp, DetailPalette.brand)
        }
        Text("No photos or videos yet", style = appText(15, FontWeight.Bold, DetailPalette.ink))
        Text(
            "Capture the site before, during, and after the work to build the project record.",
            style = appText(12, FontWeight.Medium, DetailPalette.muted), textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
