package com.serviceflow.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max

/** A Monday–Sunday week in device-local time. */
data class PayPeriod(
    /** Local `yyyy-MM-dd` of the Monday. */
    val id: String,
    val start: Instant,
    val end: Instant,
    val label: String,
) {
    fun contains(dayKey: String, zone: ZoneId = ZoneId.systemDefault()): Boolean {
        val noon = DayKey.noon(dayKey, zone) ?: return false
        return noon >= start && noon <= end
    }

    companion object {
        /** The current week and the two before it. */
        fun recent(now: Instant, zone: ZoneId = ZoneId.systemDefault(), count: Int = 3): List<PayPeriod> {
            val monday = startOfWeek(now, zone)
            return (0 until count).map { offset ->
                val start = monday.atZone(zone).plusDays(-7L * offset).toInstant()
                val end = start.atZone(zone).plusDays(6).toInstant()
                val label = "${DateText.format(start, "EEEMMMdd", zone = zone)} - ${DateText.format(end, "EEEMMMdd", zone = zone)}"
                PayPeriod(id = DayKey.of(start, zone), start = start, end = end, label = label)
            }
        }

        /** Monday at noon (noon avoids daylight-saving edge cases). */
        internal fun startOfWeek(date: Instant, zone: ZoneId): Instant {
            val local = date.atZone(zone)
            val diff = (local.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong() // Monday 0 … Sunday 6
            return local.minusDays(diff).withHour(12).withMinute(0).withSecond(0).withNano(0).toInstant()
        }
    }
}

object DayKey {
    fun of(date: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
        val local = date.atZone(zone).toLocalDate()
        return String.format(java.util.Locale.ROOT, "%04d-%02d-%02d", local.year, local.monthValue, local.dayOfMonth)
    }

    fun noon(key: String, zone: ZoneId = ZoneId.systemDefault()): Instant? {
        val parts = key.split("-").mapNotNull { it.toIntOrNull() }
        if (parts.size != 3) return null
        return runCatching { LocalDate.of(parts[0], parts[1], parts[2]).atTime(12, 0).atZone(zone).toInstant() }.getOrNull()
    }
}

/** Time on site, off site and not recorded within an entry. Intervals are seconds. */
data class SegmentSummary(
    val onSite: Double,
    val offSite: Double,
    val unknown: Double,
    val status: Status,
    val latestDistance: Double?,
) {
    enum class Status(val rawValue: String) {
        OnSite("On Site"),
        OffSite("Off Site"),
        Mixed("Mixed"),
        Unavailable("Location unavailable");

        companion object {
            fun fromRaw(value: String?): Status? = entries.firstOrNull { it.rawValue == value }
        }
    }

    val distanceLabel: String
        get() = latestDistance?.let { "${DistanceFormat.meters(it)} from site" } ?: "distance unknown"

    companion object {
        /** `SegmentSummary(entry, now = now)`. */
        operator fun invoke(entry: TimeEntry, now: Instant): SegmentSummary {
            var onSite = 0.0
            var offSite = 0.0
            var unknown = 0.0
            val segments = segments(entry, now)
            for (segment in segments) {
                val length = max(0.0, (segment.endedAt ?: now).timeIntervalSince(segment.startedAt))
                when (segment.mode) {
                    SiteMode.OnSite -> onSite += length
                    SiteMode.OffSite -> offSite += length
                    SiteMode.Unknown -> unknown += length
                }
            }
            if (onSite + offSite + unknown == 0.0) {
                val total = entry.duration(now)
                when (SiteMode(onSite = entry.onSite)) {
                    SiteMode.OnSite -> onSite = total
                    SiteMode.OffSite -> offSite = total
                    SiteMode.Unknown -> unknown = total
                }
            }
            val status = when {
                onSite > 0 && offSite > 0 -> Status.Mixed
                onSite > 0 -> Status.OnSite
                offSite > 0 -> Status.OffSite
                else -> Status.Unavailable
            }
            val latestDistance = segments.lastOrNull { it.distanceMeters != null }?.distanceMeters ?: entry.lastDistanceMeters
            return SegmentSummary(onSite, offSite, unknown, status, latestDistance)
        }

        /**
         * The entry's segments with a synthetic one when it has none; a running
         * entry's last segment runs until now. Segments are cut to the entry's
         * own times, so an edited start or end doesn't keep counting the time it removed.
         */
        internal fun segments(entry: TimeEntry, now: Instant): List<ShiftSegment> {
            val segments = entry.segments.ifEmpty {
                listOf(
                    ShiftSegment(
                        mode = SiteMode(onSite = entry.onSite), startedAt = entry.startedAt,
                        endedAt = entry.endedAt, distanceMeters = entry.lastDistanceMeters,
                    ),
                )
            }.toMutableList()
            if (entry.isActive) {
                segments[segments.size - 1] = segments.last().copy(endedAt = now)
            } else {
                for (index in segments.indices) {
                    if (segments[index].endedAt == null) segments[index] = segments[index].copy(endedAt = entry.endedAt ?: now)
                }
            }
            val end = if (entry.isActive) now else entry.endedAt ?: now
            return segments.mapNotNull { segment ->
                val start = maxOf(segment.startedAt, entry.startedAt)
                val stop = minOf(segment.endedAt ?: end, end)
                if (stop > start) segment.copy(startedAt = start, endedAt = stop) else null
            }
        }
    }
}

/** One day in the timesheet list. */
data class TimesheetDay(
    val id: String,
    val weekday: String,
    val date: String,
    val entries: List<TimeEntry>,
    val totalMinutes: Int,
    val onSiteMinutes: Int,
    val offSiteMinutes: Int,
    val unknownMinutes: Int,
    val jobs: List<String>,
) {
    val isWorked: Boolean get() = entries.isNotEmpty()
    val total: String get() = DurationFormat.hoursMinutes(minutes = totalMinutes)

    /** `Sep 2, 2026`. */
    fun fullDate(zone: ZoneId = ZoneId.systemDefault()): String {
        val noon = DayKey.noon(id, zone) ?: return date
        return DateText.format(noon, "MMMdy", zone = zone)
    }

    companion object {
        internal fun empty(key: String, zone: ZoneId): TimesheetDay {
            val noon = DayKey.noon(key, zone)
            return TimesheetDay(
                id = key, weekday = DateText.format(noon, "EEE", zone = zone), date = DateText.format(noon, "MMMdd", zone = zone),
                entries = emptyList(), totalMinutes = 0, onSiteMinutes = 0, offSiteMinutes = 0, unknownMinutes = 0, jobs = emptyList(),
            )
        }
    }
}

object TimesheetBuilder {
    /**
     * Every past or current day of `period`, newest first; days without an
     * entry are included as missing days.
     */
    fun days(period: PayPeriod, entries: List<TimeEntry>, now: Instant, zone: ZoneId = ZoneId.systemDefault()): List<TimesheetDay> {
        val grouped = entries.groupBy { DayKey.of(it.startedAt, zone) }
        val todayKey = DayKey.of(now, zone)
        val keys = mutableListOf<String>()
        var cursor = period.end
        while (cursor >= period.start.addingTimeInterval(-60.0)) {
            val key = DayKey.of(cursor, zone)
            if (key <= todayKey) keys.add(key)
            cursor = cursor.atZone(zone).minusDays(1).toInstant()
        }
        for (key in grouped.keys) {
            if (period.contains(key, zone) && key !in keys) keys.add(key)
        }
        return keys.sortedDescending().map { key ->
            val dayEntries = grouped[key]
            if (dayEntries.isNullOrEmpty()) TimesheetDay.empty(key, zone)
            else worked(key, dayEntries.sortedByDescending { it.startedAt }, now, zone)
        }
    }

    internal fun worked(key: String, entries: List<TimeEntry>, now: Instant, zone: ZoneId): TimesheetDay {
        var total = 0.0
        var onSite = 0.0
        var offSite = 0.0
        var unknown = 0.0
        val jobs = mutableListOf<String>()
        for (entry in entries) {
            total += entry.duration(now)
            val summary = SegmentSummary(entry, now = now)
            onSite += summary.onSite
            offSite += summary.offSite
            unknown += summary.unknown
            if (entry.project.name !in jobs && jobs.size < 4) jobs.add(entry.project.name)
        }
        return TimesheetDay.empty(key, zone).copy(
            entries = entries,
            totalMinutes = (total / 60).toInt(),
            onSiteMinutes = (onSite / 60).toInt(),
            offSiteMinutes = (offSite / 60).toInt(),
            unknownMinutes = (unknown / 60).toInt(),
            jobs = jobs,
        )
    }

    fun weekTotalMinutes(days: List<TimesheetDay>): Int = days.sumOf { it.totalMinutes }
    fun daysWorked(days: List<TimesheetDay>): Int = days.count { it.isWorked }

    /** `Original in 7:00 AM · original out 3:30 PM · edited 4:02 PM`, or null. */
    fun originalTimeNote(entry: TimeEntry, startAt: Instant, endAt: Instant?): String? {
        val minute: (Instant) -> Long = { (it.timeIntervalSince1970 / 60).roundedSwift().toLong() }
        val parts = mutableListOf<String>()
        val originalStart = entry.originalStartedAt
        if (minute(originalStart) != minute(startAt)) parts.add("Original in ${DateText.time(originalStart)}")
        val originalEnd = entry.adjustmentHistory.firstOrNull { it.previousEndedAt != null }?.previousEndedAt
        if (!entry.isActive && endAt != null && originalEnd != null && minute(originalEnd) != minute(endAt)) {
            parts.add("original out ${DateText.time(originalEnd)}")
        }
        if (parts.isEmpty()) return null
        val edited = entry.adjustmentHistory.lastOrNull()?.adjustedAt ?: entry.startEditedAt
        if (edited != null) parts.add("edited ${DateText.time(edited)}")
        return parts.joinToString(" · ")
    }
}
