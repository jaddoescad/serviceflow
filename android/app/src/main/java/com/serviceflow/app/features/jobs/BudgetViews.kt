package com.serviceflow.app.features.jobs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.design.BudgetTank
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.BudgetHoursBreakdown
import com.serviceflow.core.BudgetPresentation
import com.serviceflow.core.BudgetProgress

/**
 * Hours left (or over) on list rows and the current-job card. Shows nothing
 * until the job has a budget and some hours.
 */
@Composable
fun BudgetProgressBadge(progress: BudgetProgress?, dark: Boolean) {
    val breakdown = BudgetHoursBreakdown(progress)
    val left = breakdown.leftLabel
    if (!breakdown.derivable || left == null) return
    val presentation = BudgetPresentation(progress)
    val color = if (dark) (if (breakdown.isOver) hex(0xffb3a1) else Color.White.copy(alpha = 0.9f)) else hex(presentation.colorHex)
    val fill = if (dark) (if (breakdown.isOver) hex(0xffb3a1) else hex(0xa9f1c4)) else hex(presentation.colorHex)
    val fraction = (presentation.fillPercent / 100).coerceIn(0.0, 1.0).toFloat()
    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .width(40.dp)
                .height(5.dp)
                .background(if (dark) Color.White.copy(alpha = 0.25f) else hex(0xe5e9e8), CircleShape),
        ) {
            Box(Modifier.width(40.dp * fraction).height(5.dp).background(fill, CircleShape))
        }
        Text(
            if (breakdown.isOver) "$left over budget" else "$left left",
            style = appText(12, FontWeight.ExtraBold, color),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The "Job hours" card on Project Detail. */
@Composable
fun BudgetHoursPanel(
    progress: BudgetProgress?,
    loading: Boolean,
    yourHours: String,
    secondaryLabel: String,
    secondaryValue: String,
    modifier: Modifier = Modifier,
) {
    val breakdown = BudgetHoursBreakdown(progress)
    val presentation = BudgetPresentation(progress)
    val burn = hex(presentation.burnHex)
    val showsLoading = progress == null && loading
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Job hours", style = appText(13, FontWeight.Black, Palette.ink))
            Spacer(Modifier.weight(1f))
            if (breakdown.tracked) {
                Text(
                    presentation.statusLabel,
                    style = appText(11, FontWeight.Black, burn),
                    modifier = Modifier
                        .background(hex(presentation.backgroundHex), CircleShape)
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                )
            }
        }
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = 11.dp, bottom = 2.dp)) {
            HoursColumn("Your hours", yourHours, caption = "you")
            ColumnDivider()
            if (breakdown.derivable) {
                HoursColumn("Hours used", breakdown.usedLabel ?: "0h", caption = "whole team")
                ColumnDivider()
                HoursColumn(
                    if (breakdown.isOver) "Hours over" else "Hours left",
                    breakdown.leftLabel ?: "—",
                    valueColor = burn,
                    caption = if (breakdown.isOver) "over budget" else "in the budget",
                    captionColor = if (breakdown.isOver) burn else hex(0xaeb7b3),
                    captionWeight = if (breakdown.isOver) FontWeight.ExtraBold else FontWeight.Bold,
                )
            } else {
                HoursColumn(
                    secondaryLabel,
                    breakdown.usedLabel ?: secondaryValue,
                    caption = if (breakdown.usedLabel == null) null else "whole team",
                )
            }
        }
        if (breakdown.tracked || showsLoading) {
            BudgetTank(percent = breakdown.percentUsed, color = burn)
            Text(
                breakdown.footnote(loading = showsLoading),
                style = appText(11.5, FontWeight.Bold, Palette.muted),
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun ColumnDivider() {
    Box(Modifier.padding(horizontal = 12.dp).width(1.dp).fillMaxHeight().background(hex(0xe2e7e8)))
}

@Composable
private fun RowScope.HoursColumn(
    label: String,
    value: String,
    valueColor: Color = Palette.ink,
    caption: String?,
    captionColor: Color = hex(0xaeb7b3),
    captionWeight: FontWeight = FontWeight.Bold,
) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = appText(11, FontWeight.ExtraBold, Palette.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(value, style = appText(20, FontWeight.Black, valueColor, tracking = -0.4), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (caption != null) {
            Text(caption, style = appText(10.5, captionWeight, captionColor), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Hours used against the budget, above the Clock In screen's task list. */
@Composable
fun BudgetBurnMeter(progress: BudgetProgress?, modifier: Modifier = Modifier) {
    val breakdown = BudgetHoursBreakdown(progress)
    val burn = hex(BudgetPresentation(progress).burnHex)
    if (progress == null) {
        Column(modifier) {
            UsedLine("–", monospaced = false, modifier = Modifier.padding(bottom = 8.dp))
            BudgetTank(percent = null, color = burn)
            Text("Loading budget…", style = appText(11.5, FontWeight.Bold, Palette.muted), modifier = Modifier.padding(top = 8.dp))
        }
    } else if (breakdown.tracked) {
        Column(modifier) {
            Row(Modifier.padding(bottom = 8.dp)) {
                UsedLine(breakdown.usedLabel ?: "0h", monospaced = true, modifier = Modifier.alignByBaseline())
                Spacer(Modifier.weight(1f).padding(start = 8.dp))
                val left = breakdown.leftLabel
                if (breakdown.derivable && left != null) {
                    Text(
                        if (breakdown.isOver) "$left over budget" else "$left left",
                        style = appText(12.5, FontWeight.Black, burn),
                        maxLines = 1,
                        modifier = Modifier.alignByBaseline(),
                    )
                }
            }
            BudgetTank(percent = breakdown.percentUsed, color = burn)
            Text(breakdown.footnote(loading = false), style = appText(11.5, FontWeight.Bold, Palette.muted), modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun UsedLine(value: String, monospaced: Boolean, modifier: Modifier) {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontSize = 20.sp, fontWeight = FontWeight.Black, color = Palette.ink,
                                fontFeatureSettings = if (monospaced) "tnum" else null)) { append(value) }
            withStyle(SpanStyle(fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = Palette.muted)) { append(" used") }
        },
        modifier = modifier,
    )
}
