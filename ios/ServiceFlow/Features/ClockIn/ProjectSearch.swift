import Observation
import ServiceFlowCore
import SwiftUI

/// Debounced search of jobs and leads, shared by Clock In and Change Job.
/// Drive it with `.task(id: search.query.committed) { await search.run(api) }`
/// and call `textChanged()` from `.onChange(of: search.query.text)`.
@MainActor
@Observable
final class ProjectSearch {
    let query = Debouncer()
    private(set) var results: [Project] = []
    private(set) var isSearching = false
    private(set) var error: String?

    var hasQuery: Bool { !query.text.trimmingCharacters(in: .whitespaces).isEmpty }

    /// Shows the spinner right away, so "no results" never flashes while the
    /// debounce waits.
    func textChanged() {
        isSearching = hasQuery
        if !hasQuery {
            results = []
            error = nil
        }
    }

    func run(_ api: ServiceFlowAPI) async {
        let text = query.committed
        guard !text.isEmpty else { return }
        do {
            let found = try await api.searchProjects(text)
            guard text == query.committed else { return }
            results = found
            error = nil
        } catch {
            guard text == query.committed else { return }
            results = []
            self.error = (error as? BackendError)?.message ?? error.localizedDescription
        }
        isSearching = false
    }

    func clear() {
        query.clear()
        results = []
        error = nil
        isSearching = false
    }
}
