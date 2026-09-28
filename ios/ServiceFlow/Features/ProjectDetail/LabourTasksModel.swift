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
    @ObservationIgnored private weak var session: SessionContext?
    /// The Clock In screen also shows the job's budget meter.
    @ObservationIgnored private var includeBudget = false

    init(jobId: String) {
        self.jobId = jobId
    }

    /// Shows the cached plan straight away; call once before refreshing.
    func start(session: SessionContext, includeBudget: Bool) {
        self.session = session
        self.includeBudget = includeBudget
        guard cache == nil else { return }
        let store: JSONFileStore<LabourPlan> = session.storage.store("labour-plan-\(jobId)")
        cache = store
        plan = store.load()
        loading = plan == nil
    }

    /// Sends queued checkbox changes, then reloads the plan (and budget).
    func refresh(silent: Bool) async {
        guard let session else { return }
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
    func scheduleRefresh() {
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await self?.refresh(silent: true)
        }
    }

    /// Flips a checkbox right away; a failed save is queued when it's only the
    /// connection, and undone when the server refused it.
    func toggle(_ task: LabourTask) async {
        guard let session, var current = plan, let index = current.tasks.firstIndex(where: { $0.id == task.id }),
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
            await refresh(silent: true)
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
