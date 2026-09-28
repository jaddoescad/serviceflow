import Foundation

public enum TimeEntryAction: String, Codable, Sendable {
    case clockIn = "clock_in"
    case clockOut = "clock_out"
    case switchProject = "switch"
    case adjust
    case delete
    case observation
    case jobIssue = "job_issue"
}

/// Payloads for `record_time_entry_command`.
public enum TimeEntryCommand {
    static let uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"

    public static func isUUID(_ value: String?) -> Bool {
        guard let value else { return false }
        return value.lowercased().range(of: uuidPattern, options: .regularExpression) != nil
    }

    /// The value when it's a UUID (the only ids the server accepts), else null.
    static func uuidValue(_ value: String?) -> JSONValue {
        guard let value, isUUID(value) else { return .null }
        return .string(value)
    }

    /// The command body for an entry.
    /// - Parameters:
    ///   - includeEndedAt: send `ended_at` (clock-out and edits of completed entries).
    ///   - reason: stored by the server in `time_entries.notes`; only lifecycle
    ///     endings send one, so edits never overwrite the note.
    ///   - capturedAt: when the action happened on the device. Commands can be
    ///     queued offline, so this keeps the event log accurate.
    public static func payload(for entry: TimeEntry, includeEndedAt: Bool = false, reason: String? = nil,
                               adjustmentSource: String? = nil, capturedAt: Date) -> JSONValue {
        var body: [String: JSONValue] = [
            "client_entry_id": .string(entry.localId),
            "server_id": uuidValue(entry.serverId),
            "user_name": .string(entry.userName),
            "job_id": uuidValue(entry.project.id),
            "project_name": .string(entry.project.name),
            "project_address": JSONValue(entry.project.fullAddress),
            "original_started_at": JSONValue(entry.originalStartedAt),
            "started_at": JSONValue(entry.startedAt),
            "clock_in_latitude": JSONValue(entry.startedLocation?.latitude),
            "clock_in_longitude": JSONValue(entry.startedLocation?.longitude),
            "clock_out_latitude": JSONValue(entry.lastLocation?.latitude),
            "clock_out_longitude": JSONValue(entry.lastLocation?.longitude),
            "last_distance_meters": JSONValue(entry.lastDistanceMeters.map { Int($0.rounded()) }),
            "is_on_site": JSONValue(entry.onSite),
            "segments": (try? JSONValue(encoding: entry.segments)) ?? .array([]),
            "reason": JSONValue(reason),
            "source": "mobile",
            "adjustment_source": JSONValue(adjustmentSource),
            "captured_at": JSONValue(capturedAt),
        ]
        if includeEndedAt { body["ended_at"] = JSONValue(entry.endedAt) }
        return .object(body)
    }

    /// The clock-in command. New entries use a UUID as their client id and ask
    /// the server to use the same value as the row id, so the row id is known
    /// on the device before the server has answered.
    public static func clockIn(_ entry: TimeEntry, capturedAt: Date) -> JSONValue {
        guard case .object(var body) = payload(for: entry, capturedAt: capturedAt) else { return .null }
        if body["server_id"]?.isNull ?? true, isUUID(entry.localId) {
            body["server_id"] = .string(entry.localId.lowercased())
        }
        return .object(body)
    }

    /// The delete command.
    public static func deletion(of entry: TimeEntry, capturedAt: Date) -> JSONValue {
        [
            "server_id": uuidValue(entry.serverId),
            "client_entry_id": .string(entry.localId),
            "source": "mobile",
            "captured_at": JSONValue(capturedAt),
        ]
    }

    /// A job over-budget reason (`job_issue`).
    public static func jobIssue(clientId: String, jobId: String, reason: String, note: String?, minutesOver: Int) -> JSONValue {
        [
            "client_id": .string(clientId),
            "job_id": .string(jobId),
            "reason": .string(reason),
            "note": JSONValue(note.nonBlank.map { String($0.prefix(280)) }),
            "minutes_over": .number(Double(max(0, minutesOver))),
        ]
    }

    /// First row of an RPC response (the client accepts an object or an array).
    public static func firstRow(_ value: JSONValue) -> JSONValue? {
        if case .array(let rows) = value { return rows.first }
        if case .object = value { return value }
        return nil
    }
}
