package com.serviceflow.app.features.camera

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Gesture
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.design.hex
import com.serviceflow.core.MediaKind
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val ink = hex(0x11201d)
private val fieldBorder = hex(0xe1e4e3)
private val fieldShape = RoundedCornerShape(18.dp)

/**
 * One drawer row: thumbnail, note field with dictation, and the markup
 * button. The note is the photo's description; the photo editor edits the
 * same value.
 */
@Composable
fun CameraCaptureRow(
    entry: CameraDrawerEntry,
    dictation: CameraDictation,
    /** The person may change this photo (their own, or they're a manager). */
    canEdit: Boolean,
    onEdit: () -> Unit,
    onView: () -> Unit,
    /** Stores a changed note. */
    onNote: (String) -> Unit,
    onDictationBegin: () -> Unit,
    onDictationEnd: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    var note by remember(entry.id) { mutableStateOf(entry.note) }
    var focused by remember { mutableStateOf(false) }
    var saveJob by remember { mutableStateOf<Job?>(null) }
    val currentEntry by rememberUpdatedState(entry)
    val currentOnNote by rememberUpdatedState(onNote)
    val isPhoto = entry.kind == MediaKind.Image
    val isDictating = dictation.activeId == entry.id
    // A shot still on the device saves as you type; a photo already on the
    // job saves once you're done, so each edit is a single server save.
    val savesWhileTyping = entry is CameraDrawerEntry.Capture

    fun saveNow() {
        saveJob?.cancel()
        if (note != currentEntry.note) currentOnNote(note)
    }

    /** Typing saves after a short pause rather than on every keystroke. */
    fun saveSoon(value: String) {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(600)
            currentOnNote(value)
        }
    }

    /** Saves what's typed first, so the editor opens with the latest note. */
    fun edit() {
        focusManager.clearFocus()
        saveNow()
        onEdit()
    }

    fun toggleDictation() {
        if (isDictating) return dictation.stop()
        focusManager.clearFocus()
        dictation.start(
            id = entry.id, prefix = note,
            onText = { note = it },
            onBegin = onDictationBegin,
            onEnd = {
                saveNow()
                onDictationEnd()
            },
        )
    }

    // The editor may have changed the description; follow it unless the
    // person is typing or dictating here.
    LaunchedEffect(entry.note) {
        if (!focused && !isDictating && entry.note != note) note = entry.note
    }
    DisposableEffect(entry.id) { onDispose { saveNow() } }

    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Pressable(
            onClick = { if (isPhoto && canEdit) edit() else onView() },
            label = if (isPhoto) (if (canEdit) "Edit photo" else "View photo") else "Play video",
        ) { CameraDrawerThumbnail(entry) }

        Row(
            Modifier
                .weight(1f)
                .heightIn(min = 54.dp)
                .background(Color.White, fieldShape)
                .border(1.dp, fieldBorder, fieldShape)
                .alpha(if (canEdit) 1f else 0.6f)
                .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val textStyle = TextStyle(fontSize = 17.sp, color = ink)
            BasicTextField(
                value = note,
                onValueChange = { value ->
                    note = value
                    if (savesWhileTyping) saveSoon(value)
                },
                enabled = canEdit,
                textStyle = textStyle,
                maxLines = 4,
                cursorBrush = SolidColor(ink),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                modifier = Modifier
                    .weight(1f)
                    .onFocusChanged { state ->
                        if (focused && !state.isFocused) saveNow()
                        focused = state.isFocused
                    },
                decorationBox = { field ->
                    Box {
                        if (note.isEmpty()) Text("Add notes…", style = textStyle.copy(color = hex(0x9aa5a2)))
                        field()
                    }
                },
            )
            MicButton(isDictating, enabled = canEdit, onClick = ::toggleDictation)
        }

        if (isPhoto && canEdit) {
            Pressable(onClick = ::edit, label = "Mark up photo") {
                Box(
                    Modifier.size(54.dp).background(Color.White, fieldShape).border(1.dp, fieldBorder, fieldShape),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Gesture, null, tint = ink, modifier = Modifier.size(24.dp)) }
            }
        }
    }
}

@Composable
private fun MicButton(isDictating: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val pulse = if (isDictating) {
        val transition = rememberInfiniteTransition(label = "dictation")
        transition.animateFloat(1f, 0.35f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "pulse").value
    } else {
        1f
    }
    Box(
        Modifier
            .size(36.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = if (isDictating) "Stop dictation" else "Dictate a note" },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (isDictating) Icons.Filled.Mic else Icons.Outlined.Mic, null,
            tint = if (isDictating) recordRed else ink,
            modifier = Modifier.size(24.dp).alpha(pulse),
        )
    }
}

/** Dims while pressed, like the iOS `.pressable` style. */
@Composable
private fun Pressable(onClick: () -> Unit, label: String, content: @Composable () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .alpha(if (pressed) 0.8f else 1f)
            .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
    ) { content() }
}
