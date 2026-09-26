import Foundation

/// A checklist item on a job (`job_tasks` row).
public struct LabourTask: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var jobId: String
    public var budgetId: String?
    public var title: String
    public var notes: String?
    public var budgetedHours: Double
    public var isCompleted: Bool
    public var completedAt: Date?
    public var sortOrder: Int

    public init?(row: JSONValue) {
        guard let id = row["id"]?.nonEmptyString else { return nil }
        self.id = id
        jobId = row["job_id"]?.nonEmptyString ?? ""
        budgetId = row["budget_id"]?.nonEmptyString
        title = row["title"]?.nonEmptyString ?? "Task"
        notes = row["notes"]?.nonEmptyString
        budgetedHours = max(0, (row["budget_minutes"]?.doubleValue ?? 0) / 60)
        isCompleted = row["status"]?.stringValue == "completed"
        completedAt = row["completed_at"]?.dateValue
        sortOrder = row["sort_order"]?.intValue ?? 0
    }

    public init(id: String, jobId: String, title: String, notes: String? = nil, budgetedHours: Double = 0,
                isCompleted: Bool = false, completedAt: Date? = nil, sortOrder: Int = 0) {
        self.id = id
        self.jobId = jobId
        self.title = title
        self.notes = notes
        self.budgetedHours = budgetedHours
        self.isCompleted = isCompleted
        self.completedAt = completedAt
        self.sortOrder = sortOrder
    }

    /// `Done · 3:05 PM` today, else `Done · Sep 3, 3:05 PM`.
    public func doneLabel(now: Date, calendar: Calendar = .current) -> String {
        guard let completedAt else { return "Done" }
        let time = DateText.time(completedAt)
        if calendar.isDate(completedAt, inSameDayAs: now) { return "Done · \(time)" }
        return "Done · \(DateText.format(completedAt, template: "MMMd")), \(time)"
    }
}

/// A job's task plan: its tasks and the published labour budget.
public struct LabourPlan: Codable, Hashable, Sendable {
    public var tasks: [LabourTask]
    public var instructions: String?
    /// Total hours of the published budget (`job_budgets.budget_minutes`).
    public var budgetedHours: Double?
    public var fetchedAt: Date?

    public init(tasks: [LabourTask] = [], instructions: String? = nil, budgetedHours: Double? = nil, fetchedAt: Date? = nil) {
        self.tasks = tasks.sorted { lhs, rhs in
            lhs.sortOrder == rhs.sortOrder ? lhs.title.localizedCompare(rhs.title) == .orderedAscending : lhs.sortOrder < rhs.sortOrder
        }
        self.instructions = instructions
        self.budgetedHours = budgetedHours
        self.fetchedAt = fetchedAt
    }

    /// Built from `job_tasks` rows and the job's `job_budgets` row.
    public init(taskRows: [JSONValue], budgetRow: JSONValue?, fetchedAt: Date) {
        let budgetMinutes = budgetRow?["budget_minutes"]?.doubleValue
        self.init(
            tasks: taskRows.compactMap(LabourTask.init(row:)),
            instructions: budgetRow?["instructions"]?.nonEmptyString,
            budgetedHours: budgetMinutes.map { max(0, $0 / 60) },
            fetchedAt: fetchedAt
        )
    }

    public var hasBudget: Bool { budgetedHours != nil }
    public var completedCount: Int { tasks.filter(\.isCompleted).count }

    /// The budget's hours, else the sum of the task hours.
    public var totalHours: Double { max(0, budgetedHours ?? tasks.reduce(0) { $0 + $1.budgetedHours }) }

    public var completionPercent: Double {
        tasks.isEmpty ? 0 : Double(completedCount) / Double(tasks.count) * 100
    }
}

public enum LabourTaskErrors {
    /// Message shown when loading or saving tasks fails.
    public static func friendly(_ message: String?) -> String {
        guard let message = message?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty else {
            return "Tasks could not sync. Your last saved list is still available."
        }
        if message.range(of: "not assigned|permission|row-level security|task access denied", options: [.regularExpression, .caseInsensitive]) != nil {
            return "This job is not assigned to your account."
        }
        if message.range(of: "function.*does not exist|schema cache", options: [.regularExpression, .caseInsensitive]) != nil {
            return "Painter tasks are not available in this environment yet."
        }
        return message
    }
}

/// A task checkbox change waiting to reach the server. Last write wins per task.
public struct QueuedTaskStatus: Codable, Hashable, Sendable {
    public var taskId: String
    public var completed: Bool
    public var createdAt: Date

    public init(taskId: String, completed: Bool, createdAt: Date) {
        self.taskId = taskId
        self.completed = completed
        self.createdAt = createdAt
    }
}

public actor TaskStatusQueue {
    private let store: JSONFileStore<[QueuedTaskStatus]>
    private var items: [QueuedTaskStatus]
    private var flushing = false

    public init(store: JSONFileStore<[QueuedTaskStatus]>) {
        self.store = store
        items = store.load() ?? []
    }

    public var pending: [QueuedTaskStatus] { items }

    public func enqueue(_ item: QueuedTaskStatus) {
        items.removeAll { $0.taskId == item.taskId }
        items.append(item)
        store.save(items)
    }

    /// Sends queued changes; transient failures stay queued, refusals are dropped.
    public func flush(using send: @Sendable (QueuedTaskStatus) async throws -> Void) async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        for item in items {
            do {
                try await send(item)
                remove(item)
            } catch {
                let failure = BackendError.from(error)
                if !failure.isRetryable { remove(item) }
                if case .offline = failure { return }
            }
        }
    }

    private func remove(_ item: QueuedTaskStatus) {
        items.removeAll { $0 == item }
        store.save(items)
    }
}
