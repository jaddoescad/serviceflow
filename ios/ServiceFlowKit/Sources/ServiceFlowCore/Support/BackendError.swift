import Foundation

/// A failed backend call, classified so offline queues know whether to retry.
public enum BackendError: Error, Equatable, Sendable, LocalizedError {
    /// No connection, timeout, or the request never completed.
    case offline(String)
    /// The session is missing or expired; retry after the session refreshes.
    case unauthorized(String)
    /// The server answered and refused. `code` is the Postgres/PostgREST code
    /// (`P0001` for raised exceptions, `42501` for permission errors).
    case server(code: String?, message: String, status: Int?)

    public var errorDescription: String? { message }

    public var message: String {
        switch self {
        case .offline(let message), .unauthorized(let message): return message
        case .server(_, let message, _): return message
        }
    }

    /// Worth retrying later without changing anything.
    public var isRetryable: Bool {
        switch self {
        case .offline, .unauthorized: return true
        case .server(_, _, let status):
            guard let status else { return false }
            return status >= 500 || status == 408 || status == 429
        }
    }

    public static func from(_ error: Error) -> BackendError {
        if let error = error as? BackendError { return error }
        if let error = error as? URLError {
            return .offline(error.localizedDescription)
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain { return .offline(nsError.localizedDescription) }
        return .server(code: nil, message: error.localizedDescription, status: nil)
    }
}

/// Time-entry and location calls used by the time tracker.
public protocol TimeTrackingBackend: Sendable {
    /// `public.record_time_entry_command(action, command, next_command)`.
    func recordTimeEntryCommand(action: String, command: JSONValue, nextCommand: JSONValue?) async throws -> JSONValue
    /// The signed-in person's own entries (not deleted), newest first.
    func fetchOwnTimeEntries(userId: String, since: Date?, limit: Int) async throws -> [JSONValue]
    /// `public.record_location_update(point, tracking)`.
    func recordLocationUpdate(point: JSONValue, tracking: JSONValue?) async throws
    /// `public.ensure_lead_clock_in_job(requested_lead_id)`: the job to clock into for a lead.
    func ensureLeadClockInJob(leadId: String) async throws -> JSONValue
}
