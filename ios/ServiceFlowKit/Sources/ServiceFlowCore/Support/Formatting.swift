import Foundation

/// Hour formatters. Several exist on purpose; each screen uses a specific one.
public enum HoursFormat {
    /// Budget values: `0h`, `9.5h`, `10h` (from 9.96), `123h`. Trailing zeros are dropped.
    public static func budgetValue(_ hours: Double) -> String? {
        guard hours.isFinite, hours >= 0 else { return nil }
        let value = hours >= 100 ? hours.rounded() : (hours * 10).rounded() / 10
        return shortest(value) + "h"
    }

    /// Task panel and over-budget sheet: `15m` under an hour, else `1.0h`.
    public static func task(_ hours: Double?) -> String {
        let value = max(0, hours.flatMap { $0.isFinite ? $0 : nil } ?? 0)
        if value < 1 { return "\(Int((value * 60).rounded()))m" }
        return String(format: "%.1fh", value)
    }

    /// Project detail fallback values: `12.0h`.
    public static func oneDecimal(_ hours: Double?, fallback: String = "0.0h") -> String {
        guard let hours, hours.isFinite else { return fallback }
        return String(format: "%.1fh", hours)
    }

    /// Milliseconds as hours with one decimal: `3.5h`.
    public static func fromMilliseconds(_ ms: Double) -> String {
        String(format: "%.1fh", max(0, ms) / 3_600_000)
    }

    /// Shortest decimal representation, as JavaScript prints numbers.
    static func shortest(_ value: Double) -> String {
        if value == value.rounded() { return String(Int64(value)) }
        var text = String(format: "%.1f", value)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }
}

public enum DurationFormat {
    /// `7h 5m`, `0h 0m`: floored to the minute, no padding.
    public static func hoursMinutes(_ interval: TimeInterval) -> String {
        let minutes = max(0, Int((interval / 60).rounded(.down)))
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    public static func hoursMinutes(minutes: Int) -> String {
        let minutes = max(0, minutes)
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    /// Clock-in header: `7H 05M`.
    public static func headerHours(_ interval: TimeInterval) -> String {
        let minutes = max(0, Int((interval / 60).rounded(.down)))
        return "\(minutes / 60)H " + String(format: "%02dM", minutes % 60)
    }

    /// Active shift timer: main `02:07` and seconds `45`. Hours are not capped.
    public static func shiftTimer(_ interval: TimeInterval) -> (main: String, seconds: String) {
        let total = max(0, Int(interval.rounded(.down)))
        return (String(format: "%02d:%02d", total / 3600, (total % 3600) / 60), String(format: "%02d", total % 60))
    }

    /// `01:07:09`.
    public static func elapsedClock(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval.rounded(.down)))
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    /// Recording timer: `00:07 / 10:00`.
    public static func recording(seconds: Int, limit: Int = 600) -> String {
        let clamped = min(max(0, seconds), limit)
        return String(format: "%02d:%02d / %02d:%02d", clamped / 60, clamped % 60, limit / 60, limit % 60)
    }
}

public enum DistanceFormat {
    /// `120 m`, `1.4 km`, `distance unknown`.
    public static func meters(_ meters: Double?) -> String {
        guard let meters, meters.isFinite else { return "distance unknown" }
        if meters < 1000 { return "\(max(0, Int(meters.rounded()))) m" }
        return String(format: "%.1f km", meters / 1000)
    }
}

/// Date and time text. The RN app formats through `Intl`, which on iOS uses
/// the same ICU patterns as `DateFormatter` templates.
public enum DateText {
    private static var cache: [String: DateFormatter] = [:]
    private static let lock = NSLock()

    static func formatter(template: String, locale: Locale, timeZone: TimeZone) -> DateFormatter {
        let key = "\(template)|\(locale.identifier)|\(timeZone.identifier)"
        lock.lock(); defer { lock.unlock() }
        if let cached = cache[key] { return cached }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        cache[key] = formatter
        return formatter
    }

    public static func format(_ date: Date?, template: String, locale: Locale = .current,
                              timeZone: TimeZone = .current, fallback: String = "--") -> String {
        guard let date else { return fallback }
        return formatter(template: template, locale: locale, timeZone: timeZone).string(from: date)
    }

    public static let canada = Locale(identifier: "en_CA")

    /// `7:05 AM` in the device locale.
    public static func time(_ date: Date?, fallback: String = "--") -> String {
        format(date, template: "jmm", fallback: fallback)
    }

    /// `3:05 p.m.` (en_CA).
    public static func canadianTime(_ date: Date?, fallback: String = "Recently") -> String {
        format(date, template: "jmm", locale: canada, fallback: fallback)
    }

    /// `Sep 3, 2026` (en_CA).
    public static func canadianShortDate(_ date: Date?, fallback: String = "") -> String {
        format(date, template: "MMMdy", locale: canada, fallback: fallback)
    }

    /// `Friday, September 26, 2026` (en_CA).
    public static func canadianLongDate(_ date: Date?, fallback: String = "Recently") -> String {
        format(date, template: "EEEEMMMMdy", locale: canada, fallback: fallback)
    }
}
