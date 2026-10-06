package com.serviceflow.app.features.media

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.Spinner
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.MediaItem
import com.serviceflow.core.MediaKind
import com.serviceflow.core.PendingUpload
import java.time.Instant

/** Something shown in a media grid: a capture still uploading, or an uploaded photo or video. */
sealed interface MediaEntry {
    data class Pending(val upload: PendingUpload) : MediaEntry
    data class Remote(val item: MediaItem) : MediaEntry

    val id: String
        get() = when (this) {
            is Pending -> "pending-${upload.localId}"
            is Remote -> item.id
        }

    val kind: MediaKind
        get() = when (this) {
            is Pending -> upload.kind
            is Remote -> item.kind
        }

    val timestamp: Instant?
        get() = when (this) {
            is Pending -> upload.capturedAt
            is Remote -> item.timestamp
        }

    val annotations: AnnotationDocument?
        get() = when (this) {
            is Pending -> upload.annotations
            is Remote -> item.annotations
        }

    val hasDescription: Boolean
        get() = when (this) {
            is Pending -> !(upload.note ?: "").trim().isEmpty()
            is Remote -> item.mediaDescription != null
        }

    val pendingUpload: PendingUpload? get() = (this as? Pending)?.upload

    companion object {
        /** Captures first (queue order), then uploads. */
        fun all(store: MediaStore): List<MediaEntry> = store.pending.map(::Pending) + store.items.map(::Remote)
    }
}

enum class MediaTileStyle {
    /** The small photos card: compact badges. */
    Compact,
    /** The Media tab grid: larger badges and an upload label. */
    Grid,
}

private val BadgeBackground = Color(8, 15, 18).copy(alpha = 0.7f)

/**
 * The square picture of a grid entry: the image with its drawings, a play
 * badge for videos, a note badge when it has a description, and the upload
 * state for captures.
 */
@Composable
fun MediaTileImage(entry: MediaEntry, store: MediaStore, style: MediaTileStyle, modifier: Modifier = Modifier) {
    val session = LocalSession.current
    val side = if (style == MediaTileStyle.Compact) 90.dp else 140.dp
    val placeholder = when {
        entry.kind == MediaKind.Video -> DetailPalette.navy
        style == MediaTileStyle.Compact -> hex(0xdfe6e4)
        else -> DetailPalette.soft
    }
    Box(modifier.aspectRatio(1f).background(placeholder).clipToBounds()) {
        when (entry) {
            is MediaEntry.Pending -> {
                val upload = entry.upload
                val file = if (upload.kind == MediaKind.Video) store.posterURL(upload) else store.fileURL(upload)
                MediaAsyncImage(file, side, Modifier.fillMaxSize(), annotations = upload.annotations)
            }
            is MediaEntry.Remote -> session.mediaClient?.let { client ->
                val item = entry.item
                MediaAsyncImage(
                    client.tileURL(item), side, Modifier.fillMaxSize(),
                    annotations = if (item.kind == MediaKind.Image) item.annotations else null,
                    showsSpinner = style == MediaTileStyle.Grid && item.kind == MediaKind.Image,
                )
            }
        }
        if (entry.kind == MediaKind.Video) PlayBadge(style)
        if (entry.hasDescription) NoteBadge(style, Modifier.align(Alignment.TopEnd))
        entry.pendingUpload?.let { UploadOverlay(it, style) }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.PlayBadge(style: MediaTileStyle) {
    when (style) {
        MediaTileStyle.Compact -> Box(
            Modifier.align(Alignment.BottomStart).padding(4.dp).size(16.dp).background(BadgeBackground, CircleShape),
            contentAlignment = Alignment.Center,
        ) { AppIcon(Icons.Filled.PlayArrow, 11.dp, Color.White) }
        MediaTileStyle.Grid -> Box(
            Modifier.align(Alignment.Center).size(38.dp).background(Color.White.copy(alpha = 0.2f), CircleShape),
            contentAlignment = Alignment.Center,
        ) { AppIcon(Icons.Filled.PlayArrow, 24.dp, Color.White) }
    }
}

@Composable
private fun NoteBadge(style: MediaTileStyle, modifier: Modifier) {
    val compact = style == MediaTileStyle.Compact
    Box(
        modifier.padding(if (compact) 3.dp else 5.dp).size(if (compact) 15.dp else 20.dp).background(BadgeBackground, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        AppIcon(Icons.AutoMirrored.Filled.Notes, if (compact) 9.dp else 12.dp, Color.White, contentDescription = "Has a note")
    }
}

@Composable
private fun UploadOverlay(upload: PendingUpload, style: MediaTileStyle) {
    val failed = upload.status == PendingUpload.Status.Failed
    when (style) {
        MediaTileStyle.Compact -> Box(Modifier.fillMaxSize().background(Color(17, 32, 29).copy(alpha = 0.45f)),
                                      contentAlignment = Alignment.Center) {
            if (failed) AppIcon(Icons.Filled.PriorityHigh, 15.dp, Color.White) else Spinner(Color.White)
        }
        MediaTileStyle.Grid -> Box(
            Modifier.fillMaxSize().background(if (failed) Color(137, 49, 36).copy(alpha = 0.72f) else Color(19, 45, 51).copy(alpha = 0.5f)),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                if (failed) {
                    AppIcon(Icons.Filled.Refresh, 22.dp, Color.White)
                    Text("Tap to retry", style = appText(8.5, FontWeight.Black, Color.White))
                } else {
                    Spinner(Color.White)
                    Text("Uploading", style = appText(8.5, FontWeight.Black, Color.White))
                }
            }
        }
    }
}
