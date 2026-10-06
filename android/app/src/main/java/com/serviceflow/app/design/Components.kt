package com.serviceflow.app.design

import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.material3.LocalContentColor
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.serviceflow.core.BudgetHoursBreakdown
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A Material icon at a point size, decorative unless given a description. */
@Composable
fun AppIcon(icon: ImageVector, size: Dp, color: Color, modifier: Modifier = Modifier, contentDescription: String? = null) {
    // Unspecified inherits the button's content colour rather than drawing untinted (black).
    Icon(icon, contentDescription = contentDescription, tint = color.takeOrElse { LocalContentColor.current }, modifier = modifier.size(size))
}

/** A small spinner in a given colour. */
@Composable
fun Spinner(color: Color, modifier: Modifier = Modifier) {
    CircularProgressIndicator(color = color, strokeWidth = 2.dp, modifier = modifier.size(18.dp))
}

/** White card with a 1dp border. */
fun Modifier.bordered(radius: Dp, border: Color = Palette.border, background: Color = Color.White, width: Dp = 1.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this.clip(shape).background(background, shape).border(width, border, shape)
}

/** Debounces a search string: [committed] follows [text] 250 ms after typing stops. */
class Debouncer(private val scope: CoroutineScope, private val delayMillis: Long = 250) {
    var text by mutableStateOf("")
        private set
    var committed by mutableStateOf("")
        private set
    private var job: Job? = null

    fun update(value: String) {
        text = value
        job?.cancel()
        val trimmed = value.trim()
        if (trimmed.isEmpty()) {
            committed = ""
            return
        }
        job = scope.launch {
            delay(delayMillis)
            committed = trimmed
        }
    }

    fun clear() {
        job?.cancel()
        text = ""
        committed = ""
    }
}

@Composable
fun rememberDebouncer(delayMillis: Long = 250): Debouncer {
    val scope = rememberCoroutineScope()
    return remember { Debouncer(scope, delayMillis) }
}

/** The job over-budget question, shown after clocking out. */
data class OverBudgetPromptItem(val jobId: String, val projectName: String, val hoursOver: Double) {
    val id: String get() = jobId
}

/** `Uploading 2 items…` / `1 upload failed: reason. Tap to retry.` */
object UploadCopy {
    fun uploading(count: Int): String = "Uploading $count ${if (count == 1) "item" else "items"}…"

    fun failed(count: Int, reason: String?): String {
        val noun = if (count == 1) "upload" else "uploads"
        if (!reason.isNullOrEmpty()) return "$count $noun failed: $reason. Tap to retry."
        return "$count $noun failed. Tap to retry."
    }
}

/** A 12-segment budget bar. */
@Composable
fun BudgetTank(percent: Double?, color: Color, modifier: Modifier = Modifier) {
    val lit = BudgetHoursBreakdown.litSegments(percent = percent)
    Row(modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        repeat(12) { index ->
            Box(
                Modifier
                    .weight(1f)
                    .height(12.dp)
                    .background(if (index < lit) color else hex(0xe6eae9), RoundedCornerShape(3.dp)),
            )
        }
    }
}
