import ServiceFlowCore
import SwiftUI

/// The Timesheet's own palette (it differs from the app palette on purpose).
enum TimesheetColors {
    static let green = Color(hex: 0x173f37)
    static let teal = Color(hex: 0x2f8d7f)
    static let tealSoft = Color(hex: 0xe6f3f0)
    static let tealInk = Color(hex: 0x1e6b60)
    static let surface = Color.white
    static let divider = Color(hex: 0xeef1f2)
    static let ink = Color(hex: 0x10222b)
    static let inkSoft = Color(hex: 0x3c4c54)
    static let red = Color(hex: 0xd24a4a)
    static let redInk = Color(hex: 0xa83838)
    static let redBg = Color(hex: 0xfdecec)
    static let redBorder = Color(hex: 0xf3c8c8)
    static let bg = Color(hex: 0xf4f6f7)
    static let border = Color(hex: 0xe2e6e8)
    static let muted = Color(hex: 0x6b7a7e)
    static let summaryLabel = Color(hex: 0xa8c7c0)
    static let greySoft = Color(hex: 0xeef1f3)
    static let unknownBg = Color(hex: 0xeef1ef)
}

/// Icon and colours for an entry's location status.
struct TimesheetStatusStyle {
    var icon: String
    var circle: Color
    var pill: Color
    var dot: Color
    var text: Color

    init(_ status: SegmentSummary.Status) {
        switch status {
        case .onSite:
            self.init(icon: "hammer.fill", circle: TimesheetColors.teal, pill: TimesheetColors.tealSoft,
                      dot: TimesheetColors.teal, text: TimesheetColors.tealInk)
        case .mixed:
            self.init(icon: "arrow.left.arrow.right", circle: TimesheetColors.teal, pill: TimesheetColors.tealSoft,
                      dot: TimesheetColors.teal, text: TimesheetColors.tealInk)
        case .offSite:
            self.init(icon: "car.fill", circle: TimesheetColors.inkSoft, pill: TimesheetColors.redBg,
                      dot: TimesheetColors.red, text: TimesheetColors.redInk)
        case .unavailable:
            self.init(icon: "questionmark", circle: TimesheetColors.muted, pill: TimesheetColors.unknownBg,
                      dot: TimesheetColors.muted, text: TimesheetColors.inkSoft)
        }
    }

    init(icon: String, circle: Color, pill: Color, dot: Color, text: Color) {
        self.icon = icon
        self.circle = circle
        self.pill = pill
        self.dot = dot
        self.text = text
    }
}

/// Display values for one clock-in on the Timesheet.
struct TimesheetEntryInfo {
    var job: String
    var address: String
    var start: String
    var startSource: String
    var end: String
    var endSource: String
    var duration: String
    var summary: SegmentSummary

    init(_ entry: TimeEntry, now: Date) {
        job = entry.project.name
        address = entry.project.fullAddress ?? "No address on file"
        start = DateText.time(entry.startedAt)
        startSource = entry.startedLocation != nil ? "GPS" : "Manual"
        end = entry.isActive ? "Now" : DateText.time(entry.endedAt)
        endSource = entry.lastLocation != nil ? "GPS" : "Manual"
        duration = DurationFormat.hoursMinutes(entry.duration(at: now))
        summary = SegmentSummary(entry, now: now)
    }

    /// `On Site · 42 m from site`.
    var statusLine: String { "\(summary.status.rawValue) · \(summary.distanceLabel)" }
}

/// Uppercased section label used across the Timesheet.
struct TimesheetSectionLabel: View {
    var text: String
    var body: some View {
        Text(text.uppercased()).text(12, .heavy, TimesheetColors.muted, tracking: 0.8)
    }
}
