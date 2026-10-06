package com.serviceflow.app.features.camera

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.features.media.MediaImageLoader
import com.serviceflow.app.features.photoeditor.PhotoEditorScreen
import com.serviceflow.core.AnnotationDocument
import kotlinx.coroutines.flow.MutableStateFlow

/** Big enough to draw on precisely; drawings are stored as fractions, so the exact size doesn't matter. */
private const val EDIT_PIXELS = 2400

/**
 * Opens the photo editor on a capture that hasn't uploaded yet. The photo
 * itself never changes: drawings and the description are saved with the
 * capture and sent after it uploads, the same data the web admin edits.
 */
@Composable
fun CameraPhotoEditorHost(localId: String, onDone: () -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    val uploads = session.uploads
    val items by (uploads?.items ?: remember { MutableStateFlow(emptyList()) }).collectAsState()
    // The capture as the queue has it now (the note may have just changed).
    val item = items.firstOrNull { it.localId == localId }
    var image by remember { mutableStateOf<Bitmap?>(null) }
    var loadFailed by remember { mutableStateOf(false) }

    LaunchedEffect(localId) {
        val current = item
        if (uploads == null || current == null) {
            loadFailed = true
            return@LaunchedEffect
        }
        // Decoded off the main thread, upright.
        image = MediaImageLoader.image(context, uploads.fileURL(current), EDIT_PIXELS, null)
        loadFailed = image == null
    }

    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        val loaded = image
        when {
            loaded != null && item != null -> PhotoEditorScreen(
                image = loaded,
                annotations = item.annotations ?: AnnotationDocument(),
                description = item.note ?: "",
                onSave = { annotations, description ->
                    uploads?.setAnnotations(localId, annotations)
                    uploads?.setNote(localId, description)
                    onDone()
                },
                onCancel = onDone,
            )
            loadFailed -> {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("This photo couldn't be opened.", color = Color.White)
                    Button(onClick = onDone, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)) {
                        Text("Close")
                    }
                }
            }
            else -> CircularProgressIndicator(color = Color.White)
        }
    }
}
