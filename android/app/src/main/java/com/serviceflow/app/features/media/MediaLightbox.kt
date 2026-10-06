package com.serviceflow.app.features.media

import android.net.Uri
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.Spinner
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.photoeditor.AnnotationRenderer
import com.serviceflow.core.DateText
import com.serviceflow.core.MediaClient
import com.serviceflow.core.MediaItem
import com.serviceflow.core.MediaKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Full-screen viewer for a project's uploaded photos and videos: paging,
 * pinch zoom, swipe down to close, editing the description and drawings, and
 * delete for the person who uploaded it. Shown in its own window.
 */
@Composable
fun MediaLightbox(store: MediaStore, startId: String, onClose: () -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val items = store.sortedItems
    val pager = rememberPagerState(initialPage = items.indexOfFirst { it.id == startId }.coerceAtLeast(0)) { items.size }
    var currentId by remember { mutableStateOf(startId) }
    var zoomed by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<MediaItem?>(null) }
    var deleteFailure by remember { mutableStateOf<String?>(null) }
    var editingPhoto by remember { mutableStateOf<MediaItem?>(null) }
    var editingDescription by remember { mutableStateOf<MediaItem?>(null) }
    val visible = remember { Animatable(0f) }
    var closing by remember { mutableStateOf(false) }

    val index = items.indexOfFirst { it.id == currentId }.takeIf { it >= 0 }
    val current = index?.let { items[it] }

    fun close(animated: Boolean) {
        if (closing) return
        closing = true
        if (!animated) {
            onClose()
            return
        }
        scope.launch {
            visible.animateTo(0f, tween(180, easing = EaseIn))
            onClose()
        }
    }

    LaunchedEffect(Unit) { visible.animateTo(1f, tween(200, easing = EaseOut)) }
    LaunchedEffect(pager) {
        snapshotFlow { pager.currentPage }.collect { page ->
            store.sortedItems.getOrNull(page)?.let { currentId = it.id }
            zoomed = false
        }
    }
    // The open item was deleted or disappeared.
    val ids = items.map { it.id }
    LaunchedEffect(ids) { if (currentId !in ids) close(animated = true) }

    MediaFullScreenDialog(onDismissRequest = { close(animated = true) }) {
        Column(
            Modifier
                .fillMaxSize()
                .mediaSwipeToDismiss(enabled = !zoomed) { close(animated = false) }
                .graphicsLayer { alpha = visible.value }
                .background(hex(0x050607))
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(top = 10.dp),
        ) {
            TopBar(
                current = current, index = index, count = items.size,
                canEdit = current?.let(store::canEdit) == true,
                canDelete = current?.canDelete(session.user.id) == true,
                deleting = store.deletingId != null, deletingCurrent = current != null && store.deletingId == current.id,
                zoomed = zoomed,
                onClose = { close(animated = true) },
                onEdit = { item -> if (item.kind == MediaKind.Video) editingDescription = item else editingPhoto = item },
                onDelete = { confirmDelete = it },
            )
            HorizontalPager(
                state = pager,
                key = { page -> items[page].id },
                userScrollEnabled = !zoomed,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) { page ->
                val item = items[page]
                val isCurrent = item.id == currentId
                Box(Modifier.fillMaxSize().padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                    if (item.kind == MediaKind.Video) {
                        val client = session.mediaClient
                        if (isCurrent && client != null) {
                            LightboxVideo(client, item)
                        } else {
                            Box(Modifier.fillMaxSize().background(hex(0x101820)), contentAlignment = Alignment.Center) {
                                AppIcon(Icons.Filled.Videocam, 42.dp, Color.White)
                            }
                        }
                    } else {
                        LightboxPhoto(item, isCurrent) { isZoomed -> if (isCurrent) zoomed = isZoomed }
                    }
                }
            }
            CaptionBar(current)
        }

        confirmDelete?.let { item ->
            AlertDialog(
                onDismissRequest = { confirmDelete = null },
                title = { Text(if (item.kind == MediaKind.Video) "Delete video?" else "Delete photo?") },
                text = { Text("It will be removed from this project. A manager can restore it from the trash.") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            confirmDelete = null
                            scope.launch {
                                if (store.delete(item)) {
                                    close(animated = true)
                                } else {
                                    deleteFailure = store.error ?: "Unable to delete this media."
                                }
                            }
                        },
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Text("Delete") }
                },
                dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Cancel") } },
            )
        }
        deleteFailure?.let { message ->
            AlertDialog(
                onDismissRequest = { deleteFailure = null },
                title = { Text("Delete failed") },
                text = { Text(message) },
                confirmButton = { TextButton(onClick = { deleteFailure = null }) { Text("OK") } },
            )
        }
        editingPhoto?.let { item -> MediaPhotoEditFlow(item, store) { editingPhoto = null } }
        editingDescription?.let { item -> MediaDescriptionEditor(item, store) { editingDescription = null } }
    }
}

@Composable
private fun TopBar(
    current: MediaItem?, index: Int?, count: Int, canEdit: Boolean, canDelete: Boolean, deleting: Boolean,
    deletingCurrent: Boolean, zoomed: Boolean, onClose: () -> Unit, onEdit: (MediaItem) -> Unit, onDelete: (MediaItem) -> Unit,
) {
    Row(Modifier.fillMaxWidth().height(54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.widthIn(min = 68.dp).heightIn(min = 44.dp)
                .clickable(role = Role.Button, onClick = onClose)
                .semantics { contentDescription = "Close media viewer" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            AppIcon(Icons.Filled.Close, 24.dp, Color.White)
            Text("Close", style = appText(15, FontWeight.Bold, Color.White))
        }
        Column(Modifier.weight(1f).padding(horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally,
               verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (current != null && index != null) {
                Text("${if (current.kind == MediaKind.Video) "Video" else "Photo"} ${index + 1} / $count",
                     style = appText(14, FontWeight.ExtraBold, Color.White))
                Text("Taken by ${current.sourceName}", style = appText(10.5, FontWeight.SemiBold, hex(0xb7c0c5)),
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        // Edit (photo drawings and description, or a video's description) and delete.
        Row(Modifier.widthIn(min = 68.dp), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically) {
            if (current != null && canEdit) {
                val video = current.kind == MediaKind.Video
                TextButton(
                    onClick = { onEdit(current) }, enabled = !zoomed,
                    colors = ButtonDefaults.textButtonColors(contentColor = Color.White, disabledContentColor = Color.White.copy(alpha = 0.4f)),
                    modifier = Modifier.semantics { contentDescription = if (video) "Edit description" else "Edit photo" },
                ) { Text(if (video) "Description" else "Edit", style = appText(15, FontWeight.Bold, Color.Unspecified)) }
            }
            if (current != null && canDelete) {
                IconButton(
                    onClick = { onDelete(current) }, enabled = !deleting,
                    colors = IconButtonDefaults.iconButtonColors(contentColor = Color.White, disabledContentColor = Color.White.copy(alpha = 0.6f)),
                ) {
                    if (deletingCurrent) Spinner(Color.White) else AppIcon(Icons.Outlined.Delete, 22.dp, Color.Unspecified, contentDescription = "Delete media")
                }
            }
        }
    }
}

@Composable
private fun CaptionBar(current: MediaItem?) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        current?.mediaDescription?.let { description ->
            Text(description, style = appText(13, FontWeight.SemiBold, Color.White.copy(alpha = 0.9f)),
                 textAlign = TextAlign.Center, maxLines = 4, overflow = TextOverflow.Ellipsis,
                 modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp))
        }
        Row(Modifier.height(30.dp).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            if (current != null) {
                AppIcon(if (current.kind == MediaKind.Video) Icons.Outlined.Videocam else Icons.Outlined.PhotoCamera, 15.dp,
                        Color.White.copy(alpha = 0.7f))
                Text("${DateText.canadianLongDate(current.timestamp)} · ${DateText.canadianTime(current.timestamp)}",
                     style = appText(11, FontWeight.Bold, Color.White.copy(alpha = 0.72f)), maxLines = 1)
            }
        }
    }
}

/** A lightbox photo page: the original, downsampled to the screen, zoomable, with its drawings on top. */
@Composable
private fun LightboxPhoto(item: MediaItem, isCurrent: Boolean, onZoomChange: (Boolean) -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    val maxPixel = min(4096, with(LocalDensity.current) { 1400.dp.toPx() }.roundToInt())
    var original by remember(item.id) { mutableStateOf<android.graphics.Bitmap?>(null) }
    // The original with its drawings painted on, redrawn only when they change.
    var displayed by remember(item.id) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(item.id) {
        val client = session.mediaClient ?: return@LaunchedEffect
        if (original == null) original = MediaImageLoader.image(context, client.originalURL(item.id), maxPixel, client)
    }
    LaunchedEffect(original, item.annotations) {
        val image = original ?: return@LaunchedEffect
        val document = item.annotations
        displayed = withContext(Dispatchers.Default) {
            (if (document != null) AnnotationRenderer.composite(image, document) else image).asImageBitmap()
        }
    }
    val shown = displayed
    if (shown != null) {
        MediaZoomableImage(shown, isCurrent, onZoomChange, Modifier.fillMaxSize())
    } else {
        Spinner(Color.White)
    }
}

/** A lightbox video page: streamed from the Worker with the current token. */
@Composable
private fun LightboxVideo(client: MediaClient, item: MediaItem) {
    var headers by remember(item.id) { mutableStateOf<Map<String, String>?>(null) }
    LaunchedEffect(item.id) { headers = runCatching { client.authorizationHeaders() }.getOrNull() }
    val ready = headers
    if (ready != null) {
        MediaVideoPlayer(Uri.parse(client.originalURL(item.id)), Modifier.fillMaxSize(), headers = ready)
    } else {
        Spinner(Color.White)
    }
}
