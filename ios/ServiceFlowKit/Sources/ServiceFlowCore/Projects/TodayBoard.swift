import Foundation

/// Someone who has worked a job on the Today board.
public struct TodayPainter: Identifiable, Hashable, Sendable {
    public var id: String { userId }
    public var userId: String
    public var name: String
    /// Time on this job, all time.
    public var totalMinutes: Int
    /// First clock-in today, when they clocked in today.
    public var inTodayAt: Date?

    public var initials: String { Initials.of(name, fallback: "P") }
}

/// A job someone clocked in to today, with everyone who has worked it.
public struct TodayJob: Identifiable, Hashable, Sendable {
    public var id: String { project.id }
    public var project: Project
    /// The job's address, else where today's crew clocked in closest to it.
    public var coordinate: Coordinate?
    /// Clocked in today first, then by hours on the job.
    public var painters: [TodayPainter]
}

/// The managers' Today board, as on the website: the jobs someone clocked in
/// to today. Anyone who clocked in today counts, even after clocking out.
public enum TodayBoard {
    /// `entries`: every active or completed entry on the candidate jobs;
    /// `projects`: those jobs as the feed shows them (others are left out).
    public static func jobs(entries: [TimeEntry], projects: [Project], startOfDay: Date, now: Date) -> [TodayJob] {
        let isToday = { (entry: TimeEntry) in entry.isActive || entry.startedAt >= startOfDay }
        let byJob = Dictionary(grouping: entries) { $0.project.id }
        return projects.filter(\.isListable).compactMap { project -> TodayJob? in
            let list = byJob[project.id] ?? []
            let today = list.filter(isToday)
            guard !today.isEmpty else { return nil }

            var painters: [String: TodayPainter] = [:]
            for entry in list {
                let key = entry.userId.isEmpty ? entry.userName : entry.userId
                var painter = painters[key] ?? TodayPainter(userId: key, name: entry.userName, totalMinutes: 0, inTodayAt: nil)
                painter.totalMinutes += Int(entry.duration(at: now) / 60)
                if isToday(entry), painter.inTodayAt.map({ entry.startedAt < $0 }) ?? true { painter.inTodayAt = entry.startedAt }
                painters[key] = painter
            }
            let nearest = today.filter { $0.startedLocation != nil }
                .min { ($0.lastDistanceMeters ?? .infinity) < ($1.lastDistanceMeters ?? .infinity) }
            return TodayJob(
                project: project,
                coordinate: project.coordinate ?? nearest?.startedLocation?.coordinate,
                painters: painters.values.sorted { lhs, rhs in
                    if (lhs.inTodayAt != nil) != (rhs.inTodayAt != nil) { return lhs.inTodayAt != nil }
                    if lhs.totalMinutes != rhs.totalMinutes { return lhs.totalMinutes > rhs.totalMinutes }
                    return lhs.name.localizedCompare(rhs.name) == .orderedAscending
                }
            )
        }
        .sorted { $0.project.name.localizedCompare($1.project.name) == .orderedAscending }
    }

    /// People who clocked in today, across all jobs.
    public static func activeCount(_ jobs: [TodayJob]) -> Int {
        Set(jobs.flatMap { $0.painters.filter { $0.inTodayAt != nil }.map(\.userId) }).count
    }

    /// `3 painters on 2 jobs`.
    public static func summary(_ jobs: [TodayJob]) -> String {
        let people = activeCount(jobs)
        return "\(people) \(people == 1 ? "painter" : "painters") on \(jobs.count) \(jobs.count == 1 ? "job" : "jobs")"
    }

    /// `in at 7:43 a.m.`, or `in since Oct 30` for a shift left running from an earlier day.
    public static func inLabel(_ date: Date, startOfDay: Date) -> String {
        date < startOfDay
            ? "in since \(DateText.format(date, template: "MMMd", locale: DateText.canada))"
            : "in at \(DateText.canadianTime(date))"
    }

    /// `Labour budget · 18.3 of 67.3 h` and the percent used; nil without a budget.
    public static func budgetLine(_ progress: BudgetProgress?) -> (label: String, percent: Int)? {
        guard let budget = progress?.budgetHours, budget > 0 else { return nil }
        let used = progress?.hoursUsed ?? 0
        return (String(format: "Labour budget · %.1f of %.1f h", used, budget), Int((used / budget * 100).rounded()))
    }
}
