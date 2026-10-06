package com.serviceflow.core

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneId
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.FormatStyle
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

// MARK: Swift number and date semantics

/** Swift's `rounded()`: to nearest, halves away from zero (Kotlin's `round` is half-even). */
internal fun Double.roundedSwift(): Double {
    if (!isFinite()) return this
    val magnitude = abs(this)
    val whole = floor(magnitude)
    val rounded = if (magnitude - whole >= 0.5) whole + 1 else whole
    return if (this < 0) -rounded else rounded
}

/** `String(format: "%.Nf", value)` as C's printf writes it (exact binary value, halves to even). */
internal fun formatFixed(value: Double, decimals: Int): String {
    if (!value.isFinite()) return value.toString()
    return BigDecimal(value).setScale(decimals, RoundingMode.HALF_EVEN).toPlainString()
}

/** Seconds from [other] to this instant (Swift `timeIntervalSince`). */
fun Instant.timeIntervalSince(other: Instant): Double =
    (epochSecond - other.epochSecond).toDouble() + (nano - other.nano) / 1_000_000_000.0

/** Swift `addingTimeInterval`: the instant moved by [seconds]. */
fun Instant.addingTimeInterval(seconds: Double): Instant = plusNanos((seconds * 1_000_000_000.0).roundToLong())

val Instant.timeIntervalSince1970: Double get() = timeIntervalSince(Instant.EPOCH)

// MARK: Formatters

/** Hour formatters. Several exist on purpose; each screen uses a specific one. */
object HoursFormat {
    /** Budget values: `0h`, `9.5h`, `10h` (from 9.96), `123h`. Trailing zeros are dropped. */
    fun budgetValue(hours: Double): String? {
        if (!hours.isFinite() || hours < 0) return null
        val value = if (hours >= 100) hours.roundedSwift() else (hours * 10).roundedSwift() / 10
        return shortest(value) + "h"
    }

    /** Task panel and over-budget sheet: `15m` under an hour, else `1.0h`. */
    fun task(hours: Double?): String {
        val value = max(0.0, hours?.takeIf { it.isFinite() } ?: 0.0)
        if (value < 1) return "${(value * 60).roundedSwift().toInt()}m"
        return "${formatFixed(value, 1)}h"
    }

    /** Project detail fallback values: `12.0h`. */
    fun oneDecimal(hours: Double?, fallback: String = "0.0h"): String {
        if (hours == null || !hours.isFinite()) return fallback
        return "${formatFixed(hours, 1)}h"
    }

    /** Milliseconds as hours with one decimal: `3.5h`. */
    fun fromMilliseconds(ms: Double): String = "${formatFixed(max(0.0, ms) / 3_600_000, 1)}h"

    /** Shortest decimal representation, as JavaScript prints numbers. */
    internal fun shortest(value: Double): String {
        if (value == value.roundedSwift()) return value.toLong().toString()
        var text = formatFixed(value, 1)
        while (text.endsWith("0")) text = text.dropLast(1)
        if (text.endsWith(".")) text = text.dropLast(1)
        return text
    }
}

object DurationFormat {
    /** Active shift timer text. */
    data class ShiftTimer(val main: String, val seconds: String)

    /**
     * `7h 5m`, `0h 0m`: floored to the minute, no padding. [interval] is in
     * seconds; pass a Double (an Int argument selects the `minutes` overload).
     */
    fun hoursMinutes(interval: Double): String {
        val minutes = max(0, floor(interval / 60).toInt())
        return "${minutes / 60}h ${minutes % 60}m"
    }

    fun hoursMinutes(minutes: Int): String {
        val value = max(0, minutes)
        return "${value / 60}h ${value % 60}m"
    }

    /** Clock-in header: `7H 05M`. */
    fun headerHours(interval: Double): String {
        val minutes = max(0, floor(interval / 60).toInt())
        return "${minutes / 60}H " + String.format(Locale.ROOT, "%02dM", minutes % 60)
    }

    /** Active shift timer: main `02:07` and seconds `45`. Hours are not capped. */
    fun shiftTimer(interval: Double): ShiftTimer {
        val total = max(0, floor(interval).toInt())
        return ShiftTimer(
            String.format(Locale.ROOT, "%02d:%02d", total / 3600, (total % 3600) / 60),
            String.format(Locale.ROOT, "%02d", total % 60),
        )
    }

    /** `01:07:09`. */
    fun elapsedClock(interval: Double): String {
        val total = max(0, floor(interval).toInt())
        return String.format(Locale.ROOT, "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    /** Recording timer: `00:07 / 10:00`. */
    fun recording(seconds: Int, limit: Int = 600): String {
        val clamped = min(max(0, seconds), limit)
        return String.format(Locale.ROOT, "%02d:%02d / %02d:%02d", clamped / 60, clamped % 60, limit / 60, limit % 60)
    }
}

object DistanceFormat {
    /** `120 m`, `1.4 km`, `distance unknown`. */
    fun meters(meters: Double?): String {
        if (meters == null || !meters.isFinite()) return "distance unknown"
        if (meters < 1000) return "${max(0, meters.roundedSwift().toInt())} m"
        return "${formatFixed(meters / 1000, 1)} km"
    }
}

/**
 * Date and time text. The iOS app formats through `DateFormatter` templates
 * (ICU skeletons). Plain Java has no skeleton API before Java 19, so the
 * Android app should set [bestPattern] to
 * `android.text.format.DateFormat::getBestDateTimePattern`, which resolves the
 * same ICU skeletons. Without it, the templates the app uses are mapped to
 * equivalent English patterns.
 */
object DateText {
    /** Resolves a skeleton (`jmm`, `MMMdy`) to a pattern for a locale. */
    @Volatile
    var bestPattern: ((template: String, locale: Locale) -> String)? = null

    private val cache = ConcurrentHashMap<String, DateTimeFormatter>()

    internal fun formatter(template: String, locale: Locale, zone: ZoneId): DateTimeFormatter {
        val key = "$template|${locale.toLanguageTag()}|${zone.id}"
        return cache.getOrPut(key) {
            val pattern = bestPattern?.invoke(template, locale) ?: fallbackPattern(template, locale)
            DateTimeFormatter.ofPattern(pattern, locale).withZone(zone)
        }
    }

    private fun fallbackPattern(template: String, locale: Locale): String = when (template) {
        "jmm" -> if (uses24Hour(locale)) "HH:mm" else "h:mm a"
        "MMMdy" -> "MMM d, y"
        "EEEEMMMMdy" -> "EEEE, MMMM d, y"
        "EEEMMMdd" -> "EEE, MMM dd"
        "MMMdd" -> "MMM dd"
        "MMMd" -> "MMM d"
        else -> template
    }

    private fun uses24Hour(locale: Locale): Boolean {
        val pattern = runCatching {
            DateTimeFormatterBuilder.getLocalizedDateTimePattern(null, FormatStyle.SHORT, IsoChronology.INSTANCE, locale)
        }.getOrDefault("h:mm a")
        return 'H' in pattern || 'k' in pattern
    }

    fun format(
        date: Instant?, template: String, locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(), fallback: String = "--",
    ): String {
        date ?: return fallback
        return formatter(template, locale, zone).format(date)
    }

    val canada: Locale = Locale.forLanguageTag("en-CA")

    /** `7:05 AM` in the device locale. */
    fun time(date: Instant?, fallback: String = "--"): String = format(date, "jmm", fallback = fallback)

    /** `3:05 p.m.` (en_CA). */
    fun canadianTime(date: Instant?, fallback: String = "Recently"): String =
        format(date, "jmm", locale = canada, fallback = fallback)

    /** `Sep 3, 2026` (en_CA). */
    fun canadianShortDate(date: Instant?, fallback: String = ""): String =
        format(date, "MMMdy", locale = canada, fallback = fallback)

    /** `Friday, September 26, 2026` (en_CA). */
    fun canadianLongDate(date: Instant?, fallback: String = "Recently"): String =
        format(date, "EEEEMMMMdy", locale = canada, fallback = fallback)
}
