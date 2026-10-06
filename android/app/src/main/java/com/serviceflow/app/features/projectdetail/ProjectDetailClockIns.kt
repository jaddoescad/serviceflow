package com.serviceflow.app.features.projectdetail

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.design.DetailPalette
import com.serviceflow.app.design.appText
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.jobs.ContentUnavailable
import com.serviceflow.core.DateText
import com.serviceflow.core.DistanceFormat
import com.serviceflow.core.DurationFormat
import com.serviceflow.core.PainterClockInSummary
import com.serviceflow.core.SegmentSummary
import com.serviceflow.core.TimeEntry
import java.time.Instant

/** Location status of one clock-in, as shown on Project Detail. */
enum class ProjectDetailSiteStatus(val label: String, val color: Color, val background: Color) {
    On("On Site", DetailPalette.brand, hex(0xe6f2f4)),
    Off("Off Site", hex(0xc0432b), hex(0xfbecea)),
    Mixed("Mixed location", hex(0x9a611f), hex(0xfff3df)),
    Unknown("Location unavailable", hex(0x6f7774), hex(0xeef1ef));

    companion object {
        fun of(status: SegmentSummary.Status): ProjectDetailSiteStatus = when (status) {
            SegmentSummary.Status.OnSite -> On
            SegmentSummary.Status.OffSite -> Off
            SegmentSummary.Status.Mixed -> Mixed
            SegmentSummary.Status.Unavailable -> Unknown
        }
    }
}

private val tabular = SpanStyle(fontFeatureSettings = "tnum")

/** A 3×3 dot between meta items. */
@Composable
private fun ProjectDetailDot() {
    Box(Modifier.size(3.dp).background(DetailPalette.subtle, CircleShape))
}

/** Initials in a circle; brand-coloured for you. */
@Composable
fun ProjectDetailAvatar(initials: String, isYou: Boolean, size: Dp, fontSize: Number) {
    Box(
        Modifier.size(size).background(if (isYou) DetailPalette.brand else hex(0xeef1f4), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, style = appText(fontSize, FontWeight.ExtraBold, if (isYou) Color.White else DetailPalette.navy, tracking = 0.4))
    }
}

/** One person's row in "Hours by Crew". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProjectDetailPainterRow(summary: PainterClockInSummary, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    Row(modifier.padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        ProjectDetailAvatar(summary.initials, summary.isYou, size = 34.dp, fontSize = 12)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(summary.name, style = appText(15, FontWeight.SemiBold, colors.onSurface), maxLines = 1,
                     overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (summary.isYou) {
                    Text("You", style = appText(11, FontWeight.SemiBold, DetailPalette.brand),
                         modifier = Modifier.background(DetailPalette.brand.copy(alpha = 0.12f), CircleShape).padding(horizontal = 6.dp, vertical = 2.dp))
                }
                Spacer(Modifier.weight(1f).padding(start = 4.dp))
                Text(DurationFormat.hoursMinutes(summary.totalMinutes), style = appText(15, FontWeight.SemiBold, colors.onSurface).merge(tabular))
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp),
                    itemVerticalAlignment = Alignment.CenterVertically) {
                metaItems(summary, colors.onSurfaceVariant).forEachIndexed { index, item ->
                    if (index > 0) ProjectDetailDot()
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        item.dot?.let { Box(Modifier.size(6.dp).background(it, CircleShape)) }
                        Text(item.text, style = appText(12, item.weight, item.color))
                    }
                }
            }
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.onSurfaceVariant)
    }
}

private data class MetaItem(val text: String, val color: Color, val weight: FontWeight, val dot: Color?)

private fun metaItems(summary: PainterClockInSummary, secondary: Color): List<MetaItem> {
    val items = mutableListOf(
        MetaItem("${summary.clockInCount} ${if (summary.clockInCount == 1) "clock-in" else "clock-ins"}", secondary, FontWeight.Normal, null),
    )
    if (summary.onSiteCount > 0) {
        items += MetaItem("${summary.onSiteCount} On Site", DetailPalette.brand, FontWeight.SemiBold, DetailPalette.brand)
    }
    if (summary.offSiteCount > 0) {
        val red = hex(0xc0432b)
        items += MetaItem("${summary.offSiteCount} Off Site", red, FontWeight.SemiBold, red)
    }
    if (summary.mixedCount > 0) items += MetaItem("${summary.mixedCount} Mixed", hex(0x9a611f), FontWeight.SemiBold, null)
    if (summary.unknownCount > 0) items += MetaItem("${summary.unknownCount} Location unavailable", secondary, FontWeight.Normal, null)
    return items
}

/** One person's clock-ins on the job, day by day (pushed). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailPainterDetail(
    summary: PainterClockInSummary?,
    now: Instant,
    onBack: () -> Unit,
    onEdit: (TimeEntry) -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    val title = when {
                        summary == null -> ""
                        summary.isYou -> "Your Clock-ins"
                        else -> summary.name
                    }
                    Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
        containerColor = colors.surfaceContainer,
    ) { padding ->
        if (summary == null) {
            Box(Modifier.fillMaxSize().padding(padding)) { ContentUnavailable(Icons.Outlined.Schedule, "No clock-ins") }
            return@Scaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp),
                   verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item(key = "header") {
                GroupCard {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        ProjectDetailAvatar(summary.initials, summary.isYou, size = 44.dp, fontSize = 15)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(summary.name + if (summary.isYou) " (You)" else "", style = appText(17, FontWeight.SemiBold, colors.onSurface),
                                 maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(metaLine(summary), style = appText(12, color = colors.onSurfaceVariant), maxLines = 2)
                        }
                        Text(DurationFormat.hoursMinutes(summary.totalMinutes), style = appText(17, FontWeight.SemiBold, DetailPalette.navy).merge(tabular))
                    }
                }
            }
            items(summary.days, key = { it.id }) { day ->
                Column {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 6.dp)) {
                        Text("${day.label}, ${day.dateLabel}", style = MaterialTheme.typography.titleSmall, color = colors.onSurfaceVariant,
                             modifier = Modifier.weight(1f))
                        Text(DurationFormat.hoursMinutes(day.totalMinutes), style = MaterialTheme.typography.titleSmall.merge(tabular),
                             color = colors.onSurfaceVariant)
                    }
                    GroupCard {
                        day.entries.forEachIndexed { index, entry ->
                            if (index > 0) HorizontalDivider(Modifier.padding(start = 16.dp))
                            ProjectDetailClockInRow(
                                entry = entry, now = now, showsChevron = summary.isYou,
                                modifier = (if (summary.isYou) Modifier.clickable { onEdit(entry) } else Modifier)
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun metaLine(summary: PainterClockInSummary): String {
    val parts = mutableListOf("${summary.clockInCount} ${if (summary.clockInCount == 1) "clock-in" else "clock-ins"}")
    if (summary.onSiteCount > 0) parts += "${summary.onSiteCount} on site"
    if (summary.offSiteCount > 0) parts += "${summary.offSiteCount} off site"
    if (summary.mixedCount > 0) parts += "${summary.mixedCount} mixed"
    if (summary.unknownCount > 0) parts += "${summary.unknownCount} location unavailable"
    return parts.joinToString(" · ")
}

/** A white rounded group, like an inset-grouped section. */
@Composable
internal fun GroupCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = Color.White) {
        Column { content() }
    }
}

/** A clock-in: times, location status and GPS breakdown. */
@Composable
fun ProjectDetailClockInRow(entry: TimeEntry, now: Instant, modifier: Modifier = Modifier, showsChevron: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    val summary = SegmentSummary(entry, now = now)
    val status = ProjectDetailSiteStatus.of(summary.status)
    Row(modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            TimeLine(entry, colors.onSurfaceVariant)
            Row(
                Modifier.background(status.background, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(6.dp).background(status.color, CircleShape))
                Text(status.label, style = appText(11, FontWeight.SemiBold, status.color))
                summary.latestDistance?.let { distance ->
                    Text("· ${DistanceFormat.meters(distance)} from site", style = appText(11, FontWeight.SemiBold, status.color))
                }
            }
            gpsBreakdown(summary)?.let { Text(it, style = appText(11, color = colors.onSurfaceVariant)) }
        }
        Text(DurationFormat.hoursMinutes(entry.duration(now)), style = appText(14, FontWeight.SemiBold, colors.onSurface).merge(tabular))
        if (showsChevron) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.onSurfaceVariant)
    }
}

@Composable
private fun TimeLine(entry: TimeEntry, secondary: Color) {
    val end = if (entry.isActive) "Now" else DateText.time(entry.endedAt)
    fun span(size: TextUnit, weight: FontWeight, color: Color) = SpanStyle(fontSize = size, fontWeight = weight, color = color)
    Text(
        buildAnnotatedString {
            withStyle(span(14.sp, FontWeight.SemiBold, DetailPalette.brand)) { append(DateText.time(entry.startedAt)) }
            withStyle(span(12.sp, FontWeight.Normal, secondary)) { append(" ${if (entry.startedLocation == null) "Manual" else "GPS"}") }
            withStyle(span(14.sp, FontWeight.Normal, secondary)) { append("  –  ") }
            withStyle(span(14.sp, FontWeight.SemiBold, DetailPalette.brand)) { append(end) }
            withStyle(span(12.sp, FontWeight.Normal, secondary)) { append(" ${if (entry.lastLocation == null) "Manual" else "GPS"}") }
        },
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Shown when more than one of on site / off site / not recorded has time. */
private fun gpsBreakdown(summary: SegmentSummary): String? {
    val buckets = listOf(summary.onSite to "on site", summary.offSite to "off site", summary.unknown to "location unavailable")
        .filter { it.first >= 60 }
    if (buckets.size <= 1) return null
    return (listOf("GPS breakdown") + buckets.map { "${DurationFormat.hoursMinutes(it.first)} ${it.second}" }).joinToString(" · ")
}
