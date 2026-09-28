import ServiceFlowCore
import SwiftUI

/// The frosted panel at the bottom of the Team Map: the crew list, or the
/// selected person's day, plus the "not live" note.
struct TeamMapPanel: View {
    let model: TeamMapModel
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(.secondary.opacity(0.4)).frame(width: 36, height: 5)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
                .padding(.bottom, 6)
                .accessibilityHidden(true)

            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color(hex: 0x87491e))
                    .lineLimit(2)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 6)
            }

            Group {
                if model.loading && model.statuses.isEmpty {
                    ProgressView("Loading team locations…")
                        .frame(maxWidth: .infinity, minHeight: 150)
                } else if let selected = model.selected {
                    selectedSummary(selected)
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
                .padding(.top, 8)
                .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity)
        .background(.regularMaterial, in: UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 8, y: -2)
    }

    private var crewList: some View {
        List {
            Section {
                ForEach(model.cards) { status in
                    Button { onSelect(status.employeeId) } label: { crewRow(status) }
                        .listRowBackground(Color.clear)
                }
            } header: {
                Text("Tap a crew member to see where they were recorded today.")
                    .textCase(nil)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .frame(height: 230)
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
            HStack(spacing: 7) {
                TeamMapStateDot(status: status)
                Text("\(model.activity(for: status)) · \(model.lastSeen(for: status))")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                if model.pointsLoading && model.points.isEmpty { ProgressView().controlSize(.small) }
            }
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
