package com.serviceflow.app.features.media

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.serviceflow.app.CameraRequest
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.Spinner
import com.serviceflow.app.design.UploadCopy
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.bordered
import com.serviceflow.app.design.hex
import com.serviceflow.core.PendingUpload
import com.serviceflow.core.Project

/** Thumbnails always take one of four equal slots, however many there are. */
private const val SLOTS = 4

private val Navy = hex(0x31495d)
private val Ink = hex(0x11201d)
private val Muted = hex(0x6d7f7b)
private val Danger = hex(0xa5321f)

/**
 * The "Photos" card on the active clock-in screen and in Project Detail's
 * Clock Ins tab: a count, the newest shots as small thumbnails, upload
 * progress and, on the clock-in screen, a button that opens the camera.
 */
@Composable
fun JobPhotosPanel(project: Project, showCamera: Boolean, onOpenAll: () -> Unit) {
    val session = LocalSession.current
    val store = rememberMediaStore(project, includeLinkedLead = false)
    LaunchedEffect(store) { store.load() }

    val entries = MediaEntry.all(store)
    val loading = store.isLoading || !store.hasLoaded

    Column(Modifier.fillMaxWidth().bordered(14.dp, border = hex(0xe4eae8)).padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 14.dp)) {
        Header(count = entries.size, loading = loading, onOpenAll = onOpenAll)
        if (entries.isNotEmpty()) {
            Thumbnails(entries, store, onOpenAll, Modifier.padding(top = 12.dp))
        } else {
            Text(if (loading) "Loading photos…" else "No photos on this job yet.",
                 style = appText(12.5, FontWeight.SemiBold, Muted), modifier = Modifier.padding(top = 10.dp))
        }
        UploadStatus(store)
        if (showCamera) {
            val enabled = project.id.isNotEmpty()
            Row(
                Modifier
                    .padding(top = 12.dp)
                    .fillMaxWidth()
                    .heightIn(min = 46.dp)
                    .alpha(if (enabled) 1f else 0.5f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Navy)
                    .clickable(enabled = enabled, role = Role.Button) {
                        session.navigator.openCamera(CameraRequest(project.name, project.id, project.kind, onClose = {}))
                    }
                    .clearAndSetSemantics {
                        contentDescription = "Take a photo or video for this job"
                        role = Role.Button
                    },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AppIcon(Icons.Filled.PhotoCamera, 19.dp, Color.White)
                Spacer(Modifier.width(8.dp))
                Text("Take Photo or Video", style = appText(14, FontWeight.Black, Color.White, tracking = 0.2))
            }
        }
    }
}

@Composable
private fun Header(count: Int, loading: Boolean, onOpenAll: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpenAll)
            .clearAndSetSemantics { contentDescription = "Open job photos" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AppIcon(Icons.Outlined.PhotoLibrary, 17.dp, Navy)
        Text("Photos", style = appText(14, FontWeight.Black, Ink), modifier = Modifier.weight(1f))
        if (loading && count == 0) {
            Spinner(Muted)
        } else {
            Text("$count", style = appText(13, FontWeight.ExtraBold, Muted))
        }
        AppIcon(Icons.AutoMirrored.Filled.KeyboardArrowRight, 18.dp, Muted)
    }
}

/** Up to four thumbnails; when there are more, the last slot shows "+N". */
@Composable
private fun Thumbnails(entries: List<MediaEntry>, store: MediaStore, onOpenAll: () -> Unit, modifier: Modifier) {
    val overflow = entries.size > SLOTS
    val shown = entries.take(if (overflow) SLOTS - 1 else SLOTS)
    val shape = RoundedCornerShape(9.dp)
    Row(
        modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpenAll)
            .clearAndSetSemantics { contentDescription = "View all ${entries.size} photos and videos" },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (slot in 0 until SLOTS) {
            val slotModifier = Modifier.weight(1f).aspectRatio(1f).clip(shape)
            val entry = shown.getOrNull(slot)
            when {
                entry != null -> MediaTileImage(entry, store, MediaTileStyle.Compact, slotModifier)
                overflow && slot == SLOTS - 1 -> Box(slotModifier.background(hex(0xeef2f1)), contentAlignment = Alignment.Center) {
                    Text("+${entries.size - shown.size}", style = appText(14, FontWeight.Black, Navy))
                }
                else -> Spacer(slotModifier)
            }
        }
    }
}

@Composable
private fun UploadStatus(store: MediaStore) {
    val counts = store.pendingCounts
    if (counts.active > 0) {
        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Spinner(Muted)
            Text(UploadCopy.uploading(counts.active), style = appText(12.5, FontWeight.Bold, Muted))
        }
    }
    if (counts.failed > 0) {
        val reason = store.pending.firstOrNull { it.status == PendingUpload.Status.Failed }?.error
        Row(
            Modifier
                .padding(top = 10.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(hex(0xfdecea))
                .clickable(role = Role.Button) { store.retryAllFailed() }
                .clearAndSetSemantics { contentDescription = "Retry failed uploads" }
                .padding(horizontal = 10.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AppIcon(Icons.Filled.Error, 15.dp, Danger)
            Text(UploadCopy.failed(counts.failed, reason), style = appText(12, FontWeight.Bold, Danger), maxLines = 2,
                 modifier = Modifier.weight(1f))
        }
    }
}
