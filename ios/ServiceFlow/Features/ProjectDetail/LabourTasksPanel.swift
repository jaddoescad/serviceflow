import Observation
import ServiceFlowCore
import SwiftUI

/// One queue of task checkbox changes per signed-in person.
@MainActor
enum LabourTaskQueues {
    private static var queues: [String: TaskStatusQueue] = [:]

    static func queue(for session: SessionContext) -> TaskStatusQueue {
        if let queue = queues[session.user.id] { return queue }
        let queue = TaskStatusQueue(store: session.storage.store("task-status-queue"))
        queues[session.user.id] = queue
        return queue
    }
}

/// Loads a job's task plan, keeps a cached copy, and applies checkbox changes
/// optimistically.
@MainActor
@Observable
final class LabourTasksModel {
    let jobId: String
    private(set) var plan: LabourPlan?
    private(set) var budget: BudgetProgress?
    private(set) var loading = false
    private(set) var error: String?
    private(set) var syncNotice: String?
    private(set) var pendingTaskIds = Set<String>()

    @ObservationIgnored private var requestId = 0
    @ObservationIgnored private var cache: JSONFileStore<LabourPlan>?
    @ObservationIgnored private var debounce: Task<Void, Never>?

    init(jobId: String) {
        self.jobId = jobId
    }

    func start(session: SessionContext) {
        guard cache == nil else { return }
        let store: JSONFileStore<LabourPlan> = session.storage.store("labour-plan-\(jobId)")
        cache = store
        plan = store.load()
        loading = plan == nil
    }

    func refresh(session: SessionContext, silent: Bool, includeBudget: Bool) async {
        requestId += 1
        let request = requestId
        if !silent { loading = plan == nil }
        let api = session.api
        await LabourTaskQueues.queue(for: session).flush { item in
            try await api.setTaskStatus(taskId: item.taskId, completed: item.completed)
        }
        do {
            let fetched = try await api.labourPlan(jobId: jobId)
            var progress: BudgetProgress?
            if includeBudget, let budgets = try? await api.budgets(jobIds: [jobId]) { progress = budgets[jobId] }
            guard request == requestId else { return }
            let queued = await LabourTaskQueues.queue(for: session).pending
            let merged = applyPending(fetched, queued: queued)
            plan = merged
            cache?.save(merged)
            if includeBudget { budget = progress ?? budget }
            error = nil
            syncNotice = nil
        } catch {
            guard request == requestId else { return }
            self.error = LabourTaskErrors.friendly(error.localizedDescription)
        }
        loading = false
    }

    /// Changes still queued on the device win over the fetched state.
    private func applyPending(_ plan: LabourPlan, queued: [QueuedTaskStatus]) -> LabourPlan {
        guard !queued.isEmpty else { return plan }
        var next = plan
        for item in queued {
            guard let index = next.tasks.firstIndex(where: { $0.id == item.taskId }) else { continue }
            next.tasks[index].isCompleted = item.completed
            next.tasks[index].completedAt = item.completed ? (next.tasks[index].completedAt ?? item.createdAt) : nil
        }
        return next
    }

    /// A change from realtime or a timer; bursts are coalesced.
    func scheduleRefresh(session: SessionContext, includeBudget: Bool) {
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await self?.refresh(session: session, silent: true, includeBudget: includeBudget)
        }
    }

    func toggle(_ task: LabourTask, session: SessionContext, includeBudget: Bool) async {
        guard var current = plan, let index = current.tasks.firstIndex(where: { $0.id == task.id }),
              !pendingTaskIds.contains(task.id) else { return }
        let previous = current
        let completed = !task.isCompleted
        pendingTaskIds.insert(task.id)
        requestId += 1 // drop any refresh in flight so the checkbox doesn't flicker
        current.tasks[index].isCompleted = completed
        current.tasks[index].completedAt = completed ? Date() : nil
        plan = current
        cache?.save(current)
        defer { pendingTaskIds.remove(task.id) }

        do {
            try await session.api.setTaskStatus(taskId: task.id, completed: completed)
            error = nil
            await refresh(session: session, silent: true, includeBudget: includeBudget)
        } catch {
            let failure = BackendError.from(error)
            if failure.isRetryable {
                await LabourTaskQueues.queue(for: session).enqueue(QueuedTaskStatus(taskId: task.id, completed: completed, createdAt: Date()))
                syncNotice = "Saved on this device. It will sync when ServiceFlow reconnects."
            } else {
                plan = previous
                cache?.save(previous)
                self.error = LabourTaskErrors.friendly(failure.message)
            }
        }
    }
}

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
                model.start(session: session)
                await model.refresh(session: session, silent: false, includeBudget: showHoursMeter)
                let channel = await session.api.watchTasks(jobId: project.id) { [model, session, showHoursMeter] in
                    Task { @MainActor in model.scheduleRefresh(session: session, includeBudget: showHoursMeter) }
                }
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    guard !Task.isCancelled else { break }
                    await model.refresh(session: session, silent: true, includeBudget: showHoursMeter)
                }
                await session.api.stopWatching(channel)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                guard active else { return }
                Task { await model.refresh(session: session, silent: true, includeBudget: showHoursMeter) }
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
                    Task { await model.refresh(session: session, silent: false, includeBudget: showHoursMeter) }
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
                                Task { await model.toggle(task, session: session, includeBudget: showHoursMeter) }
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
