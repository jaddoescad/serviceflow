import Foundation

/// Labour-budget progress for a job, from `job_feed`.
public struct BudgetProgress: Codable, Hashable, Sendable {
    public enum Status: String, Codable, Sendable {
        case under, at, over
        case notConfigured = "not_configured"
        case incomplete, unavailable
    }

    public var jobId: String
    public var percentUsed: Double?
    public var hoursUsed: Double?
    public var budgetHours: Double?
    public var status: Status
    public var isComplete: Bool
    public var calculatedAt: Date?

    public init(jobId: String, percentUsed: Double?, hoursUsed: Double?, budgetHours: Double? = nil,
                status: Status, isComplete: Bool = false, calculatedAt: Date? = nil) {
        self.jobId = jobId
        self.percentUsed = percentUsed
        self.hoursUsed = hoursUsed
        self.budgetHours = budgetHours
        self.status = status
        self.isComplete = isComplete
        self.calculatedAt = calculatedAt
    }

    /// `budget_status` → status. The server writes `complete` for a completed
    /// job that did not go over, so "at budget" means "finished on budget".
    public static func status(fromServer value: String?) -> Status {
        switch value {
        case "over_budget": return .over
        case "complete": return .at
        case "active": return .under
        case "incomplete": return .incomplete
        case "unavailable": return .unavailable
        default: return .notConfigured
        }
    }

    public init?(jobFeedRow row: JSONValue, includeBudgetHours: Bool = false) {
        guard let id = row["id"]?.nonEmptyString else { return nil }
        self.init(
            jobId: id,
            percentUsed: row["budget_percent_used"]?.doubleValue,
            hoursUsed: row["used_minutes"]?.doubleValue.map { $0 / 60 },
            budgetHours: includeBudgetHours ? row["budget_minutes"]?.doubleValue.map { $0 / 60 } : nil,
            status: BudgetProgress.status(fromServer: row["budget_status"]?.stringValue),
            isComplete: row["status"]?.stringValue == "completed",
            calculatedAt: row["updated_at"]?.dateValue
        )
    }

    public var isTracked: Bool { [.under, .at, .over].contains(status) }
}

/// Colours and labels for a budget (`getBudgetProgressPresentation`).
public struct BudgetPresentation: Equatable, Sendable {
    public enum Level: String, Sendable { case loading, notConfigured, incomplete, unavailable, under, at, over }

    public var level: Level
    public var percentLabel: String
    public var fillPercent: Double
    public var colorHex: UInt32
    public var backgroundHex: UInt32

    public init(_ progress: BudgetProgress?) {
        guard let progress else {
            self = .init(level: .loading, percentLabel: "—", fillPercent: 0, colorHex: 0x8b9692, backgroundHex: 0xeef1ef)
            return
        }
        let pct = max(0, progress.percentUsed ?? 0)
        switch progress.status {
        case .notConfigured:
            self = .init(level: .notConfigured, percentLabel: "—", fillPercent: 0, colorHex: 0x6f7774, backgroundHex: 0xeef1ef)
        case .incomplete:
            self = .init(level: .incomplete, percentLabel: "—", fillPercent: 0, colorHex: 0x9a611f, backgroundHex: 0xfff3df)
        case .unavailable:
            self = .init(level: .unavailable, percentLabel: "—", fillPercent: 0, colorHex: 0x6f7774, backgroundHex: 0xeef1ef)
        case .over:
            let shown = max(101, Int(pct.rounded()))
            self = .init(level: .over, percentLabel: "\(shown)%", fillPercent: 100, colorHex: 0xc0432b, backgroundHex: 0xfdecea)
        case .at:
            self = .init(level: .at, percentLabel: "100%", fillPercent: 100, colorHex: 0x9a611f, backgroundHex: 0xfff3df)
        case .under:
            let shown = min(99, Int(pct.rounded()))
            self = .init(level: .under, percentLabel: "\(shown)%", fillPercent: min(100, pct), colorHex: 0x2f8d7f, backgroundHex: 0xe6f2f4)
        }
    }

    init(level: Level, percentLabel: String, fillPercent: Double, colorHex: UInt32, backgroundHex: UInt32) {
        self.level = level
        self.percentLabel = percentLabel
        self.fillPercent = fillPercent
        self.colorHex = colorHex
        self.backgroundHex = backgroundHex
    }

    public var statusLabel: String {
        switch level {
        case .under: return "Under budget"
        case .at: return "At budget"
        case .over: return "Over budget"
        case .loading: return "Loading budget"
        case .notConfigured: return "Budget pending"
        case .incomplete: return "Data incomplete"
        case .unavailable: return "Budget unavailable"
        }
    }

    /// Bar and "hours left" colour.
    public var burnHex: UInt32 {
        switch level {
        case .over: return 0xc0432b
        case .at: return 0x9a611f
        default: return 0x2f8d7f
        }
    }
}

/// Budget hours derived from used hours and percent (`getBudgetHoursBreakdown`).
/// The budget in hours is derived, so it always agrees with the percentage.
public struct BudgetHoursBreakdown: Equatable, Sendable {
    public var tracked: Bool
    public var derivable: Bool
    public var usedLabel: String?
    public var leftLabel: String?
    public var totalLabel: String?
    public var isOver: Bool
    public var noHoursYet: Bool
    public var percentUsed: Double?

    public init(_ progress: BudgetProgress?) {
        let tracked = progress?.isTracked ?? false
        let hoursUsed = progress?.hoursUsed.flatMap { $0.isFinite ? $0 : nil }
        let percent = progress?.percentUsed.flatMap { $0.isFinite ? $0 : nil }
        let derivable = tracked && (hoursUsed ?? 0) > 0 && (percent ?? 0) > 0
        self.tracked = tracked
        self.derivable = derivable
        self.percentUsed = percent
        usedLabel = hoursUsed.flatMap(HoursFormat.budgetValue)
        if derivable, let hoursUsed, let percent {
            let left = hoursUsed * (100 - percent) / percent
            leftLabel = HoursFormat.budgetValue(abs(left))
            totalLabel = HoursFormat.budgetValue(hoursUsed * 100 / percent)
            isOver = left < 0
        } else {
            leftLabel = nil
            totalLabel = nil
            isOver = false
        }
        noHoursYet = tracked && (hoursUsed ?? 0) == 0
    }

    /// Number of lit segments in the 12-segment tank.
    public static func litSegments(percent: Double?, segments: Int = 12) -> Int {
        guard let percent, percent.isFinite else { return 0 }
        if percent > 100 { return segments }
        let fraction = min(1, max(0, percent / 100))
        return min(segments, max(percent > 0 ? 1 : 0, Int((fraction * Double(segments)).rounded())))
    }

    /// Tank footnote, e.g. `40h expected total · 75% used`.
    public func footnote(loading: Bool) -> String {
        if loading { return "Loading budget…" }
        let shown = "\(Int((percentUsed ?? 0).rounded()))%"
        if let totalLabel { return "\(totalLabel) expected total · \(shown) used" }
        return "\(shown) of the labour budget used"
    }
}
