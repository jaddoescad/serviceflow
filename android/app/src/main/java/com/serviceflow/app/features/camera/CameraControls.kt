package com.serviceflow.app.features.camera

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.FlashlightOff
import androidx.compose.material.icons.filled.FlashlightOn
import androidx.compose.material.icons.filled.FlipCameraAndroid
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.design.hex
import kotlinx.coroutines.delay
import java.util.Locale

// The camera's controls, drawn over the preview. White icons with a soft
// shadow so they stay readable on bright scenes.

internal val recordRed = hex(0xd92d20)

private val tabularDigits = TextStyle(fontFeatureSettings = "tnum")

@Composable
private fun ShadowedIcon(icon: ImageVector, size: Dp) {
    Box {
        Icon(icon, null, tint = Color.Black.copy(alpha = 0.35f), modifier = Modifier.size(size).blur(4.dp))
        Icon(icon, null, tint = Color.White, modifier = Modifier.size(size))
    }
}

@Composable
fun CameraCloseButton(disabled: Boolean, action: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(48.dp)
            .clickable(enabled = !disabled, role = Role.Button, onClick = action)
            .semantics { contentDescription = "Close camera" },
        contentAlignment = Alignment.Center,
    ) { ShadowedIcon(Icons.Filled.Close, 24.dp) }
}

/** Flip and flash, down the right edge. */
@Composable
fun CameraSideControls(camera: CameraModel, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(22.dp)) {
        SideIcon(Icons.Filled.FlipCameraAndroid, "Flip camera", camera.canFlip && !camera.isRecording, camera::flip)
        SideIcon(flashIcon(camera), if (camera.flashOn) "Turn flash off" else "Turn flash on",
            camera.canUseFlash && !camera.isRecording, camera::toggleFlash)
    }
}

/** Video mode's flash is a torch, so it gets a flashlight icon. */
private fun flashIcon(camera: CameraModel): ImageVector = when (camera.mode) {
    CameraMode.Photo -> if (camera.flashOn) Icons.Filled.FlashOn else Icons.Filled.FlashOff
    CameraMode.Video -> if (camera.flashOn) Icons.Filled.FlashlightOn else Icons.Filled.FlashlightOff
}

@Composable
private fun SideIcon(icon: ImageVector, label: String, enabled: Boolean, action: () -> Unit) {
    Box(
        Modifier
            .size(width = 48.dp, height = 40.dp)
            .alpha(if (enabled) 1f else 0.4f)
            .clickable(enabled = enabled, role = Role.Button, onClick = action)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { ShadowedIcon(icon, 24.dp) }
}

/** `.5x` / `1x` / `2x`, the current one as a white circle. */
@Composable
fun CameraZoomRail(camera: CameraModel, modifier: Modifier = Modifier) {
    val zoom = camera.zoom
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        zoom.availableSteps.reversed().forEach { step ->
            val active = step == zoom.activeStep
            Box(
                Modifier
                    .size(34.dp)
                    .background(if (active) Color.White else Color.Transparent, CircleShape)
                    .clickable(role = Role.Button) { camera.zoom(step) }
                    .semantics {
                        contentDescription = "Zoom ${if (step == 0.5f) "0.5" else step.toInt().toString()}x"
                        selected = active
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    zoom.label(step),
                    style = tabularDigits.copy(
                        fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (active) Color.Black else Color.White,
                        shadow = if (active) null else Shadow(Color.Black.copy(alpha = 0.4f), Offset.Zero, 6f),
                    ),
                )
            }
        }
    }
}

/** Red timer while recording, then "Saving…" while the file is written. */
@Composable
fun CameraRecordingPill(camera: CameraModel, modifier: Modifier = Modifier) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val started = camera.recordingStartedAt
    val seconds = minOf(started?.let { ((now - it.toEpochMilli()) / 1000).toInt().coerceAtLeast(0) } ?: 0,
        CameraModel.MAX_VIDEO_SECONDS)
    Row(
        modifier
            .background(recordRed, CircleShape)
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .semantics { contentDescription = "Recording" },
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val style = tabularDigits.copy(fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White)
        if (camera.isFinalizing) {
            CircularProgressIndicator(Modifier.size(12.dp), color = Color.White, strokeWidth = 2.dp)
            Text("Saving…", style = style)
        } else {
            Box(Modifier.size(8.dp).background(Color.White, CircleShape))
            Text(String.format(Locale.US, "%02d:%02d", seconds / 60, seconds % 60), style = style)
        }
    }
}

/** The shutter with the white Done pill to its right. */
@Composable
fun CameraShutterRow(camera: CameraModel, closing: Boolean, onShutter: () -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        CameraShutter(
            mode = camera.mode,
            recording = camera.isRecording,
            enabled = camera.canShoot || camera.isRecording,
            onClick = onShutter,
        )
        val doneInteraction = remember { MutableInteractionSource() }
        val donePressed by doneInteraction.collectIsPressedAsState()
        Box(
            Modifier
                .offset(x = 119.dp)
                .alpha(if (camera.isRecording) 0f else if (donePressed) 0.8f else 1f)
                .size(width = 74.dp, height = 46.dp)
                .background(Color.White, CircleShape)
                .clickable(
                    interactionSource = doneInteraction, indication = null,
                    enabled = !closing && !camera.isRecording, role = Role.Button, onClick = onDone,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text("Done", style = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Color.Black))
        }
    }
}

/** White ring: a white disc for photos, a red disc for video, a red square while recording. */
@Composable
private fun CameraShutter(mode: CameraMode, recording: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val disc by animateDpAsState(if (pressed && !recording) 60.dp else 66.dp, tween(100), label = "disc")
    val square by animateFloatAsState(if (recording) 1f else 0f, spring(dampingRatio = 0.8f, stiffness = 600f), label = "square")
    val label = when {
        recording -> "Stop recording"
        mode == CameraMode.Video -> "Record video"
        else -> "Take photo"
    }
    Box(
        Modifier
            .size(84.dp)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(CameraLayout.SHUTTER_DIAMETER).border(4.dp, Color.White, CircleShape))
        // Morphs from the disc to the rounded square while recording.
        val side = disc + (30.dp - disc) * square
        val corner = side / 2 + (8.dp - side / 2) * square
        val fill = if (mode == CameraMode.Photo && !recording) Color.White else recordRed
        Box(Modifier.size(side).background(fill, RoundedCornerShape(corner)))
    }
}

/** Photo / Video. The labels slide so the selected one sits under the shutter. */
@Composable
fun CameraModeSwitcher(camera: CameraModel, modifier: Modifier = Modifier) {
    val labelWidth = 92.dp
    val shift by animateDpAsState(
        if (camera.mode == CameraMode.Photo) labelWidth / 2 else -labelWidth / 2,
        spring(dampingRatio = 0.88f, stiffness = 450f), label = "mode",
    )
    Box(modifier.alpha(if (camera.isRecording) 0f else 1f), contentAlignment = Alignment.Center) {
        Row(Modifier.offset(x = shift)) {
            ModeLabel("Photo", CameraMode.Photo, camera, labelWidth)
            ModeLabel("Video", CameraMode.Video, camera, labelWidth)
        }
    }
}

@Composable
private fun ModeLabel(title: String, mode: CameraMode, camera: CameraModel, width: Dp) {
    val selected = camera.mode == mode
    Box(
        Modifier
            .width(width)
            .height(34.dp)
            .clickable(
                interactionSource = remember { MutableInteractionSource() }, indication = null,
                enabled = !camera.isRecording, role = Role.Button,
            ) { camera.select(mode) }
            .semantics {
                contentDescription = "$title mode"
                this.selected = selected
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .height(34.dp)
                .background(if (selected) Color.White else Color.Transparent, CircleShape)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(title, style = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = if (selected) Color.Black else Color.White))
        }
    }
}

/** The red banner for camera problems; "More" reveals technical details. */
@Composable
fun CameraNoticeBanner(notice: CameraNotice, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    var expanded by remember(notice.id) { mutableStateOf(false) }
    val expandable = notice.details != null || notice.message.length > 80
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 64.dp)
            .background(hex(0xa03024, 0.92f), RoundedCornerShape(12.dp))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(Icons.Filled.Error, null, tint = Color.White, modifier = Modifier.size(17.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                notice.message,
                style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Color.White),
                maxLines = if (expanded) Int.MAX_VALUE else 2,
            )
            if (expanded && notice.details != null) {
                SelectionContainer {
                    Text(notice.details, style = TextStyle(fontSize = 11.sp, color = Color.White.copy(alpha = 0.76f)))
                }
            }
        }
        if (expandable) {
            Text(
                if (expanded) "Less" else "More",
                style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White),
                modifier = Modifier.clickable(role = Role.Button) { expanded = !expanded },
            )
        }
    }
}
