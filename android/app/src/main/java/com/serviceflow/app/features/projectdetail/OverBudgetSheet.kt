package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.OverBudgetPromptItem
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.HoursFormat
import kotlinx.coroutines.launch

/**
 * Asks "What slowed it down?" after a clock-out on a job that went over budget.
 * Shown while [item] is set; [onDismiss] clears it.
 */
@Composable
fun OverBudgetPrompt(item: OverBudgetPromptItem?, onDismiss: () -> Unit) {
    if (item == null) return
    key(item.id) { OverBudgetSheet(item, onClose = onDismiss) }
}

private data class Reason(val id: String, val label: String, val icon: ImageVector)

private val reasons = listOf(
    Reason("budget_unrealistic", "The budget was too tight", Icons.Outlined.HourglassEmpty),
    Reason("extra_prep", "Extra prep or repairs", Icons.Outlined.Build),
    Reason("moving_furniture", "Moving furniture or covering", Icons.Outlined.Inventory2),
    Reason("waiting", "Waiting on materials or client", Icons.Outlined.PauseCircle),
    Reason("other", "Something else", Icons.Outlined.ChatBubbleOutline),
)

/** The reasons sheet. Dragging it away counts as Skip. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OverBudgetSheet(item: OverBudgetPromptItem, onClose: () -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var selected by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var answered by remember { mutableStateOf(false) }
    val savingNow by rememberUpdatedState(saving)
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = false,
        confirmValueChange = { it != SheetValue.Hidden || !savingNow },
    )
    val noteFocus = remember { FocusRequester() }
    val warning = hex(0xb56025)
    val canSend = selected != null && !saving && (selected != "other" || note.trim().isNotEmpty())

    fun finish(reason: String?) {
        if (answered) return
        answered = true
        saving = reason != null
        val trimmed = note.trim()
        // The answer is recorded on the session's scope so closing the sheet can't cancel it.
        session.scope.launch {
            session.answerOverBudget(jobId = item.jobId, reason = reason,
                                     note = trimmed.ifEmpty { null }?.take(280), hoursOver = item.hoursOver)
            saving = false
            scope.launch { sheetState.hide() }.invokeOnCompletion { onClose() }
        }
    }

    ModalBottomSheet(
        onDismissRequest = {
            // Swiped away without answering: remember it was asked, like Skip.
            if (!answered) {
                answered = true
                session.scope.launch { session.answerOverBudget(jobId = item.jobId, reason = null, note = null, hoursOver = item.hoursOver) }
            }
            onClose()
        },
        sheetState = sheetState,
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { finish(null) }, enabled = !saving) { Text("Skip") }
            Spacer(Modifier.weight(1f))
            Text("Over budget", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.weight(1f))
            if (saving) {
                CircularProgressIndicator(Modifier.padding(horizontal = 20.dp).size(20.dp), strokeWidth = 2.dp)
            } else {
                TextButton(
                    onClick = { finish(selected) },
                    enabled = canSend,
                    modifier = Modifier.semantics { contentDescription = "Send reason" },
                ) { Text("Send") }
            }
        }
        Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Error, contentDescription = null, tint = warning, modifier = Modifier.size(16.dp))
                    Text(
                        if (item.hoursOver > 0) "${HoursFormat.task(item.hoursOver)} over budget" else "Over budget",
                        style = appText(13, FontWeight.SemiBold, warning),
                    )
                }
                Text("${item.projectName} took longer than planned", style = appText(17, FontWeight.SemiBold, MaterialTheme.colorScheme.onSurface))
                Text(
                    "What slowed it down? This helps us quote the next job better — it is not a performance review.",
                    style = appText(14, color = MaterialTheme.colorScheme.onSurfaceVariant),
                )
            }
            Text(
                "Reason",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 4.dp),
            )
            reasons.forEach { reason ->
                ListItem(
                    headlineContent = { Text(reason.label) },
                    leadingContent = { Icon(reason.icon, contentDescription = null, tint = Palette.teal) },
                    trailingContent = {
                        if (selected == reason.id) Icon(Icons.Filled.Check, contentDescription = null, tint = Palette.teal)
                    },
                    modifier = Modifier.selectable(selected = selected == reason.id, enabled = !saving, role = Role.RadioButton) {
                        selected = if (selected == reason.id) null else reason.id
                    }.padding(horizontal = 8.dp),
                )
            }
            if (selected == "other") {
                LaunchedEffect(Unit) { noteFocus.requestFocus() }
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(280) },
                    label = { Text("What happened") },
                    placeholder = { Text("Tell us what happened…") },
                    enabled = !saving,
                    minLines = 3,
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp).focusRequester(noteFocus),
                )
            }
        }
    }
}
