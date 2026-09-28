import Observation
import SwiftUI

/// A form's in-flight request: a busy flag for the button and the error to
/// show. `run` clears the old error, marks the form busy, and turns any
/// thrown error into readable text.
@MainActor
@Observable
final class RequestState {
    private(set) var isRunning = false
    var error: String?

    func run(_ work: @escaping @MainActor () async throws -> Void) {
        guard !isRunning else { return }
        error = nil
        isRunning = true
        Task {
            defer { isRunning = false }
            do {
                try await work()
            } catch {
                self.error = AuthMessage.from(error)
            }
        }
    }
}
