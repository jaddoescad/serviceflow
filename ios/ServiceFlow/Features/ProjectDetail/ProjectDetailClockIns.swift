import ServiceFlowCore
import SwiftUI

/// Location status of one clock-in, as shown on Project Detail.
enum ProjectDetailSiteStatus {
    case on, off, mixed, unknown

    init(_ status: SegmentSummary.Status) {
        switch status {
        case .onSite: self = .on
        case .offSite: self = .off
        case .mixed: self = .mixed
        case .unavailable: self = .unknown
        }
    }

    var label: String {
        switch self {
        case .on: return "On Site"
        case .off: return "Off Site"
        case .mixed: return "Mixed location"
        case .unknown: return "Location unavailable"
        }
    }

    var color: Color {
        switch self {
        case .on: return Color(hex: 0x2b8496)
        case .off: return Color(hex: 0xc0432b)
        case .mixed: return Color(hex: 0x9a611f)
        case .unknown: return Color(hex: 0x6f7774)
        }
    }

    var background: Color {
        switch self {
        case .on: return Color(hex: 0xe6f2f4)
        case .off: return Color(hex: 0xfbecea)
        case .mixed: return Color(hex: 0xfff3df)
        case .unknown: return Color(hex: 0xeef1ef)
        }
    }
}

/// A 3×3 dot between meta items.
struct ProjectDetailDot: View {
    var body: some View {
        Circle().fill(DetailPalette.subtle).frame(width: 3, height: 3)
    }
}

/// Initials in a circle; brand-coloured for you.
struct ProjectDetailAvatar: View {
    var initials: String
    var isYou: Bool
    var size: CGFloat
    var fontSize: CGFloat

    var body: some View {
        Text(initials)
            .text(fontSize, .heavy, isYou ? .white : DetailPalette.navy, tracking: 0.4)
            .frame(width: size, height: size)
            .background(isYou ? DetailPalette.brand : Color(hex: 0xeef1f4), in: Circle())
    }
}

/// One person's row in "Hours by Crew" (the label of a navigation link).
struct ProjectDetailPainterRow: View {
    var summary: PainterClockInSummary

    var body: some View {
        HStack(spacing: 12) {
            ProjectDetailAvatar(initials: summary.initials, isYou: summary.isYou, size: 34, fontSize: 12)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(summary.name).font(.app(15, .semibold)).lineLimit(1)
                    if summary.isYou {
                        Text("You")
                            .font(.app(11, .semibold))
                            .foregroundStyle(DetailPalette.brand)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(DetailPalette.brand.opacity(0.12), in: Capsule())
                    }
                    Spacer(minLength: 4)
                    Text(DurationFormat.hoursMinutes(minutes: summary.totalMinutes))
                        .font(.app(15, .semibold)).monospacedDigit()
                }
                ProjectDetailWrap(spacing: 8) {
                    ForEach(Array(metaItems.enumerated()), id: \.offset) { index, item in
                        if index > 0 { ProjectDetailDot() }
                        HStack(spacing: 4) {
                            if let dot = item.dot { Circle().fill(dot).frame(width: 6, height: 6) }
                            Text(item.text).font(.app(12, item.weight)).foregroundStyle(item.color)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private struct MetaItem {
        var text: String
        var color: Color
        var weight: Font.Weight
        var dot: Color?
    }

    private var metaItems: [MetaItem] {
        var items = [MetaItem(text: "\(summary.clockInCount) \(summary.clockInCount == 1 ? "clock-in" : "clock-ins")",
                              color: .secondary, weight: .regular, dot: nil)]
        if summary.onSiteCount > 0 {
            items.append(MetaItem(text: "\(summary.onSiteCount) On Site", color: DetailPalette.brand, weight: .semibold, dot: DetailPalette.brand))
        }
        if summary.offSiteCount > 0 {
            let red = Color(hex: 0xc0432b)
            items.append(MetaItem(text: "\(summary.offSiteCount) Off Site", color: red, weight: .semibold, dot: red))
        }
        if summary.mixedCount > 0 {
            items.append(MetaItem(text: "\(summary.mixedCount) Mixed", color: Color(hex: 0x9a611f), weight: .semibold, dot: nil))
        }
        if summary.unknownCount > 0 {
            items.append(MetaItem(text: "\(summary.unknownCount) Location unavailable", color: .secondary, weight: .regular, dot: nil))
        }
        return items
    }
}

/// One person's clock-ins on the job, day by day (pushed).
struct ProjectDetailPainterDetail: View {
    var summary: PainterClockInSummary
    var now: Date

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    ProjectDetailAvatar(initials: summary.initials, isYou: summary.isYou, size: 44, fontSize: 15)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(summary.name + (summary.isYou ? " (You)" : "")).font(.app(17, .semibold)).lineLimit(1)
                        Text(metaLine).font(.app(12)).foregroundStyle(.secondary).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(DurationFormat.hoursMinutes(minutes: summary.totalMinutes))
                        .font(.app(17, .semibold)).foregroundStyle(DetailPalette.navy).monospacedDigit()
                }
                .padding(.vertical, 4)
            }

            ForEach(summary.days) { day in
                Section {
                    ForEach(day.entries, id: \.localId) { entry in
                        if summary.isYou {
                            NavigationLink(value: ProjectDetailEditRoute(entryId: entry.localId)) {
                                ProjectDetailClockInRow(entry: entry, now: now)
                            }
                        } else {
                            ProjectDetailClockInRow(entry: entry, now: now)
                        }
                    }
                } header: {
                    HStack {
                        Text("\(day.label), \(day.dateLabel)")
                        Spacer()
                        Text(DurationFormat.hoursMinutes(minutes: day.totalMinutes)).monospacedDigit()
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(summary.isYou ? "Your Clock-ins" : summary.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var metaLine: String {
        var parts = ["\(summary.clockInCount) \(summary.clockInCount == 1 ? "clock-in" : "clock-ins")"]
        if summary.onSiteCount > 0 { parts.append("\(summary.onSiteCount) on site") }
        if summary.offSiteCount > 0 { parts.append("\(summary.offSiteCount) off site") }
        if summary.mixedCount > 0 { parts.append("\(summary.mixedCount) mixed") }
        if summary.unknownCount > 0 { parts.append("\(summary.unknownCount) location unavailable") }
        return parts.joined(separator: " · ")
    }
}

/// A clock-in: times, location status and GPS breakdown.
struct ProjectDetailClockInRow: View {
    var entry: TimeEntry
    var now: Date

    var body: some View {
        let summary = SegmentSummary(entry, now: now)
        let status = ProjectDetailSiteStatus(summary.status)
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 5) {
                timeLine
                HStack(spacing: 5) {
                    Circle().fill(status.color).frame(width: 6, height: 6)
                    Text(status.label).font(.app(11, .semibold)).foregroundStyle(status.color)
                    if let distance = summary.latestDistance {
                        Text("· \(DistanceFormat.meters(distance)) from site").font(.app(11, .semibold)).foregroundStyle(status.color)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(status.background, in: Capsule())
                if let breakdown = gpsBreakdown(summary) {
                    Text(breakdown).font(.app(11)).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(DurationFormat.hoursMinutes(entry.duration(at: now))).font(.app(14, .semibold)).monospacedDigit()
        }
        .padding(.vertical, 3)
    }

    private var timeLine: some View {
        let end = entry.isActive ? "Now" : DateText.time(entry.endedAt)
        return (
            Text(DateText.time(entry.startedAt)).font(.app(14, .semibold))
                + Text(" \(entry.startedLocation == nil ? "Manual" : "GPS")").font(.app(12)).foregroundColor(.secondary)
                + Text("  –  ").font(.app(14)).foregroundColor(.secondary)
                + Text(end).font(.app(14, .semibold))
                + Text(" \(entry.lastLocation == nil ? "Manual" : "GPS")").font(.app(12)).foregroundColor(.secondary)
        )
        .foregroundColor(DetailPalette.brand)
        .lineLimit(1)
    }

    /// Shown when more than one of on site / off site / not recorded has time.
    private func gpsBreakdown(_ summary: SegmentSummary) -> String? {
        let buckets = [(summary.onSite, "on site"), (summary.offSite, "off site"), (summary.unknown, "location unavailable")]
            .filter { $0.0 >= 60 }
        guard buckets.count > 1 else { return nil }
        return (["GPS breakdown"] + buckets.map { "\(DurationFormat.hoursMinutes($0.0)) \($0.1)" }).joined(separator: " · ")
    }
}

/// A simple wrapping row for meta items separated by dots.
struct ProjectDetailWrap: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * 4
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
                x += size.width + spacing
            }
            y += row.height + 4
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let extra = rows[rows.count - 1].indices.isEmpty ? size.width : size.width + spacing
            if rows[rows.count - 1].width + extra > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            let isFirst = rows[rows.count - 1].indices.isEmpty
            rows[rows.count - 1].indices.append(index)
            rows[rows.count - 1].width += isFirst ? size.width : size.width + spacing
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
