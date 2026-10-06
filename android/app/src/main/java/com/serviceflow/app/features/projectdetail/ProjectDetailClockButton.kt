package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.serviceflow.app.LocalSession
import com.serviceflow.app.LocalTracker
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.OverBudgetPromptItem
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.core.ClockOutReason
import com.serviceflow.core.Project
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private enum class ClockAction(val label: String, val icon: ImageVector) {
    ClockIn("Clock In", Icons.Filled.PlayArrow),
    SwitchJob("Switch Job", Icons.Filled.SwapHoriz),
    ClockOut("Clock Out", Icons.Filled.StopCircle),
}

/**
 * Clock In / Switch Job / Clock Out for the job on Project Detail, with the
 * message shown underneath when an action fails.
 *
 * @param onOverBudget the job went over budget with this clock-out.
 * @param onHoursChanged reload the job's budget after the hours changed.
 */
@Composable
fun ProjectDetailClockButton(
    project: Project,
    title: String,
    onOverBudget: (OverBudgetPromptItem) -> Unit,
    onHoursChanged: suspend () -> Unit,
    modifier: Modifier = Modifier,
) {
    val session = LocalSession.current
    val tracker = LocalTracker.current
    val activeShift by tracker.activeShift.collectAsStateWithLifecycle()
    val clockingOut by tracker.isClockingOut.collectAsStateWithLifecycle()
    val notice by tracker.notice.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val action = when (val shift = activeShift) {
        null -> ClockAction.ClockIn
        else -> if (shift.project.id == project.id && !clockingOut) ClockAction.ClockOut else ClockAction.SwitchJob
    }

    fun run() {
        if (pending) return
        val current = action
        pending = true
        error = null
        tracker.clearNotice()
        scope.launch {
            try {
                when (current) {
                    ClockAction.ClockOut -> {
                        if (session.clockOut(reason = ClockOutReason.ProjectDetail) == null) {
                            error = "Clock out could not complete. Try again."
                            return@launch
                        }
                        onHoursChanged()
                        session.overBudgetHours(jobId = project.id)?.let { hoursOver ->
                            onOverBudget(OverBudgetPromptItem(jobId = project.id, projectName = title, hoursOver = hoursOver))
                        }
                    }
                    ClockAction.SwitchJob -> {
                        if (session.switchProject(to = project) == null) {
                            error = "Switch job could not complete. Try again."
                            return@launch
                        }
                        onHoursChanged()
                        session.showClockIn()
                    }
                    ClockAction.ClockIn -> {
                        session.clockIn(project)
                        onHoursChanged()
                        session.showClockIn()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                error = e.message?.takeIf { it.isNotEmpty() } ?: "Clock action could not complete. Try again."
            } finally {
                pending = false
            }
        }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = ::run,
            enabled = !pending && !clockingOut,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (action == ClockAction.ClockOut) Palette.red else DetailPalette.brand,
                contentColor = Color.White,
            ),
        ) {
            if (pending) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                Text("Working…", style = appText(17, FontWeight.SemiBold, Color.White), modifier = Modifier.padding(start = 8.dp))
            } else {
                Icon(action.icon, contentDescription = null)
                Text(action.label, style = appText(17, FontWeight.SemiBold, Color.White), modifier = Modifier.padding(start = 8.dp))
            }
        }
        (notice?.message ?: error)?.let { feedback ->
            Text(feedback, color = Palette.red, style = appText(13, color = Palette.red), textAlign = TextAlign.Center,
                 modifier = Modifier.fillMaxWidth())
        }
    }
}
