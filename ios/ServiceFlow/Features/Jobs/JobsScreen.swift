import ServiceFlowCore
import SwiftUI

/// The Jobs tab: the current job, active or assigned jobs, and search.
struct JobsScreen: View {
    let enabled: Bool

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker
    @State private var model = JobsModel()
    @State private var search = Debouncer()

    init(enabled: Bool) {
        self.enabled = enabled
    }

    private var isSearching: Bool { !search.committed.isEmpty }

    /// What to load; any change reloads the list from the first page.
    private var query: JobsQuery {
        let tracked = tracker.myTimeByProject().keys.filter { !$0.isEmpty }.sorted()
        var relevant = Set(session.assignedJobIds).union(tracked)
        if let current = tracker.activeShift?.project.id, !current.isEmpty { relevant.insert(current) }
        return JobsQuery(search: search.committed, relevantIds: relevant.sorted(), trackedIds: tracked)
    }

    var body: some View {
        @Bindable var search = search
        let query = self.query
        let listing = JobsListing(projects: model.projects, filter: model.filter, searching: isSearching,
                                  relevantIds: query.relevantIds, entries: tracker.allEntries, activeShift: tracker.activeShift)
        let myTime = tracker.myTimeByProject()
        List {
            if let error = model.error, !error.isEmpty {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.app(13, .semibold))
                        .foregroundStyle(Color(hex: 0xb42318))
                }
            }
            if !isSearching {
                Section {
                    Picker("Show", selection: $model.filter) {
                        Text("Active").tag(JobsModel.Filter.active)
                        Text("Assigned").tag(JobsModel.Filter.assigned)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
            }
            if model.hasLoaded {
                content(listing, myTime: myTime, query: query)
            } else {
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading projects…").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Jobs")
        .searchable(text: $search.text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search jobs and leads")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .refreshable { await model.refresh(query, api: session.api) }
        .task(id: ReloadKey(query: query, filter: model.filter)) { await model.reload(query, api: session.api) }
        .task(id: enabled) {
            // Coming back to the tab refreshes, then every 45 s while it's visible.
            guard enabled else { return }
            if model.hasLoaded { await model.refresh(self.query, api: session.api) }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                guard !Task.isCancelled else { return }
                await model.refresh(self.query, api: session.api)
            }
        }
    }

    /// Search, filter or assignment changes reload from the first page.
    private struct ReloadKey: Equatable {
        var query: JobsQuery
        var filter: JobsModel.Filter
    }

    // MARK: Sections

    @ViewBuilder
    private func content(_ listing: JobsListing, myTime: [String: TimeInterval], query: JobsQuery) -> some View {
        if let featured = listing.featured {
            Section {
                NavigationLink(value: ProjectRoute(project: featured)) {
                    JobsCurrentCard(project: featured, onSite: tracker.activeShift?.onSite, myTime: myTime[featured.id])
                }
                .listRowBackground(Palette.teal)
            } header: {
                Text("Current job")
            }
        }
        Section {
            ForEach(listing.remaining) { project in
                NavigationLink(value: ProjectRoute(project: project)) {
                    JobsRow(project: project, myTime: myTime[project.id])
                }
            }
            if listing.remaining.isEmpty, listing.featured == nil {
                emptyState
            }
            if model.hasMore {
                HStack {
                    Spacer()
                    if model.loadingMore { ProgressView() }
                    Spacer()
                }
                .frame(height: 44)
                .listRowBackground(Color.clear)
                .onAppear { Task { await model.loadMore(query, api: session.api) } }
            }
        } header: {
            Text("\(sectionTitle) (\(listing.count))")
        }
    }

    private var sectionTitle: String {
        if isSearching { return "Search Results" }
        return model.filter == .assigned ? "Assigned Jobs" : "Active Jobs"
    }

    private var emptyState: some View {
        let copy: (title: String, detail: String, icon: String)
        if isSearching {
            copy = ("No matching jobs", "Try another name, email, phone, address, city, or postal code.", "magnifyingglass")
        } else if model.filter == .assigned {
            copy = ("No assigned jobs", "Assignments can be created from the office.", "person.crop.circle.badge.checkmark")
        } else if session.isManager {
            copy = ("No active jobs yet", "New jobs from the office will appear here.", "folder")
        } else {
            copy = ("No active jobs yet", "Ask a manager to assign you to an active job.", "folder")
        }
        return ContentUnavailableView(copy.title, systemImage: copy.icon, description: Text(copy.detail))
            .listRowBackground(Color.clear)
    }
}

/// The rows the Jobs list shows, worked out once per render: filtered,
/// ordered by your latest activity, with the current job pulled out on top.
struct JobsListing {
    let featured: Project?
    let remaining: [Project]
    /// The count in the section header (loaded rows, not a server total).
    let count: Int

    init(projects: [Project], filter: JobsModel.Filter, searching: Bool, relevantIds: [String],
         entries: [TimeEntry], activeShift: TimeEntry?) {
        let visible = searching ? projects : projects.filter { !$0.isArchived }
        let filtered: [Project]
        if filter == .assigned, !searching {
            let ids = Set(relevantIds)
            filtered = visible.filter { ids.contains($0.id) }
        } else {
            filtered = visible
        }

        let latestActivity = entries.reduce(into: [String: Date]()) { result, entry in
            let date = entry.endedAt ?? entry.startedAt
            if (result[entry.project.id] ?? .distantPast) < date { result[entry.project.id] = date }
        }
        let sorted = filtered.sorted { lhs, rhs in
            let l = latestActivity[lhs.id] ?? .distantPast
            let r = latestActivity[rhs.id] ?? .distantPast
            if l != r { return l > r }
            let lu = lhs.updatedAt ?? .distantPast
            let ru = rhs.updatedAt ?? .distantPast
            if lu != ru { return lu > ru }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }

        if let shift = activeShift, !searching {
            let current = projects.first { $0.id == shift.project.id } ?? shift.project
            featured = current
            remaining = sorted.filter { $0.id != current.id }
        } else {
            featured = nil
            remaining = sorted
        }
        count = (filter == .assigned || searching) ? filtered.count : visible.count
    }
}
