import ServiceFlowCore
import SwiftUI

/// The Team Map drawer's header: always visible, even collapsed. A summary
/// of the crew, or the selected person's name and when they were last seen.
struct TeamMapPanelHeader: View {
    let model: TeamMapModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let selected = model.selected {
                HStack(spacing: 8) {
                    TeamMapStateDot(status: selected)
                    Text(selected.displayName).font(.headline).lineLimit(1)
                    Spacer(minLength: 0)
                    if model.pointsLoading && model.points.isEmpty { ProgressView().controlSize(.small) }
                }
                Text("\(model.activity(for: selected)) · \(model.lastSeen(for: selected))")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            } else {
                HStack(spacing: 8) {
                    Text("Crew").font(.headline)
                    Spacer(minLength: 0)
                    if model.loading && model.statuses.isEmpty { ProgressView().controlSize(.small) }
                }
                Text(summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color(hex: 0x87491e))
                    .lineLimit(2)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private var summary: String {
        let clockedIn = model.statuses.filter(\.isClockedIn).count
        let crew = model.statuses.count
        if model.loading && crew == 0 { return "Loading team locations…" }
        if crew == 0 { return "No tracking records yet" }
        return "\(clockedIn) clocked in · \(crew) crew"
    }
}

/// The Team Map drawer's body: the crew list, or the selected person's day,
/// plus the "not live" note.
struct TeamMapPanelContent: View {
    let model: TeamMapModel
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Group {
                if model.loading && model.statuses.isEmpty {
                    ProgressView("Loading team locations…")
                        .frame(maxWidth: .infinity, minHeight: 150)
                } else if let selected = model.selected {
                    selectedSummary(selected).padding(.top, 12)
                } else if model.statuses.isEmpty {
                    ContentUnavailableView {
                        Label("No tracking records yet", systemImage: "mappin.and.ellipse")
                    } description: {
                        Text("Records appear after your crew clock in with this version.")
                    }
                    .frame(maxWidth: .infinity, minHeight: 150)
                } else {
                    crewList
                }
            }

            Text(TeamMapText.notLiveNote)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 16)
        }
    }

    private var crewList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Tap a crew member to see where they were recorded today.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 4)
            ForEach(model.cards) { status in
                Button { onSelect(status.employeeId) } label: { crewRow(status) }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                if status.employeeId != model.cards.last?.employeeId {
                    Divider().padding(.leading, 66)
                }
            }
        }
    }

    private func crewRow(_ status: TeamMemberStatus) -> some View {
        HStack(spacing: 12) {
            Text(status.initials)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(Palette.green, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(status.displayName).font(.body.weight(.semibold)).foregroundStyle(.primary).lineLimit(1)
                    TeamMapStateDot(status: status)
                }
                Text(model.activity(for: status)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Text(model.lastSeen(for: status))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(status.isClockedIn ? Palette.teal : Color.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    private func selectedSummary(_ status: TeamMemberStatus) -> some View {
        let clockedIn = model.points.first { $0.eventType == LocationEventType.clockIn.rawValue }
        let lastSeen = model.points.last?.capturedAt ?? status.lastLocationAt
        return VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    summaryCell("Clocked in", clockedIn.map { DateText.time($0.capturedAt) } ?? "—")
                    summaryCell("Last seen", lastSeen.map { DateText.time($0) } ?? "—")
                }
                GridRow {
                    summaryCell("Records", TeamMapText.recordCount(model.points.count))
                    summaryCell("Job", status.jobName ?? "Not assigned")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    private func summaryCell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold)).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Clocked in: teal. Clocked out: grey. Clocked in with no location: grey ring.
struct TeamMapStateDot: View {
    var status: TeamMemberStatus

    var body: some View {
        switch status.state {
        case .clockedIn:
            Circle().fill(Palette.teal).frame(width: 8, height: 8)
        case .clockedOut:
            Circle().fill(Palette.muted).frame(width: 8, height: 8)
        case .noLocation:
            Circle().strokeBorder(Palette.muted, lineWidth: 1.5).frame(width: 8, height: 8)
        }
    }
}
