import Observation
import ServiceFlowCore
import SwiftUI

/// What the Jobs list is showing: the search text and which jobs count as
/// "assigned" (assignments, jobs you have time on, and the current job).
struct JobsQuery: Equatable {
    var search: String
    var relevantIds: [String]
    var trackedIds: [String]
}

/// Loads the Jobs list: active jobs 20 at a time, or search results.
@MainActor
@Observable
final class JobsModel {
    enum Filter: String { case active, assigned }

    static let pageSize = 20

    private(set) var projects: [Project] = []
    private(set) var hasLoaded = false
    private(set) var error: String?
    private(set) var loadingMore = false
    private(set) var hasMore = false
    var filter: Filter = .active

    /// Pages loaded so far (a silent refresh reloads all of them, so rows
    /// already scrolled into view stay).
    @ObservationIgnored private var loadedPages = 0
    @ObservationIgnored private var requestId = 0
    @ObservationIgnored private var fetching = false
    /// Search matches, sliced into pages on the device.
    @ObservationIgnored private var searchMatches: [Project] = []

    /// Reloads from the first page (filter, search or assignments changed).
    func reload(_ query: JobsQuery, api: ServiceFlowAPI) async {
        loadedPages = 0
        await load(query, api: api, pages: 1, append: false)
    }

    /// Reloads everything already shown, without collapsing to the first page.
    func refresh(_ query: JobsQuery, api: ServiceFlowAPI) async {
        await load(query, api: api, pages: max(1, loadedPages), append: false)
    }

    func loadMore(_ query: JobsQuery, api: ServiceFlowAPI) async {
        guard hasMore, !loadingMore, !fetching, hasLoaded else { return }
        loadingMore = true
        defer { loadingMore = false }
        await load(query, api: api, pages: 1, append: true)
    }

    private func load(_ query: JobsQuery, api: ServiceFlowAPI, pages: Int, append: Bool) async {
        requestId += 1
        let request = requestId
        fetching = true
        defer { if request == requestId { fetching = false } }
        let search = query.search.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstPage = append ? loadedPages : 0
        let size = Self.pageSize * pages

        do {
            var rows: [Project]
            var more: Bool
            if !search.isEmpty {
                if !append { searchMatches = try await api.searchProjects(search, limit: 1000) }
                let start = firstPage * Self.pageSize
                rows = Array(searchMatches.dropFirst(start).prefix(size))
                more = start + rows.count < searchMatches.count
            } else {
                let ids: [String]? = filter == .assigned ? query.relevantIds : nil
                if append {
                    rows = try await api.activeProjects(page: firstPage, pageSize: Self.pageSize, ids: ids)
                } else {
                    // One request covering every loaded page, so a refresh keeps them.
                    rows = try await api.activeProjects(page: 0, pageSize: size, ids: ids)
                }
                more = rows.count == (append ? Self.pageSize : size)
                if !append, filter == .active, !query.trackedIds.isEmpty {
                    // Jobs you have time on stay visible even when they're older than the first pages.
                    let shown = Set(rows.map(\.id))
                    let missing = query.trackedIds.filter { !shown.contains($0) }
                    if !missing.isEmpty {
                        let extra = try await api.activeProjects(page: 0, pageSize: max(Self.pageSize, missing.count), ids: missing)
                        rows += extra.filter { !shown.contains($0.id) }
                    }
                }
            }
            guard request == requestId else { return }
            if append {
                let existing = Set(projects.map(\.id))
                projects += rows.filter { !existing.contains($0.id) }
                loadedPages += 1
            } else {
                var seen = Set<String>()
                projects = rows.filter { seen.insert($0.id).inserted }
                loadedPages = pages
            }
            hasMore = more
            error = nil
            hasLoaded = true
        } catch {
            guard request == requestId else { return }
            // Keep what is already on screen.
            self.error = error.localizedDescription
            hasLoaded = true
        }
    }
}
