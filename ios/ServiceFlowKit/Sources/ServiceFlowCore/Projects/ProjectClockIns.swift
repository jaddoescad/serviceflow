import Foundation

/// A painter's time on one job, for Project Detail's "Hours by Painter".
public struct PainterClockInSummary: Identifiable, Hashable, Sendable {
    public var id: String { userId }
    public var userId: String
    public var name: String
    public var isYou: Bool
    public var totalMinutes: Int
    public var clockInCount: Int
    public var onSiteCount: Int
    public var offSiteCount: Int
    public var mixedCount: Int
    public var unknownCount: Int
    public var days: [PainterDay]

    public var initials: String { Initials.of(name, fallback: "P") }
}

public struct PainterDay: Identifiable, Hashable, Sendable {
    public var id: String
    public var label: String
    public var dateLabel: String
    public var totalMinutes: Int
    public var entries: [TimeEntry]
}

public enum ProjectClockIns {
    /// Entries on `projectId` (the running shift included), de-duplicated,
    /// grouped by painter. Painters are keyed by user id, not name.
    public static func summaries(entries: [TimeEntry], activeShift: TimeEntry?, projectId: String, userId: String,
                                 now: Date, calendar: Calendar = .current) -> [PainterClockInSummary] {
        var seen = Set<String>()
        var relevant: [TimeEntry] = []
        for entry in (activeShift.map { [$0] } ?? []) + entries where entry.project.id == projectId {
            guard seen.isDisjoint(with: entry.identityKeys) else { continue }
            seen.formUnion(entry.identityKeys)
            relevant.append(entry)
        }
        let byUser = Dictionary(grouping: relevant) { $0.userId.isEmpty ? $0.userName : $0.userId }
        let todayKey = DayKey.of(now, calendar: calendar)

        return byUser.map { key, list in
            let sorted = list.sorted { $0.startedAt > $1.startedAt }
            var summary = PainterClockInSummary(
                userId: key, name: sorted.first?.userName ?? "Crew member", isYou: key == userId,
                totalMinutes: 0, clockInCount: sorted.count, onSiteCount: 0, offSiteCount: 0, mixedCount: 0, unknownCount: 0, days: []
            )
            for entry in sorted {
                summary.totalMinutes += Int(entry.duration(at: now) / 60)
                switch SegmentSummary(entry, now: now).status {
                case .onSite: summary.onSiteCount += 1
                case .offSite: summary.offSiteCount += 1
                case .mixed: summary.mixedCount += 1
                case .unavailable: summary.unknownCount += 1
                }
            }
            let byDay = Dictionary(grouping: sorted) { DayKey.of($0.startedAt, calendar: calendar) }
            summary.days = byDay.keys.sorted(by: >).map { dayKey in
                let dayEntries = byDay[dayKey] ?? []
                let noon = DayKey.noon(of: dayKey, calendar: calendar)
                return PainterDay(
                    id: dayKey,
                    label: dayKey == todayKey ? "Today" : DateText.format(noon, template: "EEEE"),
                    dateLabel: DateText.canadianShortDate(noon),
                    totalMinutes: dayEntries.reduce(0) { $0 + Int($1.duration(at: now) / 60) },
                    entries: dayEntries
                )
            }
            return summary
        }
        .sorted { lhs, rhs in
            if lhs.isYou != rhs.isYou { return lhs.isYou }
            return lhs.totalMinutes > rhs.totalMinutes
        }
    }

    /// Distinct local days with an entry by `userId` on the job.
    public static func dayCount(_ summaries: [PainterClockInSummary], userId: String) -> Int {
        summaries.first { $0.userId == userId }?.days.count ?? 0
    }
}

public enum Initials {
    /// First letters of the first two words, uppercased.
    public static func of(_ name: String?, fallback: String) -> String {
        let letters = (name ?? "").split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)
        let value = String(letters).uppercased()
        return value.isEmpty ? fallback : value
    }
}
