package com.serviceflow.core

import java.text.Collator
import java.time.Instant

/** Someone who has worked a job on the Today board. */
data class TodayPainter(
    val userId: String,
    val name: String,
    /** Time on this job, all time. */
    val totalMinutes: Int,
    /** First clock-in today, when they clocked in today. */
    val inTodayAt: Instant?,
    /** Last clock-out today, once they're off the clock here. */
    val outTodayAt: Instant? = null,
) {
    val id: String get() = userId
    /** Clocked in here right now. */
    val isOnClock: Boolean get() = inTodayAt != null && outTodayAt == null
    val initials: String get() = Initials.of(name, fallback = "P")
}

/** A job someone clocked in to today, with everyone who has worked it. */
data class TodayJob(
    val project: Project,
    /** The job's address, else where today's crew clocked in closest to it. */
    val coordinate: Coordinate?,
    /** Clocked in today first, then by hours on the job. */
    val painters: List<TodayPainter>,
) {
    val id: String get() = project.id
}

/**
 * The managers' Today board, as on the website: the jobs someone clocked in
 * to today. Anyone who clocked in today counts, even after clocking out.
 */
object TodayBoard {
    /** Swift's `localizedCompare`. */
    private val nameOrder: Comparator<String> =
        Collator.getInstance().let { collator -> Comparator { a, b -> collator.compare(a, b) } }

    /**
     * [entries]: every active or completed entry on the candidate jobs;
     * [projects]: those jobs as the feed shows them (others are left out).
     */
    fun jobs(entries: List<TimeEntry>, projects: List<Project>, startOfDay: Instant, now: Instant): List<TodayJob> {
        val isToday = { entry: TimeEntry -> entry.isActive || entry.startedAt >= startOfDay }
        val byJob = entries.groupBy { it.project.id }
        return projects.filter { it.isListable }.mapNotNull { project ->
            val list = byJob[project.id] ?: emptyList()
            val today = list.filter(isToday)
            if (today.isEmpty()) return@mapNotNull null

            val painters = linkedMapOf<String, TodayPainter>()
            val onClock = mutableSetOf<String>()
            for (entry in list) {
                val key = entry.userId.ifEmpty { entry.userName }
                var painter = painters[key] ?: TodayPainter(userId = key, name = entry.userName, totalMinutes = 0, inTodayAt = null)
                painter = painter.copy(totalMinutes = painter.totalMinutes + (entry.duration(now) / 60).toInt())
                if (isToday(entry)) {
                    if (painter.inTodayAt?.let { entry.startedAt < it } != false) painter = painter.copy(inTodayAt = entry.startedAt)
                    val end = entry.endedAt
                    if (end != null && painter.outTodayAt?.let { end > it } != false) painter = painter.copy(outTodayAt = end)
                    if (entry.isActive) onClock += key
                }
                painters[key] = painter
            }
            for (key in onClock) painters[key] = painters.getValue(key).copy(outTodayAt = null)
            val nearest = today.filter { it.startedLocation != null }
                .minByOrNull { it.lastDistanceMeters ?: Double.POSITIVE_INFINITY }
            TodayJob(
                project = project,
                coordinate = project.coordinate ?: nearest?.startedLocation?.coordinate,
                painters = painters.values.sortedWith(
                    compareBy<TodayPainter> { it.inTodayAt == null }
                        .thenByDescending { it.totalMinutes }
                        .thenBy(nameOrder) { it.name },
                ),
            )
        }.sortedWith(compareBy(nameOrder) { it.project.name })
    }

    /** People who clocked in today, across all jobs. */
    fun activeCount(jobs: List<TodayJob>): Int =
        jobs.flatMap { job -> job.painters.filter { it.inTodayAt != null }.map { it.userId } }.toSet().size

    /** `3 painters on 2 jobs`. */
    fun summary(jobs: List<TodayJob>): String {
        val people = activeCount(jobs)
        return "$people ${if (people == 1) "painter" else "painters"} on ${jobs.size} ${if (jobs.size == 1) "job" else "jobs"}"
    }

    /** `in at 7:43 a.m.`, or `in since Oct 30` for a shift left running from an earlier day. */
    fun inLabel(date: Instant, startOfDay: Instant): String =
        if (date < startOfDay) "in since ${DateText.format(date, "MMMd", locale = DateText.canada)}"
        else "in at ${DateText.canadianTime(date)}"

    /**
     * `out at 12:18 p.m.` once they've clocked out here today, else when they
     * clocked in; null for crew who didn't work it today.
     */
    fun timeLabel(painter: TodayPainter, startOfDay: Instant): String? =
        painter.outTodayAt?.let { "out at ${DateText.canadianTime(it)}" } ?: painter.inTodayAt?.let { inLabel(it, startOfDay) }

    /** `Labour budget · 18.3 of 67.3 h` and the percent used; null without a budget. */
    fun budgetLine(progress: BudgetProgress?): Pair<String, Int>? {
        val budget = progress?.budgetHours?.takeIf { it > 0 } ?: return null
        val used = progress.hoursUsed ?: 0.0
        return "Labour budget · ${formatFixed(used, 1)} of ${formatFixed(budget, 1)} h" to (used / budget * 100).roundedSwift().toInt()
    }
}
