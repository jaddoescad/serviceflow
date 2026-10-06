package com.serviceflow.app.features.jobs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.serviceflow.app.design.AppIcon
import com.serviceflow.app.design.Palette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.Project

/** The job you're clocked into (shown on a teal row). */
@Composable
fun JobsCurrentCard(project: Project, onSite: Boolean?, myTime: Double?, modifier: Modifier = Modifier) {
    Row(modifier.padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(52.dp).background(Palette.green, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            AppIcon(Icons.Filled.Place, 26.dp, Color.White)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).background(hex(0xa9f1c4), CircleShape))
                Text(if (onSite == false) "Off site" else "Clocked in", style = appText(12, FontWeight.SemiBold, Color.White.copy(alpha = 0.85f)))
            }
            Text(project.name, style = appText(17, FontWeight.SemiBold, Color.White), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(project.cardAddress ?: "No address on file", style = appText(13, color = Color.White.copy(alpha = 0.82f)),
                 maxLines = 1, overflow = TextOverflow.Ellipsis)
            BudgetProgressBadge(progress = project.budget, dark = true)
        }
        if (myTime != null) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(DurationFormat.hoursMinutes(myTime), style = appText(20, FontWeight.Bold, Color.White).copy(fontFeatureSettings = "tnum"))
                Text("Your hours", style = appText(11, FontWeight.Medium, Color.White.copy(alpha = 0.82f)))
            }
        }
    }
}

/** One job or lead in the list. */
@Composable
fun JobsRow(project: Project, myTime: Double?, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    Row(modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(42.dp).background(Palette.teal.copy(alpha = 0.1f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            AppIcon(Icons.Filled.Place, 22.dp, Palette.teal)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(project.name, style = appText(16, FontWeight.SemiBold, colors.onSurface), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(project.cardAddress ?: "No address on file", style = appText(13, color = colors.onSurfaceVariant),
                 maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (project.isLead) {
                Text(
                    "Lead · ${project.leadStageLabel}",
                    style = appText(11, FontWeight.SemiBold, Palette.teal),
                    modifier = Modifier
                        .padding(top = 4.dp)
                        .background(Palette.teal.copy(alpha = 0.12f), CircleShape)
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            } else {
                BudgetProgressBadge(progress = project.budget, dark = false)
            }
        }
        if (myTime != null) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(DurationFormat.hoursMinutes(myTime), style = appText(15, FontWeight.SemiBold, Palette.green).copy(fontFeatureSettings = "tnum"))
                Text("Your hours", style = appText(11, color = colors.onSurfaceVariant))
            }
        }
    }
}

/** An icon, a title and a line of detail for an empty list (iOS `ContentUnavailableView`). */
@Composable
fun ContentUnavailable(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
    description: (@Composable () -> Unit)? = null,
    actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AppIcon(icon, 40.dp, colors.onSurfaceVariant)
        Text(title, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), textAlign = TextAlign.Center)
        if (description != null) {
            CompositionLocalProvider(
                LocalContentColor provides colors.onSurfaceVariant,
                LocalTextStyle provides MaterialTheme.typography.bodyMedium.copy(textAlign = TextAlign.Center),
            ) { description() }
        }
        actions?.invoke(this)
    }
}
