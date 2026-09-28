import ServiceFlowCore
import SwiftUI

/// Project Detail's Clock Ins tab: the job, its hours, the clock button,
/// photos, time by crew member and the task list.
struct ProjectDetailClockInsTab: View {
    let project: Project
    let title: String
    let model: ProjectDetailModel
    /// This job's entries (crew only get their own).
    let entries: [TimeEntry]
    let summaries: [PainterClockInSummary]
    let now: Date
    let onOpenMedia: () -> Void
    let onOverBudget: (OverBudgetPromptItem) -> Void

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker

    var body: some View {
        List {
            Section {
                infoRow
                if let shift = tracker.activeShift, shift.project.id == project.id, !tracker.isClockingOut {
                    currentRow(shift)
                }
            }

            Section { hoursPanel }

            ProjectDetailClockButton(project: project, title: title, onOverBudget: onOverBudget) {
                await model.refreshBudget(api: session.api)
            }

            Section {
                JobPhotosPanel(project: project, showCamera: false, onOpenAll: onOpenMedia)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            Section {
                if summaries.isEmpty {
                    ContentUnavailableView {
                        Label("No clock-ins yet", systemImage: "clock")
                    } description: {
                        Text("Time entries will appear here after the crew clocks into this project.")
                    }
                } else {
                    ForEach(summaries) { summary in
                        NavigationLink(value: ProjectDetailPainterRoute(userId: summary.userId)) {
                            ProjectDetailPainterRow(summary: summary)
                        }
                    }
                }
            } header: {
                crewHeader
            }

            Section {
                LabourTasksPanel(project: project, showHoursMeter: false, enabled: true)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            // Room above the floating camera button.
            Color.clear.frame(height: 60).listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(16)
        .refreshable { await model.refresh(api: session.api) }
    }

    private var infoRow: some View {
        HStack(spacing: 12) {
            Text(Initials.of(title, fallback: "P"))
                .font(.app(14, .semibold))
                .foregroundStyle(DetailPalette.brand)
                .frame(width: 42, height: 42)
                .background(DetailPalette.brand.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.app(16, .semibold)).lineLimit(1)
                Label(project.fullAddress ?? "No address on file", systemImage: "mappin")
                    .font(.app(13))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    private func currentRow(_ shift: TimeEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.fill")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(DetailPalette.brand, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Current clock-in · since \(DateText.time(shift.startedAt))")
                    .font(.app(13)).foregroundStyle(.secondary)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(DurationFormat.elapsedClock(shift.duration(at: context.date)))
                        .font(.app(22, .semibold)).monospacedDigit()
                }
            }
            Spacer(minLength: 0)
            Circle().fill(Color(hex: 0x27ae60)).frame(width: 10, height: 10)
        }
        .padding(.vertical, 2)
    }

    private var hoursPanel: some View {
        let me = session.user
        let isMine: (TimeEntry) -> Bool = { $0.userId == me.id || ($0.userEmail != nil && $0.userEmail == me.email) }
        let yourSeconds = entries.filter(isMine).reduce(0) { $0 + $1.duration(at: now) }
        let teamSeconds = entries.reduce(0) { $0 + $1.duration(at: now) }
        return BudgetHoursPanel(
            progress: model.shownBudget,
            loading: model.budgetLoading,
            yourHours: HoursFormat.fromMilliseconds(yourSeconds * 1000),
            secondaryLabel: session.isManager ? "Team total" : "Entries shown",
            secondaryValue: HoursFormat.fromMilliseconds(teamSeconds * 1000)
        )
        .padding(.vertical, 6)
    }

    private var crewHeader: some View {
        let days = ProjectClockIns.dayCount(summaries, userId: session.user.id)
        return HStack {
            Text(session.isManager ? "Hours by Crew" : "Your Clock-ins")
            Spacer()
            Text(session.isManager ? "\(summaries.count) crew" : "\(days) \(days == 1 ? "day" : "days")")
        }
    }
}
