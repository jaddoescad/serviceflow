import Foundation
@testable import ServiceFlowCore

/// An in-memory stand-in for the Supabase RPCs, following the server rules
/// of `record_time_entry_command` closely enough to exercise the tracker.
actor FakeServer: TimeTrackingBackend {
    var online = true
    var rows: [String: JSONValue] = [:] // by client_entry_id
    var calls: [String] = []
    var locationPoints: [JSONValue] = []
    var issues: [JSONValue] = []
    let employeeId: String

    init(employeeId: String) {
        self.employeeId = employeeId
    }

    func setOnline(_ value: Bool) { online = value }

    func seed(_ row: JSONValue) {
        rows[row["client_entry_id"]!.stringValue!] = row
    }

    func recordTimeEntryCommand(action: String, command: JSONValue, nextCommand: JSONValue?) async throws -> JSONValue {
        guard online else { throw BackendError.offline("The Internet connection appears to be offline.") }
        calls.append(action)
        return try apply(action, command, nextCommand)
    }

    private func apply(_ action: String, _ command: JSONValue, _ next: JSONValue?) throws -> JSONValue {
        let clientId = command["client_entry_id"]?.stringValue ?? ""
        switch action {
        case "clock_in":
            if let existing = rows[clientId] { return existing }
            if rows.values.contains(where: { $0["status"]?.stringValue == "active" && $0["employee_id"]?.stringValue == employeeId }) {
                throw BackendError.server(code: "P0001", message: "Employee already has an active time entry", status: 400)
            }
            guard let jobId = command["job_id"]?.nonEmptyString else {
                throw BackendError.server(code: "P0001", message: "A valid job_id is required", status: 400)
            }
            let row: JSONValue = [
                "id": command["server_id"] ?? .string(UUID().uuidString.lowercased()),
                "client_entry_id": .string(clientId), "employee_id": .string(employeeId), "job_id": .string(jobId),
                "job_name": command["project_name"] ?? "Job", "employee_name": "Pat Painter",
                "original_started_at": command["original_started_at"] ?? .null, "started_at": command["started_at"] ?? .null,
                "ended_at": .null, "status": "active", "segments": command["segments"] ?? .array([]), "adjustment_history": .array([]),
            ]
            rows[clientId] = row
            return row
        case "clock_out", "adjust", "delete", "observation":
            guard var row = rows[clientId] else {
                if action == "delete" { return false }
                throw BackendError.server(code: "P0001", message: "Time entry not found", status: 400)
            }
            guard case .object(var object) = row else { return row }
            if action == "clock_out", object["status"]?.stringValue == "active" {
                object["ended_at"] = command["ended_at"] ?? .string(ISODate.string(Date()))
                object["status"] = "completed"
            } else if action == "adjust" {
                if let started = command["started_at"] { object["started_at"] = started }
                if let ended = command["ended_at"], !ended.isNull {
                    object["ended_at"] = ended
                    object["status"] = "completed"
                }
            } else if action == "delete" {
                object["status"] = "deleted"
            }
            row = .object(object)
            rows[clientId] = row
            return action == "delete" ? true : row
        case "switch":
            let completed = try apply("clock_out", command, nil)
            let active = try apply("clock_in", next ?? .null, nil)
            return ["completed_entry": completed, "active_entry": active]
        case "job_issue":
            issues.append(command)
            return ["id": "issue", "duplicate": false]
        default:
            throw BackendError.server(code: "P0001", message: "Unsupported", status: 400)
        }
    }

    func fetchOwnTimeEntries(userId: String, since: Date?, limit: Int) async throws -> [JSONValue] {
        guard online else { throw BackendError.offline("offline") }
        return rows.values.filter { $0["employee_id"]?.stringValue == userId }
    }

    func recordLocationUpdate(point: JSONValue, tracking: JSONValue?) async throws {
        guard online else { throw BackendError.offline("offline") }
        locationPoints.append(point)
    }

    func ensureLeadClockInJob(leadId: String) async throws -> JSONValue {
        ["id": "22222222-2222-4222-8222-222222222222", "name": "Converted lead", "status": "active"]
    }

    func allRows() -> [JSONValue] { Array(rows.values) }
    func callLog() -> [String] { calls }
    func points() -> [JSONValue] { locationPoints }
}

final class FakeLocation: LocationProviding, @unchecked Sendable {
    var authorization: LocationAuthorization
    var answer: LocationAuthorization
    var point: LocationPoint?
    var requests = 0
    var fixes = 0

    init(authorization: LocationAuthorization = .authorized, answer: LocationAuthorization = .authorized, point: LocationPoint? = nil) {
        self.authorization = authorization
        self.answer = answer
        self.point = point
    }

    func requestAuthorizationIfNeeded() async -> LocationAuthorization {
        if authorization == .notDetermined {
            requests += 1
            authorization = answer
        }
        return authorization
    }

    func currentPoint(timeout: TimeInterval) async -> LocationPoint? {
        fixes += 1
        return point
    }
}

final class FakeReminders: ShiftReminderScheduling, @unchecked Sendable {
    var scheduled: [String] = []
    var cancels = 0
    func scheduleReminders(for shift: TimeEntry, now: Date) { scheduled.append(shift.localId) }
    func cancelReminders() { cancels += 1 }
}

/// A clock the checks can move forward.
final class TestClock: @unchecked Sendable {
    var date: Date
    init(_ date: Date) { self.date = date }
    func advance(minutes: Double) { date = date.addingTimeInterval(minutes * 60) }
}
