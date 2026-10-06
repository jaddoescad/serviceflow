package com.serviceflow.app.features.camera

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.media.MediaAsyncImage
import com.serviceflow.app.features.media.mediaSwipeToDismiss
import com.serviceflow.core.MediaKind
import com.serviceflow.core.PendingUpload
import java.io.File

/** A capture opened full screen inside the camera. Its status is a snapshot taken when it opened. */
data class CameraViewerItem(val upload: PendingUpload, val file: File?) {
    val id: String get() = upload.localId

    val statusText: String
        get() = when (upload.status) {
            PendingUpload.Status.Uploading -> "Uploading"
            PendingUpload.Status.Uploaded -> "Uploaded"
            PendingUpload.Status.Failed -> "Upload failed, tap to retry"
            PendingUpload.Status.Queued -> when {
                upload.isHeld -> "Uploads when you tap Done"
                upload.attempts > 0 -> "Retrying upload"
                else -> "Waiting to upload"
            }
        }
}

@Composable
fun CameraCaptureViewer(item: CameraViewerItem, safeTop: Dp, safeBottom: Dp, onRetry: (String) -> Unit, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    Box(
        Modifier
            .fillMaxSize()
            .background(hex(0x05080a))
            // Swallows touches so the camera underneath doesn't get them.
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
    ) {
        Box(Modifier.fillMaxSize().padding(top = maxOf(safeTop, 14.dp)).mediaSwipeToDismiss(onDismiss = onClose)) {
            val file = item.file
            if (file != null) {
                if (item.upload.kind == MediaKind.Video) {
                    CameraLoopingVideo(file, Modifier.fillMaxSize())
                } else {
                    MediaAsyncImage(file, 1400.dp, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                }
            }
        }

        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color(4, 8, 10).copy(alpha = 0.5f))
                    .padding(start = 14.dp, end = 14.dp, top = maxOf(safeTop, 14.dp), bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Pressed(onClose, "Close preview") {
                    Box(
                        Modifier
                            .size(44.dp)
                            .background(Color(18, 26, 30).copy(alpha = 0.72f), CircleShape)
                            .border(1.dp, Color.White.copy(alpha = 0.22f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Close, null, tint = Color.White, modifier = Modifier.size(24.dp)) }
                }
                Text(
                    item.statusText,
                    style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White.copy(alpha = 0.82f)),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(Modifier.weight(1f))

            if (item.upload.status == PendingUpload.Status.Failed) {
                Pressed(
                    onClick = {
                        onRetry(item.upload.localId)
                        onClose()
                    },
                    label = "Retry upload",
                    modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = maxOf(safeBottom, 16.dp) + 16.dp),
                ) {
                    Row(
                        Modifier
                            .heightIn(min = 44.dp)
                            .background(hex(0x58c7d6), CircleShape)
                            .padding(horizontal = 18.dp),
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Refresh, null, tint = hex(0x0b2025), modifier = Modifier.size(18.dp))
                        Text("Retry upload", style = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Black, color = hex(0x0b2025)))
                    }
                }
            }
        }
    }
}

@Composable
private fun Pressed(onClick: () -> Unit, label: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        modifier
            .alpha(if (pressed) 0.7f else 1f)
            .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
    ) { content() }
}

/** A local video that autoplays and loops, with the system controls. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun CameraLoopingVideo(file: File, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val player = remember(file) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
            repeatMode = Player.REPEAT_MODE_ONE
            playWhenReady = true
            prepare()
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(
        factory = { viewContext ->
            PlayerView(viewContext).apply {
                useController = true
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
            }
        },
        update = { view -> if (view.player !== player) view.player = player },
        modifier = modifier,
    )
}
