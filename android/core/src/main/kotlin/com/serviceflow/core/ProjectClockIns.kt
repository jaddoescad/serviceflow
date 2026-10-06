package com.serviceflow.core

import java.time.Instant
import java.time.ZoneId

/** A painter's time on one job, for Project Detail's "Hours by Painter". */
data class PainterClockInSummary(
    val userId: String,
    val name: String,
    val isYou: Boolean,
    val totalMinutes: Int,
    val clockInCount: Int,
    val onSiteCount: Int,
    val offSiteCount: Int,
    val mixedCount: Int,
    val unknownCount: Int,
    val days: List<PainterDay>,
) {
    val id: String get() = userId
    val initials: String get() = Initials.of(name, fallback = "P")
}

data class PainterDay(
    val id: String,
    val label: String,
    val dateLabel: String,
    val totalMinutes: Int,
    val entries: List<TimeEntry>,
)

object ProjectClockIns {
    /**
     * Entries on `projectId` (the running shift included), de-duplicated,
     * grouped by painter. Painters are keyed by user id, not name.
     */
    fun summaries(
        entries: List<TimeEntry>, activeShift: TimeEntry?, projectId: String, userId: String,
        now: Instant, zone: ZoneId = ZoneId.systemDefault(),
    ): List<PainterClockInSummary> {
        val seen = mutableSetOf<String>()
        val relevant = mutableListOf<TimeEntry>()
        for (entry in listOfNotNull(activeShift) + entries) {
            if (entry.project.id != projectId) continue
            if (entry.identityKeys.any { it in seen }) continue
            seen.addAll(entry.identityKeys)
            relevant.add(entry)
        }
        val byUser = relevant.groupBy { if (it.userId.isEmpty()) it.userName else it.userId }
        val todayKey = DayKey.of(now, zone)

        return byUser.map { (key, list) ->
            val sorted = list.sortedByDescending { it.startedAt }
            var totalMinutes = 0
            var onSiteCount = 0
            var offSiteCount = 0
            var mixedCount = 0
            var unknownCount = 0
            for (entry in sorted) {
                totalMinutes += (entry.duration(now) / 60).toInt()
                when (SegmentSummary(entry, now = now).status) {
                    SegmentSummary.Status.OnSite -> onSiteCount += 1
                    SegmentSummary.Status.OffSite -> offSiteCount += 1
                    SegmentSummary.Status.Mixed -> mixedCount += 1
                    SegmentSummary.Status.Unavailable -> unknownCount += 1
                }
            }
            val byDay = sorted.groupBy { DayKey.of(it.startedAt, zone) }
            val days = byDay.keys.sortedDescending().map { dayKey ->
                val dayEntries = byDay[dayKey] ?: emptyList()
                val noon = DayKey.noon(dayKey, zone)
                PainterDay(
                    id = dayKey,
                    label = if (dayKey == todayKey) "Today" else DateText.format(noon, "EEEE", zone = zone),
                    dateLabel = DateText.canadianShortDate(noon),
                    totalMinutes = dayEntries.sumOf { (it.duration(now) / 60).toInt() },
                    entries = dayEntries,
                )
            }
            PainterClockInSummary(
                userId = key, name = sorted.firstOrNull()?.userName ?: "Crew member", isYou = key == userId,
                totalMinutes = totalMinutes, clockInCount = sorted.size, onSiteCount = onSiteCount,
                offSiteCount = offSiteCount, mixedCount = mixedCount, unknownCount = unknownCount, days = days,
            )
        }.sortedWith { lhs, rhs ->
            when {
                lhs.isYou != rhs.isYou -> if (lhs.isYou) -1 else 1
                else -> rhs.totalMinutes.compareTo(lhs.totalMinutes)
            }
        }
    }

    /** Distinct local days with an entry by `userId` on the job. */
    fun dayCount(summaries: List<PainterClockInSummary>, userId: String): Int =
        summaries.firstOrNull { it.userId == userId }?.days?.size ?: 0
}

object Initials {
    /** First letters of the first two words, uppercased. */
    fun of(name: String?, fallback: String): String {
        val letters = (name ?: "").split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).map { it.first() }
        val value = letters.joinToString("").uppercase()
        return value.ifEmpty { fallback }
    }
}
