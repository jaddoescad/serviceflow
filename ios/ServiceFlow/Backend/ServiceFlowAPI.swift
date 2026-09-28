import Foundation
import ServiceFlowCore
import Supabase

/// Every Supabase call the app makes, grouped by domain in the
/// `ServiceFlowAPI+*.swift` files. Row-level security scopes all reads to the
/// companies the signed-in person belongs to.
final class ServiceFlowAPI: TimeTrackingBackend, @unchecked Sendable {
    let client: SupabaseClient

    init(config: AppConfig) {
        client = SupabaseClient(
            supabaseURL: config.supabaseURL,
            supabaseKey: config.supabaseKey,
            options: SupabaseClientOptions(auth: .init(autoRefreshToken: true, emitLocalSessionAsInitialSession: true))
        )
    }

    // MARK: Errors

    /// Postgres and PostgREST codes that mean the server refused for good.
    private static let definiteCodes: Set<String> = ["P0001", "P0002", "42501", "42883"]
    private static let definitePrefixes = ["22", "23", "PGRST1", "PGRST2"]

    /// Classifies an error for the offline queues. Anything that isn't a
    /// definite refusal from the database is treated as worth retrying, so a
    /// time record is never thrown away because of a flaky connection.
    static func classify(_ error: Error) -> BackendError {
        if let error = error as? BackendError { return error }
        if error is URLError || (error as NSError).domain == NSURLErrorDomain {
            return .offline(error.localizedDescription)
        }
        if let error = error as? PostgrestError {
            guard let code = error.code else { return .offline(error.message) }
            if code.hasPrefix("PGRST3") { return .unauthorized(error.message) }
            let definite = definiteCodes.contains(code) || definitePrefixes.contains { code.hasPrefix($0) }
            return definite ? .server(code: code, message: error.message, status: 400) : .offline(error.message)
        }
        if error is AuthError { return .unauthorized(error.localizedDescription) }
        return .offline(error.localizedDescription)
    }

    // MARK: Request helpers

    func run<T>(_ work: () async throws -> T) async throws -> T {
        do { return try await work() } catch { throw Self.classify(error) }
    }

    func rows(_ query: PostgrestTransformBuilder) async throws -> [JSONValue] {
        try await run { try await query.execute().value }
    }

    func rpc(_ name: String, _ params: [String: JSONValue]) async throws -> JSONValue {
        try await run { try await client.rpc(name, params: params).execute().value }
    }
}

enum AccountDeletionResult: Equatable {
    case deleted
    case blocked(String)
    case failed(String)
}
