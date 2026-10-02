import Foundation
import ServiceFlowCore
import Supabase

/// Time entries, location, labour tasks and the team map.
extension ServiceFlowAPI {
    // MARK: Time entries (TimeTrackingBackend)

    func recordTimeEntryCommand(action: String, command: JSONValue, nextCommand: JSONValue?) async throws -> JSONValue {
        try await rpc("record_time_entry_command", ["action": .string(action), "command": command, "next_command": nextCommand ?? .null])
    }

    func fetchOwnTimeEntries(userId: String, since: Date?, limit: Int) async throws -> [JSONValue] {
        var query = client.from("time_entries").select("*").eq("employee_id", value: userId)
        if let since { query = query.gte("started_at", value: ISODate.string(since)) }
        return try await rows(query.order("started_at", ascending: false).limit(limit))
    }

    func recordLocationUpdate(point: JSONValue, tracking: JSONValue?) async throws {
        _ = try await rpc("record_location_update", ["point": point, "tracking": tracking ?? .null])
    }

    func ensureLeadClockInJob(leadId: String) async throws -> JSONValue {
        try await rpc("ensure_lead_clock_in_job", ["requested_lead_id": .string(leadId)])
    }

    /// Everyone's entries on one job (company members can read them).
    func jobTimeEntries(jobId: String) async throws -> [TimeEntry] {
        try await rows(
            client.from("time_entries").select("*").eq("job_id", value: jobId).neq("status", value: "deleted")
                .order("started_at", ascending: false).limit(1000)
        ).compactMap { TimeEntry(serverRow: $0) }
    }

    // MARK: Labour tasks

    func labourPlan(jobId: String) async throws -> LabourPlan {
        async let tasks = rows(client.from("job_tasks").select("*").eq("job_id", value: jobId).order("sort_order", ascending: true))
        async let budget = rows(
            client.from("job_budgets").select("id,job_id,instructions,budget_minutes,version,status")
                .eq("job_id", value: jobId).in("status", values: ["active", "closed"])
                .order("version", ascending: false).limit(1)
        )
        return LabourPlan(taskRows: try await tasks, budgetRow: try await budget.first, fetchedAt: Date())
    }

    func setTaskStatus(taskId: String, completed: Bool) async throws {
        _ = try await rpc("set_job_task_status", [
            "requested_task_id": .string(taskId), "requested_status": .string(completed ? "completed" : "pending"),
        ])
    }

    /// Calls `onChange` whenever a task on the job changes.
    func watchTasks(jobId: String, onChange: @escaping @Sendable () -> Void) async -> RealtimeChannelV2 {
        let channel = client.realtimeV2.channel("project-labour-task-state:\(jobId):watch-\(UUID().uuidString.prefix(8))")
        let changes = channel.postgresChange(AnyAction.self, schema: "public", table: "job_tasks", filter: .eq("job_id", value: jobId))
        Task {
            for await _ in changes { onChange() }
        }
        try? await channel.subscribeWithError()
        return channel
    }

    func stopWatching(_ channel: RealtimeChannelV2) async {
        await client.realtimeV2.removeChannel(channel)
    }
}
