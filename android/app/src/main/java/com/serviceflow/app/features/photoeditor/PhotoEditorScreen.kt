package com.serviceflow.app.features.photoeditor

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.core.AnnotationDocument

/**
 * Marks up a photo, CompanyCam style: drawing tools down the right edge,
 * undo, redo and Clear All at the top, a description and Save at the bottom.
 *
 * The photo is never changed. Save returns the drawings (the web admin's
 * annotation format) and the description, so both stay editable anywhere.
 * Show it full screen; it pads itself for the system bars and keyboard and
 * handles Back (asking before discarding changes).
 */
@Composable
fun PhotoEditorScreen(
    image: Bitmap,
    annotations: AnnotationDocument,
    description: String,
    onSave: (AnnotationDocument, String) -> Unit,
    onCancel: () -> Unit,
) {
    val model = remember(image) { PhotoEditorModel(image, annotations, description) }
    var confirmDiscard by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    fun back() {
        focusManager.clearFocus()
        model.commitText()
        if (model.hasChanges) confirmDiscard = true else onCancel()
    }

    fun save() {
        focusManager.clearFocus()
        model.commitText()
        val (document, text) = model.result
        onSave(document, text)
    }

    BackHandler { back() }

    Column(Modifier.fillMaxSize().background(Color.Black).windowInsetsPadding(WindowInsets.safeDrawing)) {
        TopBar(model, onBack = ::back)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            PhotoEditorCanvas(model, onTouch = { focusManager.clearFocus() }, modifier = Modifier.fillMaxSize())
            PhotoEditorToolbar(model, Modifier.align(Alignment.TopEnd).padding(end = 8.dp, top = 4.dp))
        }
        BottomBar(model, onSave = ::save, onFinishText = {
            focusManager.clearFocus()
            model.commitText()
        })
    }

    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { confirmDiscard = false },
            title = { Text("Discard your changes?") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDiscard = false
                    onCancel()
                }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                    Text("Discard Changes")
                }
            },
            dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text("Keep Editing") } },
        )
    }
}

@Composable
private fun TopBar(model: PhotoEditorModel, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        IconButton(onClick = onBack, colors = IconButtonDefaults.iconButtonColors(contentColor = Color.White)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
        }
        Spacer(Modifier.weight(1f))
        TopButton("Undo", Icons.AutoMirrored.Filled.Undo, model.canUndo, model::undo)
        TopButton("Redo", Icons.AutoMirrored.Filled.Redo, model.canRedo, model::redo)
        TopButton("Clear All", Icons.Filled.Replay, model.shapes.isNotEmpty(), model::clearAll)
    }
}

@Composable
private fun TopButton(title: String, icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.widthIn(min = 44.dp).alpha(if (enabled) 1f else 0.4f)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
        Text(title, color = Color.White, fontSize = 12.sp)
    }
}

@Composable
private fun BottomBar(model: PhotoEditorModel, onSave: () -> Unit, onFinishText: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Color.Black), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        val draft = model.textDraft
        if (draft != null) {
            // Text on the photo is typed here, where the keyboard can't hide
            // it; the photo shows it live.
            val focus = remember { FocusRequester() }
            Row(Modifier.padding(start = 20.dp, end = 12.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.TextFields, contentDescription = null, tint = Color.White.copy(alpha = 0.8f))
                DarkField(
                    value = draft.text, onValue = { model.textDraft = draft.copy(text = it) },
                    placeholder = "Type text for the photo", modifier = Modifier.weight(1f).focusRequester(focus),
                    imeAction = ImeAction.Done, onDone = onFinishText,
                )
                TextButton(onClick = onFinishText, colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFF4DA3FF))) {
                    Text("Done", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                }
            }
            LaunchedEffect(Unit) { focus.requestFocus() }
        } else {
            Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Filled.Notes, contentDescription = null, tint = Color.White.copy(alpha = 0.8f))
                DarkField(
                    value = model.description, onValue = { model.description = it },
                    placeholder = "Add a description…", modifier = Modifier.weight(1f),
                )
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.End) {
            Button(
                onClick = onSave,
                modifier = Modifier.size(width = 124.dp, height = 50.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0A66D6), contentColor = Color.White),
            ) {
                Text("Save", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            }
        }
    }
}

/** A borderless multi-line field, white on black. */
@Composable
private fun DarkField(
    value: String, onValue: (String) -> Unit, placeholder: String, modifier: Modifier,
    imeAction: ImeAction = ImeAction.Default, onDone: () -> Unit = {},
) {
    TextField(
        value = value,
        onValueChange = onValue,
        modifier = modifier,
        placeholder = { Text(placeholder) },
        maxLines = 4,
        keyboardOptions = KeyboardOptions(imeAction = imeAction),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            focusedTextColor = Color.White, unfocusedTextColor = Color.White, cursorColor = Color.White,
            focusedPlaceholderColor = Color.White.copy(alpha = 0.5f), unfocusedPlaceholderColor = Color.White.copy(alpha = 0.5f),
        ),
    )
}
