package com.serviceflow.app.features.camera

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.media.MediaAsyncImage
import com.serviceflow.app.features.media.tileURL
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.MediaItem
import com.serviceflow.core.MediaKind
import com.serviceflow.core.PendingUpload
import java.time.Instant

/**
 * A row in the camera drawer: a shot taken in this opening (still on the
 * device until Done), or a photo or video already on the job.
 */
sealed interface CameraDrawerEntry {
    data class Capture(val upload: PendingUpload) : CameraDrawerEntry
    data class Uploaded(val item: MediaItem) : CameraDrawerEntry

    val id: String
        get() = when (this) {
            is Capture -> upload.localId
            is Uploaded -> item.id
        }

    val kind: MediaKind
        get() = when (this) {
            is Capture -> upload.kind
            is Uploaded -> item.kind
        }

    /** The description, shown as the row's note. */
    val note: String
        get() = when (this) {
            is Capture -> upload.note ?: ""
            is Uploaded -> item.mediaDescription ?: ""
        }

    val annotations: AnnotationDocument?
        get() = when (this) {
            is Capture -> upload.annotations
            is Uploaded -> item.annotations
        }

    companion object {
        /**
         * Captures come first, newest first, then the job's photos newest first.
         * A capture that has already uploaded appears once, as the capture.
         */
        fun list(captures: List<PendingUpload>, uploaded: List<MediaItem>): List<CameraDrawerEntry> {
            val capturedIds = captures.mapNotNull { it.remote?.id }.toSet()
            val earlier = uploaded
                .filter { it.id !in capturedIds }
                .sortedByDescending { it.timestamp ?: Instant.MIN }
            return captures.map(::Capture) + earlier.map(::Uploaded)
        }
    }
}

private val thumbnailSide = 64.dp
private val thumbnailShape = RoundedCornerShape(14.dp)

/** A square thumbnail of a drawer entry, with its drawings on top. */
@Composable
fun CameraDrawerThumbnail(entry: CameraDrawerEntry) {
    val session = LocalSession.current
    Box(Modifier.size(thumbnailSide).clip(thumbnailShape).background(hex(0xdfe6e4))) {
        when (entry) {
            is CameraDrawerEntry.Capture -> session.uploads?.let { uploads ->
                val upload = entry.upload
                val file = if (upload.kind == MediaKind.Video) uploads.posterURL(upload) else uploads.fileURL(upload)
                MediaAsyncImage(file, thumbnailSide, Modifier.fillMaxSize(), annotations = upload.annotations)
            }
            is CameraDrawerEntry.Uploaded -> session.mediaClient?.let { client ->
                MediaAsyncImage(client.tileURL(entry.item), thumbnailSide, Modifier.fillMaxSize(), annotations = entry.item.annotations)
            }
        }
        if (entry.kind == MediaKind.Video) {
            Box(
                Modifier.align(Alignment.BottomStart).padding(5.dp).size(20.dp).background(Color(8, 15, 18).copy(alpha = 0.7f), CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(13.dp)) }
        }
    }
}
