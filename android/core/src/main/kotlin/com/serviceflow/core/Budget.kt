package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Labour-budget progress for a job, from `job_feed`. */
@Serializable
data class BudgetProgress(
    val jobId: String,
    val percentUsed: Double?,
    val hoursUsed: Double?,
    val budgetHours: Double? = null,
    val status: Status,
    val isComplete: Boolean = false,
    @Serializable(with = InstantSerializer::class) val calculatedAt: Instant? = null,
) {
    @Serializable
    enum class Status(val rawValue: String) {
        @SerialName("under") Under("under"),
        @SerialName("at") At("at"),
        @SerialName("over") Over("over"),
        @SerialName("not_configured") NotConfigured("not_configured"),
        @SerialName("incomplete") Incomplete("incomplete"),
        @SerialName("unavailable") Unavailable("unavailable");

        companion object {
            fun fromRaw(value: String?): Status? = entries.firstOrNull { it.rawValue == value }
        }
    }

    val isTracked: Boolean get() = status in listOf(Status.Under, Status.At, Status.Over)

    companion object {
        /**
         * `budget_status` → status. The server writes `complete` for a completed
         * job that did not go over, so "at budget" means "finished on budget".
         */
        fun status(fromServer: String?): Status = when (fromServer) {
            "over_budget" -> Status.Over
            "complete" -> Status.At
            "active" -> Status.Under
            "incomplete" -> Status.Incomplete
            "unavailable" -> Status.Unavailable
            else -> Status.NotConfigured
        }

        fun fromJobFeedRow(row: JSONValue?, includeBudgetHours: Boolean = false): BudgetProgress? {
            val id = row["id"].nonEmptyString ?: return null
            return BudgetProgress(
                jobId = id,
                percentUsed = row["budget_percent_used"].doubleValue,
                hoursUsed = row["used_minutes"].doubleValue?.let { it / 60 },
                budgetHours = if (includeBudgetHours) row["budget_minutes"].doubleValue?.let { it / 60 } else null,
                status = status(fromServer = row["budget_status"].stringValue),
                isComplete = row["status"].stringValue == "completed",
                calculatedAt = row["updated_at"].dateValue,
            )
        }
    }
}

/**
 * Colours and labels for a budget (`getBudgetProgressPresentation`).
 * Colours are `0xRRGGBB`.
 */
data class BudgetPresentation(
    val level: Level,
    val percentLabel: String,
    val fillPercent: Double,
    val colorHex: Long,
    val backgroundHex: Long,
) {
    enum class Level(val rawValue: String) {
        Loading("loading"), NotConfigured("notConfigured"), Incomplete("incomplete"), Unavailable("unavailable"),
        Under("under"), At("at"), Over("over");

        companion object {
            fun fromRaw(value: String?): Level? = entries.firstOrNull { it.rawValue == value }
        }
    }

    val statusLabel: String
        get() = when (level) {
            Level.Under -> "Under budget"
            Level.At -> "At budget"
            Level.Over -> "Over budget"
            Level.Loading -> "Loading budget"
            Level.NotConfigured -> "Budget pending"
            Level.Incomplete -> "Data incomplete"
            Level.Unavailable -> "Budget unavailable"
        }

    /** Bar and "hours left" colour. */
    val burnHex: Long
        get() = when (level) {
            Level.Over -> 0xc0432b
            Level.At -> 0x9a611f
            else -> 0x2f8d7f
        }

    companion object {
        /** `BudgetPresentation(progress)`. */
        operator fun invoke(progress: BudgetProgress?): BudgetPresentation {
            progress ?: return BudgetPresentation(Level.Loading, "—", 0.0, 0x8b9692, 0xeef1ef)
            val pct = max(0.0, progress.percentUsed ?: 0.0)
            return when (progress.status) {
                BudgetProgress.Status.NotConfigured -> BudgetPresentation(Level.NotConfigured, "—", 0.0, 0x6f7774, 0xeef1ef)
                BudgetProgress.Status.Incomplete -> BudgetPresentation(Level.Incomplete, "—", 0.0, 0x9a611f, 0xfff3df)
                BudgetProgress.Status.Unavailable -> BudgetPresentation(Level.Unavailable, "—", 0.0, 0x6f7774, 0xeef1ef)
                BudgetProgress.Status.Over -> {
                    val shown = max(101, pct.roundedSwift().toInt())
                    BudgetPresentation(Level.Over, "$shown%", 100.0, 0xc0432b, 0xfdecea)
                }
                BudgetProgress.Status.At -> BudgetPresentation(Level.At, "100%", 100.0, 0x9a611f, 0xfff3df)
                BudgetProgress.Status.Under -> {
                    val shown = min(99, pct.roundedSwift().toInt())
                    BudgetPresentation(Level.Under, "$shown%", min(100.0, pct), 0x2f8d7f, 0xe6f2f4)
                }
            }
        }
    }
}

/**
 * Budget hours derived from used hours and percent (`getBudgetHoursBreakdown`).
 * The budget in hours is derived, so it always agrees with the percentage.
 */
data class BudgetHoursBreakdown(
    val tracked: Boolean,
    val derivable: Boolean,
    val usedLabel: String?,
    val leftLabel: String?,
    val totalLabel: String?,
    val isOver: Boolean,
    val noHoursYet: Boolean,
    val percentUsed: Double?,
) {
    /** Tank footnote, e.g. `40h expected total · 75% used`. */
    fun footnote(loading: Boolean): String {
        if (loading) return "Loading budget…"
        val shown = "${(percentUsed ?: 0.0).roundedSwift().toInt()}%"
        totalLabel?.let { return "$it expected total · $shown used" }
        return "$shown of the labour budget used"
    }

    companion object {
        /** `BudgetHoursBreakdown(progress)`. */
        operator fun invoke(progress: BudgetProgress?): BudgetHoursBreakdown {
            val tracked = progress?.isTracked ?: false
            val hoursUsed = progress?.hoursUsed?.takeIf { it.isFinite() }
            val percent = progress?.percentUsed?.takeIf { it.isFinite() }
            val derivable = tracked && (hoursUsed ?: 0.0) > 0 && (percent ?: 0.0) > 0
            var leftLabel: String? = null
            var totalLabel: String? = null
            var isOver = false
            if (derivable && hoursUsed != null && percent != null) {
                val left = hoursUsed * (100 - percent) / percent
                leftLabel = HoursFormat.budgetValue(abs(left))
                totalLabel = HoursFormat.budgetValue(hoursUsed * 100 / percent)
                isOver = left < 0
            }
            return BudgetHoursBreakdown(
                tracked = tracked,
                derivable = derivable,
                usedLabel = hoursUsed?.let { HoursFormat.budgetValue(it) },
                leftLabel = leftLabel,
                totalLabel = totalLabel,
                isOver = isOver,
                noHoursYet = tracked && (hoursUsed ?: 0.0) == 0.0,
                percentUsed = percent,
            )
        }

        /** Number of lit segments in the 12-segment tank. */
        fun litSegments(percent: Double?, segments: Int = 12): Int {
            if (percent == null || !percent.isFinite()) return 0
            if (percent > 100) return segments
            val fraction = min(1.0, max(0.0, percent / 100))
            return min(segments, max(if (percent > 0) 1 else 0, (fraction * segments).roundedSwift().toInt()))
        }
    }
}
