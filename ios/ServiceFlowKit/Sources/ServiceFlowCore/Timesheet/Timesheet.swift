import Foundation

/// A Monday–Sunday week in device-local time.
public struct PayPeriod: Hashable, Identifiable, Sendable {
    /// Local `yyyy-MM-dd` of the Monday.
    public var id: String
    public var start: Date
    public var end: Date
    public var label: String

    /// The current week and the two before it.
    public static func recent(now: Date, calendar: Calendar = .current, count: Int = 3) -> [PayPeriod] {
        let monday = startOfWeek(now, calendar: calendar)
        return (0..<count).compactMap { offset in
            guard let start = calendar.date(byAdding: .day, value: -7 * offset, to: monday),
                  let end = calendar.date(byAdding: .day, value: 6, to: start) else { return nil }
            let label = "\(DateText.format(start, template: "EEEMMMdd")) - \(DateText.format(end, template: "EEEMMMdd"))"
            return PayPeriod(id: DayKey.of(start, calendar: calendar), start: start, end: end, label: label)
        }
    }

    /// Monday at noon (noon avoids daylight-saving edge cases).
    static func startOfWeek(_ date: Date, calendar: Calendar) -> Date {
        let weekday = calendar.component(.weekday, from: date) // 1 = Sunday
        let diff = (weekday + 5) % 7
        let day = calendar.date(byAdding: .day, value: -diff, to: date) ?? date
        return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day) ?? day
    }

    public func contains(dayKey: String, calendar: Calendar = .current) -> Bool {
        guard let noon = DayKey.noon(of: dayKey, calendar: calendar) else { return false }
        return noon >= start && noon <= end
    }
}

public enum DayKey {
    public static func of(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    public static func noon(of key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }
}

/// Time on site, off site and not recorded within an entry.
public struct SegmentSummary: Equatable, Sendable {
    public enum Status: String, Sendable {
        case onSite = "On Site"
        case offSite = "Off Site"
        case mixed = "Mixed"
        case unavailable = "Location unavailable"
    }

    public var onSite: TimeInterval
    public var offSite: TimeInterval
    public var unknown: TimeInterval
    public var status: Status
    public var latestDistance: Double?

    public init(_ entry: TimeEntry, now: Date) {
        var onSite: TimeInterval = 0
        var offSite: TimeInterval = 0
        var unknown: TimeInterval = 0
        let segments = Self.segments(of: entry, now: now)
        for segment in segments {
            let length = max(0, (segment.endedAt ?? now).timeIntervalSince(segment.startedAt))
            switch segment.mode {
            case .onSite: onSite += length
            case .offSite: offSite += length
            case .unknown: unknown += length
            }
        }
        if onSite + offSite + unknown == 0 {
            let total = entry.duration(at: now)
            switch SiteMode(onSite: entry.onSite) {
            case .onSite: onSite = total
            case .offSite: offSite = total
            case .unknown: unknown = total
            }
        }
        self.onSite = onSite
        self.offSite = offSite
        self.unknown = unknown
        if onSite > 0, offSite > 0 { status = .mixed }
        else if onSite > 0 { status = .onSite }
        else if offSite > 0 { status = .offSite }
        else { status = .unavailable }
        latestDistance = segments.last(where: { $0.distanceMeters != nil })?.distanceMeters ?? entry.lastDistanceMeters
    }

    /// The entry's segments with a synthetic one when it has none; a running
    /// entry's last segment runs until now. Segments are cut to the entry's
    /// own times, so an edited start or end doesn't keep counting the time it removed.
    static func segments(of entry: TimeEntry, now: Date) -> [ShiftSegment] {
        var segments = entry.segments
        if segments.isEmpty {
            segments = [ShiftSegment(mode: SiteMode(onSite: entry.onSite), startedAt: entry.startedAt,
                                     endedAt: entry.endedAt, distanceMeters: entry.lastDistanceMeters)]
        }
        if entry.isActive {
            segments[segments.count - 1].endedAt = now
        } else {
            for index in segments.indices where segments[index].endedAt == nil {
                segments[index].endedAt = entry.endedAt ?? now
            }
        }
        let end = entry.isActive ? now : (entry.endedAt ?? now)
        return segments.compactMap { segment in
            var clipped = segment
            clipped.startedAt = max(segment.startedAt, entry.startedAt)
            clipped.endedAt = min(segment.endedAt ?? end, end)
            return clipped.endedAt! > clipped.startedAt ? clipped : nil
        }
    }

    public var distanceLabel: String {
        latestDistance.map { "\(DistanceFormat.meters($0)) from site" } ?? "distance unknown"
    }
}

/// One day in the timesheet list.
public struct TimesheetDay: Identifiable, Hashable, Sendable {
    public var id: String
    public var weekday: String
    public var date: String
    public var entries: [TimeEntry]
    public var totalMinutes: Int
    public var onSiteMinutes: Int
    public var offSiteMinutes: Int
    public var unknownMinutes: Int
    public var jobs: [String]

    public var isWorked: Bool { !entries.isEmpty }
    public var total: String { DurationFormat.hoursMinutes(minutes: totalMinutes) }

    /// `Sep 2, 2026`.
    public func fullDate(calendar: Calendar = .current) -> String {
        guard let noon = DayKey.noon(of: id, calendar: calendar) else { return date }
        return DateText.format(noon, template: "MMMdy")
    }

    static func empty(_ key: String, calendar: Calendar) -> TimesheetDay {
        let noon = DayKey.noon(of: key, calendar: calendar)
        return TimesheetDay(id: key, weekday: DateText.format(noon, template: "EEE"), date: DateText.format(noon, template: "MMMdd"),
                            entries: [], totalMinutes: 0, onSiteMinutes: 0, offSiteMinutes: 0, unknownMinutes: 0, jobs: [])
    }
}

public enum TimesheetBuilder {
    /// Every past or current day of `period`, newest first; days without an
    /// entry are included as missing days.
    public static func days(for period: PayPeriod, entries: [TimeEntry], now: Date, calendar: Calendar = .current) -> [TimesheetDay] {
        let grouped = Dictionary(grouping: entries) { DayKey.of($0.startedAt, calendar: calendar) }
        let todayKey = DayKey.of(now, calendar: calendar)
        var keys: [String] = []
        var cursor = period.end
        while cursor >= period.start.addingTimeInterval(-60) {
            let key = DayKey.of(cursor, calendar: calendar)
            if key <= todayKey { keys.append(key) }
            guard let previous = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = previous
        }
        for key in grouped.keys where period.contains(dayKey: key, calendar: calendar) && !keys.contains(key) {
            keys.append(key)
        }
        return keys.sorted(by: >).map { key in
            guard let dayEntries = grouped[key], !dayEntries.isEmpty else { return TimesheetDay.empty(key, calendar: calendar) }
            return worked(key, entries: dayEntries.sorted { $0.startedAt > $1.startedAt }, now: now, calendar: calendar)
        }
    }

    static func worked(_ key: String, entries: [TimeEntry], now: Date, calendar: Calendar) -> TimesheetDay {
        var day = TimesheetDay.empty(key, calendar: calendar)
        day.entries = entries
        var total: TimeInterval = 0
        var onSite: TimeInterval = 0
        var offSite: TimeInterval = 0
        var unknown: TimeInterval = 0
        var jobs: [String] = []
        for entry in entries {
            total += entry.duration(at: now)
            let summary = SegmentSummary(entry, now: now)
            onSite += summary.onSite
            offSite += summary.offSite
            unknown += summary.unknown
            if !jobs.contains(entry.project.name), jobs.count < 4 { jobs.append(entry.project.name) }
        }
        day.totalMinutes = Int(total / 60)
        day.onSiteMinutes = Int(onSite / 60)
        day.offSiteMinutes = Int(offSite / 60)
        day.unknownMinutes = Int(unknown / 60)
        day.jobs = jobs
        return day
    }

    public static func weekTotalMinutes(_ days: [TimesheetDay]) -> Int { days.reduce(0) { $0 + $1.totalMinutes } }
    public static func daysWorked(_ days: [TimesheetDay]) -> Int { days.filter(\.isWorked).count }

    /// `Original in 7:00 AM · original out 3:30 PM · edited 4:02 PM`, or nil.
    public static func originalTimeNote(entry: TimeEntry, startAt: Date, endAt: Date?) -> String? {
        let minute: (Date) -> Int = { Int(($0.timeIntervalSince1970 / 60).rounded()) }
        var parts: [String] = []
        let originalStart = entry.originalStartedAt
        if minute(originalStart) != minute(startAt) { parts.append("Original in \(DateText.time(originalStart))") }
        if !entry.isActive, let endAt, let originalEnd = entry.adjustmentHistory.first(where: { $0.previousEndedAt != nil })?.previousEndedAt,
           minute(originalEnd) != minute(endAt) {
            parts.append("original out \(DateText.time(originalEnd))")
        }
        guard !parts.isEmpty else { return nil }
        if let edited = entry.adjustmentHistory.last?.adjustedAt ?? entry.startEditedAt {
            parts.append("edited \(DateText.time(edited))")
        }
        return parts.joined(separator: " · ")
    }
}
