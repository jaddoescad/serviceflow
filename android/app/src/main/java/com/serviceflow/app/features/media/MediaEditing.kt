package com.serviceflow.app.features.media

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.features.photoeditor.PhotoEditorScreen
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.MediaItem
import kotlinx.coroutines.launch

/** Why an edit didn't save. */
data class EditAlert(
    val title: String,
    val message: String,
    /** After a conflict the editor closes so the reloaded photo can be reopened. */
    val closesEditor: Boolean,
) {
    companion object {
        val conflict = EditAlert(
            title = "Photo changed",
            message = "This photo was changed on another device. It's been reloaded — try again.",
            closesEditor = true,
        )

        fun failed(message: String) = EditAlert(title = "Couldn't save", message = message, closesEditor = false)

        fun from(outcome: MediaStore.EditOutcome): EditAlert? = when (outcome) {
            MediaStore.EditOutcome.Saved -> null
            MediaStore.EditOutcome.Conflict -> conflict
            is MediaStore.EditOutcome.Failed -> failed(outcome.message)
        }
    }
}

@Composable
private fun EditAlertDialog(alert: EditAlert, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(alert.title) },
        text = { Text(alert.message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
    )
}

/** Big enough to draw on precisely; drawings are stored as fractions, so the exact size doesn't matter. */
private const val EDIT_PIXELS = 2400

/**
 * Opens an uploaded photo in the photo editor, full screen. The editor works
 * on the original; only the drawings and description are saved, exactly as
 * the web admin does, so the photo itself never changes.
 */
@Composable
fun MediaPhotoEditFlow(item: MediaItem, store: MediaStore, onDone: () -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var original by remember { mutableStateOf<Bitmap?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var saving by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf<EditAlert?>(null) }

    LaunchedEffect(attempt) {
        val client = session.mediaClient
        if (original != null || client == null) {
            loadFailed = client == null
            return@LaunchedEffect
        }
        original = MediaImageLoader.image(context, client.originalURL(item.id), EDIT_PIXELS, client)
        loadFailed = original == null
    }

    fun save(annotations: AnnotationDocument, description: String) {
        val changedDrawings = annotations.sanitized() != (item.annotations ?: AnnotationDocument()).sanitized()
        val changedDescription = description.trim() != (item.mediaDescription ?: "")
        if (!changedDrawings && !changedDescription) {
            onDone()
            return
        }
        saving = true
        scope.launch {
            val outcome = store.saveEdits(item, description = if (changedDescription) description else null,
                                          annotations = if (changedDrawings) annotations else null)
            saving = false
            val failure = EditAlert.from(outcome)
            if (failure == null) onDone() else alert = failure
        }
    }

    MediaFullScreenDialog(onDismissRequest = { if (!saving) onDone() }) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            val image = original
            when {
                image != null -> PhotoEditorScreen(
                    image = image,
                    annotations = item.annotations ?: AnnotationDocument(),
                    description = item.mediaDescription ?: "",
                    onSave = ::save,
                    onCancel = onDone,
                )
                loadFailed -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("This photo couldn't be loaded.", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = onDone, colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)) {
                            Text("Cancel")
                        }
                        Button(onClick = {
                            loadFailed = false
                            attempt += 1
                        }) { Text("Try Again") }
                    }
                }
                else -> CircularProgressIndicator(color = Color.White)
            }
            if (saving) {
                // Blocks the editor while saving.
                Box(
                    Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f))
                        .clickable(interactionSource = null, indication = null) {},
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator(color = Color.White, modifier = Modifier.size(44.dp)) }
            }
        }
        alert?.let { shown ->
            EditAlertDialog(shown) {
                alert = null
                if (shown.closesEditor) onDone()
            }
        }
    }
}

/** Edits a video's description. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaDescriptionEditor(item: MediaItem, store: MediaStore, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf(item.mediaDescription ?: "") }
    var saving by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf<EditAlert?>(null) }
    val isSaving by rememberUpdatedState(saving)
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true,
                                              confirmValueChange = { it != SheetValue.Hidden || !isSaving })
    val changed = text.trim() != (item.mediaDescription ?: "")

    fun dismiss() {
        scope.launch { sheet.hide() }.invokeOnCompletion { onDone() }
    }

    fun save() {
        saving = true
        scope.launch {
            val outcome = store.saveEdits(item, description = text, annotations = null)
            saving = false
            val failure = EditAlert.from(outcome)
            if (failure == null) dismiss() else alert = failure
        }
    }

    ModalBottomSheet(onDismissRequest = onDone, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = ::dismiss, enabled = !saving) { Text("Cancel") }
                Text("Description", modifier = Modifier.weight(1f), textAlign = TextAlign.Center,
                     style = MaterialTheme.typography.titleMedium)
                Box(Modifier.size(width = 72.dp, height = 40.dp), contentAlignment = Alignment.Center) {
                    if (saving) {
                        CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                    } else {
                        TextButton(onClick = ::save, enabled = changed) { Text("Save", fontWeight = FontWeight.SemiBold) }
                    }
                }
            }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("Add a description…") },
                minLines = 3,
                maxLines = 10,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
        }
        alert?.let { shown ->
            EditAlertDialog(shown) {
                alert = null
                if (shown.closesEditor) dismiss()
            }
        }
    }
}
