import ServiceFlowCore
import SwiftUI

/// Clock In / Switch Job / Clock Out for the job on Project Detail, with the
/// message shown underneath when an action fails.
struct ProjectDetailClockButton: View {
    let project: Project
    let title: String
    /// The job went over budget with this clock-out.
    let onOverBudget: (OverBudgetPromptItem) -> Void
    /// Reload the job's budget after the hours changed.
    let onHoursChanged: () async -> Void

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker
    @State private var pending = false
    @State private var error: String?

    private enum Action {
        case clockIn, switchJob, clockOut

        var label: String {
            switch self {
            case .clockIn: return "Clock In"
            case .switchJob: return "Switch Job"
            case .clockOut: return "Clock Out"
            }
        }

        var icon: String {
            switch self {
            case .clockIn: return "play.fill"
            case .switchJob: return "arrow.left.arrow.right"
            case .clockOut: return "stop.circle.fill"
            }
        }
    }

    private var action: Action {
        guard let shift = tracker.activeShift else { return .clockIn }
        return shift.project.id == project.id && !tracker.isClockingOut ? .clockOut : .switchJob
    }

    var body: some View {
        Section {
            Button(action: run) {
                HStack(spacing: 8) {
                    if pending {
                        ProgressView().tint(.white)
                        Text("Working…")
                    } else {
                        Image(systemName: action.icon)
                        Text(action.label)
                    }
                }
                .font(.app(17, .semibold))
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(action == .clockOut ? Palette.red : DetailPalette.brand)
            .disabled(pending || tracker.isClockingOut)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        } footer: {
            if let feedback = tracker.notice?.message ?? error {
                Text(feedback).foregroundStyle(Palette.red).frame(maxWidth: .infinity)
            }
        }
    }

    private func run() {
        guard !pending else { return }
        let action = self.action
        pending = true
        error = nil
        tracker.clearNotice()
        Task {
            defer { pending = false }
            do {
                switch action {
                case .clockOut:
                    guard await session.clockOut(reason: .projectDetail) != nil else {
                        error = "Clock out could not complete. Try again."
                        return
                    }
                    await onHoursChanged()
                    if let hoursOver = await session.overBudgetHours(jobId: project.id) {
                        onOverBudget(OverBudgetPromptItem(jobId: project.id, projectName: title, hoursOver: hoursOver))
                    }
                case .switchJob:
                    guard try await session.switchProject(to: project) != nil else {
                        error = "Switch job could not complete. Try again."
                        return
                    }
                    await onHoursChanged()
                    session.showClockIn()
                case .clockIn:
                    try await session.clockIn(project)
                    await onHoursChanged()
                    session.showClockIn()
                }
            } catch {
                let message = error.localizedDescription
                self.error = message.isEmpty ? "Clock action could not complete. Try again." : message
            }
        }
    }
}
