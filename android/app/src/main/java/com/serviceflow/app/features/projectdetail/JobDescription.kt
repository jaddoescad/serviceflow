package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
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
    var editing by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme

    HorizontalDivider(Modifier.padding(start = 16.dp))
    if (text.isEmpty()) {
        Row(
            Modifier.fillMaxWidth().clickable { editing = true }.padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = DetailPalette.brand, modifier = Modifier.size(18.dp))
            Text("Add description", style = appText(14, FontWeight.SemiBold, DetailPalette.brand))
        }
    } else {
        Column(
            Modifier.fillMaxWidth().clickable(enabled = canEdit) { editing = true }.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Description", style = appText(12, FontWeight.SemiBold, colors.onSurfaceVariant), modifier = Modifier.weight(1f))
                if (canEdit) Text("Edit", style = appText(12, FontWeight.SemiBold, DetailPalette.brand))
            }
            Text(text, style = appText(14, color = colors.onSurface))
        }
    }
    if (editing) JobDescriptionSheet(model, onClose = { editing = false })
}

/** Writing the description; Save keeps it on the job for everyone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JobDescriptionSheet(model: ProjectDetailModel, onClose: () -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(model.description.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val savingNow by rememberUpdatedState(saving)
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { it != SheetValue.Hidden || !savingNow },
    )
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    fun save() {
        if (saving) return
        saving = true
        error = null
        scope.launch {
            try {
                model.saveDescription(session.api, draft)
                sheetState.hide()
                onClose()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                error = e.message?.takeIf { it.isNotEmpty() } ?: "The description could not be saved. Try again."
            }
            saving = false
        }
    }

    ModalBottomSheet(onDismissRequest = onClose, sheetState = sheetState) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose, enabled = !saving) { Text("Cancel") }
            Spacer(Modifier.weight(1f))
            Text("Description", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.weight(1f))
            if (saving) {
                CircularProgressIndicator(Modifier.padding(horizontal = 20.dp).size(20.dp), strokeWidth = 2.dp)
            } else {
                TextButton(onClick = ::save, enabled = draft.trim() != model.description.orEmpty()) { Text("Save") }
            }
        }
        Column(Modifier.navigationBarsPadding().imePadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it.take(5000) },
                placeholder = { Text("Rooms, surfaces, colours, access…") },
                minLines = 5,
                modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp).focusRequester(focus),
            )
            error?.let { Text(it, style = appText(13, color = hex(0xb42318)), modifier = Modifier.padding(top = 8.dp)) }
            Spacer(Modifier.padding(bottom = 8.dp))
        }
    }
}
