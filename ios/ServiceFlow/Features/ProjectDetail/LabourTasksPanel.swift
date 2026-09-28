import ServiceFlowCore
import SwiftUI

/// The job's task checklist (Project Detail and the Clock In screen).
struct LabourTasksPanel: View {
    let project: Project
    let showHoursMeter: Bool
    let enabled: Bool

    @Environment(SessionContext.self) private var session
    @State private var model: LabourTasksModel

    init(project: Project, showHoursMeter: Bool, enabled: Bool) {
        self.project = project
        self.showHoursMeter = showHoursMeter
        self.enabled = enabled
        _model = State(initialValue: LabourTasksModel(jobId: project.id))
    }

    private var active: Bool { enabled && !project.isLead && !project.id.isEmpty }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 6)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .task(id: active) {
                guard active else { return }
                model.start(session: session, includeBudget: showHoursMeter)
                await model.refresh(silent: false)
                // Realtime changes refresh right away; the 30 s poll covers a dropped connection.
                let channel = await session.api.watchTasks(jobId: project.id) { [model] in
                    Task { @MainActor in model.scheduleRefresh() }
                }
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    guard !Task.isCancelled else { break }
                    await model.refresh(silent: true)
                }
                await session.api.stopWatching(channel)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                guard active else { return }
                Task { await model.refresh(silent: true) }
            }
    }

    @ViewBuilder
    private var content: some View {
        let plan = model.plan
        let tasks = plan?.tasks ?? []
        if model.loading, tasks.isEmpty, plan?.hasBudget != true {
            ProgressView("Loading tasks…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 26)
        } else if tasks.isEmpty, plan?.hasBudget != true {
            ContentUnavailableView {
                Label("No tasks for this job yet", systemImage: "checklist")
            } description: {
                if let error = model.error { Text(error).foregroundStyle(Palette.red) }
            } actions: {
                Button {
                    Task { await model.refresh(silent: false) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Palette.teal)
                .accessibilityLabel("Refresh tasks")
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text("Tasks").font(.headline)
                if showHoursMeter {
                    BudgetBurnMeter(progress: model.budget ?? project.budget).padding(.top, 10)
                }
                if !tasks.isEmpty, let plan { progress(plan) }
                if let instructions = plan?.instructions {
                    Text(instructions).text(12.5, .regular, Color(hex: 0x4c5a56)).lineSpacing(5).lineLimit(3).padding(.top, 9)
                }
                if let notice = model.syncNotice {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "icloud.and.arrow.up").font(.system(size: 12)).foregroundStyle(Palette.muted)
                        Text(notice).text(11.5, .semibold, Palette.muted).lineSpacing(3)
                    }
                    .padding(.top, 9)
                }
                if let error = model.error { errorText(error) }
                if tasks.isEmpty {
                    Text("This job's plan has no tasks yet.")
                        .text(12.5, .regular, Palette.muted).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                            LabourTaskRow(task: task, pending: model.pendingTaskIds.contains(task.id), showsDivider: index > 0) {
                                Task { await model.toggle(task) }
                            }
                        }
                    }
                    .padding(.top, 6)
                }
            }
        }
    }

    private func progress(_ plan: LabourPlan) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            (Text("\(plan.completedCount)").font(.app(20, .black)).foregroundColor(Palette.ink).monospacedDigit()
                + Text(" of \(plan.tasks.count) done" + (plan.totalHours > 0 ? " · \(HoursFormat.task(plan.totalHours)) budgeted" : ""))
                .font(.app(12.5, .bold)).foregroundColor(Palette.muted))
            ProgressView(value: min(1, plan.completionPercent / 100))
                .tint(Palette.teal)
        }
        .padding(.top, 8)
    }

    private func errorText(_ message: String) -> some View {
        Text(message).text(12, .bold, Palette.red).lineSpacing(4).padding(.top, 9)
    }
}

/// A task with its checkbox.
struct LabourTaskRow: View {
    var task: LabourTask
    var pending: Bool
    var showsDivider: Bool
    var onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(alignment: .center, spacing: 12) {
                Group {
                    if pending {
                        ProgressView()
                    } else {
                        Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 24))
                            .foregroundStyle(task.isCompleted ? Palette.teal : Color(.tertiaryLabel))
                    }
                }
                .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title)
                        .font(.app(15))
                        .foregroundStyle(task.isCompleted ? Color.secondary : Color.primary)
                        .strikethrough(task.isCompleted, color: Palette.muted)
                        .lineSpacing(2)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if task.isCompleted {
                        Text(task.doneLabel(now: Date())).font(.app(12, .medium)).foregroundStyle(Palette.teal)
                    } else if let notes = task.notes {
                        Text(notes).font(.app(12)).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if task.budgetedHours > 0 {
                    Text(HoursFormat.task(task.budgetedHours)).font(.app(13)).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .padding(.vertical, 11)
            .overlay(alignment: .top) {
                if showsDivider { Divider().padding(.leading, 40) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(pending)
        .accessibilityLabel(task.title + (task.isCompleted ? ", completed" : ""))
        .accessibilityAddTraits(task.isCompleted ? .isSelected : [])
        .accessibilityHint("Double-tap to mark as \(task.isCompleted ? "not done" : "done")")
    }
}
