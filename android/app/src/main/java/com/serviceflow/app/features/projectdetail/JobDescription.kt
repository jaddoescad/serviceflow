package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.RichText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The job's description under its name: what the work is, for the crew and
 * contractors. Managers add and edit it; everyone else reads it.
 */
@Composable
fun JobDescriptionRow(model: ProjectDetailModel) {
    val session = LocalSession.current
    val text = model.description ?: return
    val canEdit = session.isManager
    if (text.isEmpty() && !canEdit) return
    val colors = MaterialTheme.colorScheme
    val edit = { session.navigator.push { onBack -> JobDescriptionEditor(model, onBack) } }

    HorizontalDivider(Modifier.padding(start = 16.dp))
    if (text.isEmpty()) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = edit).padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = DetailPalette.brand, modifier = Modifier.size(18.dp))
            Text("Add description", style = appText(14, FontWeight.SemiBold, DetailPalette.brand))
        }
    } else {
        Column(
            Modifier.fillMaxWidth().clickable(enabled = canEdit, onClick = edit).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Description", style = appText(12, FontWeight.SemiBold, colors.onSurfaceVariant), modifier = Modifier.weight(1f))
                if (canEdit) Text("Edit", style = appText(12, FontWeight.SemiBold, DetailPalette.brand))
            }
            RichTextView(text)
        }
    }
}

/** Writing the description on its own screen, with bold, italic, links and lists; Save keeps it on the job for everyone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JobDescriptionEditor(model: ProjectDetailModel, onBack: () -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val editor = remember { RichTextEditorState() }
    // Plain descriptions can read back slightly differently ("1)" as "1."); that alone isn't a change.
    val original = remember { RichTextEditorState.markdown(RichTextEditorState.spanned(model.description.orEmpty())) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var linking by remember { mutableStateOf<String?>(null) }

    fun close() {
        editor.hideKeyboard()
        onBack()
    }

    fun save() {
        if (saving) return
        saving = true
        error = null
        scope.launch {
            try {
                model.saveDescription(session.api, editor.markdown)
                close()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                error = e.message?.takeIf { it.isNotEmpty() } ?: "The description could not be saved. Try again."
            }
            saving = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Description") },
                navigationIcon = {
                    IconButton(onClick = ::close, enabled = !saving) { Icon(Icons.Filled.Close, contentDescription = "Cancel") }
                },
                actions = {
                    if (saving) {
                        CircularProgressIndicator(Modifier.padding(horizontal = 20.dp).size(20.dp), strokeWidth = 2.dp)
                    } else {
                        TextButton(onClick = ::save, enabled = editor.markdown != original) { Text("Save") }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
            AndroidView(
                factory = { context ->
                    editor.create(context, model.description.orEmpty(), colors.onSurface.toArgb(), colors.onSurfaceVariant.toArgb())
                },
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
            )
            error?.let { Text(it, style = appText(13, color = hex(0xb42318)), modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
            HorizontalDivider()
            RichTextFormatBar(editor, onLink = { linking = editor.link.orEmpty() })
        }
    }

    linking?.let { typed ->
        val existing = editor.link != null
        AlertDialog(
            onDismissRequest = { linking = null },
            title = { Text("Link") },
            text = {
                OutlinedTextField(
                    value = typed,
                    onValueChange = { linking = it },
                    placeholder = { Text("example.com") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        RichText.linkAddress(typed)?.let { editor.setLink(it, label = typed.trim()) }
                        linking = null
                    },
                    enabled = RichText.linkAddress(typed) != null,
                ) { Text(if (existing) "Save" else "Add") }
            },
            dismissButton = {
                Row {
                    if (existing) {
                        TextButton(onClick = {
                            editor.setLink(null, label = "")
                            linking = null
                        }) { Text("Remove link") }
                    }
                    TextButton(onClick = { linking = null }) { Text("Cancel") }
                }
            },
        )
    }
}
