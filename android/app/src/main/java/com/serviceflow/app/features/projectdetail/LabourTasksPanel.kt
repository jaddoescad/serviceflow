package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.serviceflow.app.LocalSession
import com.serviceflow.app.backend.stopWatching
import com.serviceflow.app.backend.watchTasks
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.jobs.BudgetBurnMeter
import com.serviceflow.app.features.jobs.ContentUnavailable
import com.serviceflow.core.HoursFormat
import com.serviceflow.core.LabourPlan
import com.serviceflow.core.LabourTask
import com.serviceflow.core.Project
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/** The job's task checklist (Project Detail and the Clock In screen). */
@Composable
fun LabourTasksPanel(project: Project, showHoursMeter: Boolean, enabled: Boolean, modifier: Modifier = Modifier) {
    val session = LocalSession.current
    val model = viewModel(key = "labour-tasks:${project.id}") { LabourTasksModel(project.id) }
    val scope = rememberCoroutineScope()
    val active = enabled && !project.isLead && project.id.isNotEmpty()

    LaunchedEffect(active) {
        if (!active) return@LaunchedEffect
        model.start(session, includeBudget = showHoursMeter)
        model.refresh(silent = false)
        // Realtime changes refresh right away; the 30 s poll covers a dropped connection.
        val channel = session.api.watchTasks(project.id, this) { model.scheduleRefresh() }
        try {
            while (true) {
                delay(30_000)
                model.refresh(silent = true)
            }
        } finally {
            withContext(NonCancellable) { session.api.stopWatching(channel) }
        }
    }
    OnAppForeground {
        if (active) scope.launch { model.refresh(silent = true) }
    }

    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = Color.White) {
        Box(Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 6.dp)) {
            Content(project, model, showHoursMeter, onRefresh = { scope.launch { model.refresh(silent = false) } },
                    onToggle = { task -> scope.launch { model.toggle(task) } })
        }
    }
}

@Composable
private fun Content(
    project: Project,
    model: LabourTasksModel,
    showHoursMeter: Boolean,
    onRefresh: () -> Unit,
    onToggle: (LabourTask) -> Unit,
) {
    val plan = model.plan
    val tasks = plan?.tasks ?: emptyList()
    val hasBudget = plan?.hasBudget == true
    when {
        model.loading && tasks.isEmpty() && !hasBudget -> {
            Column(Modifier.fillMaxWidth().padding(vertical = 26.dp), horizontalAlignment = Alignment.CenterHorizontally,
                   verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                Text("Loading tasks…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        tasks.isEmpty() && !hasBudget -> {
            ContentUnavailable(
                icon = Icons.Outlined.Checklist,
                title = "No tasks for this job yet",
                description = model.error?.let { error -> { Text(error, color = Palette.red) } },
            ) {
                OutlinedButton(onClick = onRefresh, modifier = Modifier.semantics { contentDescription = "Refresh tasks" }) {
                    Icon(Icons.Filled.Refresh, contentDescription = null, tint = Palette.teal, modifier = Modifier.size(18.dp))
                    Text("Refresh", color = Palette.teal, modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        else -> Column(Modifier.fillMaxWidth()) {
            Text("Tasks", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
            if (showHoursMeter) {
                BudgetBurnMeter(progress = model.budget ?: project.budget, modifier = Modifier.padding(top = 10.dp))
            }
            if (tasks.isNotEmpty() && plan != null) Progress(plan)
            plan?.instructions?.let { instructions ->
                Text(instructions, style = appText(12.5, color = hex(0x4c5a56)).copy(lineHeight = 20.sp),
                     maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 9.dp))
            }
            model.syncNotice?.let { notice ->
                Row(Modifier.padding(top = 9.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Outlined.CloudUpload, contentDescription = null, tint = Palette.muted, modifier = Modifier.size(14.dp))
                    Text(notice, style = appText(11.5, FontWeight.SemiBold, Palette.muted))
                }
            }
            model.error?.let { error ->
                Text(error, style = appText(12, FontWeight.Bold, Palette.red), modifier = Modifier.padding(top = 9.dp))
            }
            if (tasks.isEmpty()) {
                Text("This job's plan has no tasks yet.", style = appText(12.5, color = Palette.muted), textAlign = TextAlign.Center,
                     modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp))
            } else {
                Column(Modifier.padding(top = 6.dp)) {
                    tasks.forEachIndexed { index, task ->
                        LabourTaskRow(task, pending = task.id in model.pendingTaskIds, showsDivider = index > 0) { onToggle(task) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Progress(plan: LabourPlan) {
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val suffix = " of ${plan.tasks.size} done" + if (plan.totalHours > 0) " · ${HoursFormat.task(plan.totalHours)} budgeted" else ""
        Text(buildAnnotatedString {
            withStyle(SpanStyle(fontSize = 20.sp, fontWeight = FontWeight.Black, color = Palette.ink, fontFeatureSettings = "tnum")) {
                append("${plan.completedCount}")
            }
            withStyle(SpanStyle(fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = Palette.muted)) { append(suffix) }
        })
        LinearProgressIndicator(
            progress = { (plan.completionPercent / 100).coerceAtMost(1.0).toFloat() },
            modifier = Modifier.fillMaxWidth(),
            color = Palette.teal,
            drawStopIndicator = {},
        )
    }
}

/** A task with its checkbox. */
@Composable
private fun LabourTaskRow(task: LabourTask, pending: Boolean, showsDivider: Boolean, onToggle: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column {
        if (showsDivider) HorizontalDivider(Modifier.padding(start = 40.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .toggleable(value = task.isCompleted, enabled = !pending, role = Role.Checkbox, onValueChange = { onToggle() })
                .padding(vertical = 11.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
                if (pending) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Checkbox(checked = task.isCompleted, onCheckedChange = null,
                             colors = CheckboxDefaults.colors(checkedColor = Palette.teal))
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    task.title,
                    style = appText(15, color = if (task.isCompleted) colors.onSurfaceVariant else colors.onSurface).copy(
                        textDecoration = if (task.isCompleted) TextDecoration.LineThrough else null,
                    ),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (task.isCompleted) {
                    Text(task.doneLabel(Instant.now()), style = appText(12, FontWeight.Medium, Palette.teal))
                } else {
                    task.notes?.let { notes ->
                        Text(notes, style = appText(12, color = colors.onSurfaceVariant), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (task.budgetedHours > 0) {
                Text(HoursFormat.task(task.budgetedHours), style = appText(13, color = colors.onSurfaceVariant).copy(fontFeatureSettings = "tnum"))
            }
        }
    }
}
