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

    /// Jobs you have time on.
    private var trackedIds: [String] {
        tracker.myTimeByProject().keys.filter { !$0.isEmpty }.sorted()
    }

    /// Assigned jobs, plus jobs you have time on, plus the current job.
    private var relevantIds: [String] {
        var ids = Set(session.assignedJobIds).union(trackedIds)
        if let current = tracker.activeShift?.project.id, !current.isEmpty { ids.insert(current) }
        return ids.sorted()
    }

    private var latestActivity: [String: Date] {
        tracker.allEntries.reduce(into: [:]) { result, entry in
            let date = entry.endedAt ?? entry.startedAt
            if (result[entry.project.id] ?? .distantPast) < date { result[entry.project.id] = date }
        }
    }

    private var visibleProjects: [Project] {
        isSearching ? model.projects : model.projects.filter { !$0.isArchived }
    }

    private var filtered: [Project] {
        guard model.filter == .assigned, !isSearching else { return visibleProjects }
        let ids = Set(relevantIds)
        return visibleProjects.filter { ids.contains($0.id) }
    }

    private var sorted: [Project] {
        let activity = latestActivity
        return filtered.sorted { lhs, rhs in
            let l = activity[lhs.id] ?? .distantPast
            let r = activity[rhs.id] ?? .distantPast
            if l != r { return l > r }
            let lu = lhs.updatedAt ?? .distantPast
            let ru = rhs.updatedAt ?? .distantPast
            if lu != ru { return lu > ru }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
    }

    private var featured: Project? {
        guard let shift = tracker.activeShift, !isSearching else { return nil }
        return model.projects.first { $0.id == shift.project.id } ?? shift.project
    }

    private var remaining: [Project] {
        guard let featured else { return sorted }
        return sorted.filter { $0.id != featured.id }
    }

    private var myTime: [String: TimeInterval] { tracker.myTimeByProject() }

    var body: some View {
        @Bindable var search = search
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
            if !model.hasLoaded {
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading projects…").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
                }
            } else {
                content
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Jobs")
        .searchable(text: $search.text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search jobs and leads")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .refreshable { await refresh() }
        .task { await reload() }
        .onChange(of: search.committed) { _, _ in Task { await reload() } }
        .onChange(of: model.filter) { _, _ in Task { await reload() } }
        .onChange(of: relevantIds) { _, _ in Task { await reload() } }
        .onChange(of: enabled) { _, isEnabled in if isEnabled, model.hasLoaded { Task { await refresh() } } }
        .task(id: enabled) {
            guard enabled else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                guard !Task.isCancelled else { return }
                await refresh()
            }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private var content: some View {
        if let featured {
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
            ForEach(remaining) { project in
                NavigationLink(value: ProjectRoute(project: project)) {
                    JobsRow(project: project, myTime: myTime[project.id])
                }
            }
            if remaining.isEmpty, featured == nil {
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
                .onAppear { Task { await loadMore() } }
            }
        } header: {
            Text("\(sectionTitle) (\(sectionCount))")
        }
    }

    private var sectionTitle: String {
        if isSearching { return "Search Results" }
        return model.filter == .assigned ? "Assigned Jobs" : "Active Jobs"
    }

    private var sectionCount: Int {
        (model.filter == .assigned || isSearching) ? filtered.count : visibleProjects.count
    }

    private var emptyState: some View {
        let copy: (String, String, String)
        if isSearching {
            copy = ("No matching jobs", "Try another name, email, phone, address, city, or postal code.", "magnifyingglass")
        } else if model.filter == .assigned {
            copy = ("No assigned jobs", "Assignments can be created from the office.", "person.crop.circle.badge.checkmark")
        } else if session.isManager {
            copy = ("No active jobs yet", "New jobs from the office will appear here.", "folder")
        } else {
            copy = ("No active jobs yet", "Ask a manager to assign you to an active job.", "folder")
        }
        return ContentUnavailableView(copy.0, systemImage: copy.2, description: Text(copy.1))
            .listRowBackground(Color.clear)
    }

    // MARK: Loading

    private func reload() async {
        await model.reload(api: session.api, search: search.committed, relevantIds: relevantIds, trackedIds: trackedIds)
    }

    private func refresh() async {
        await model.refresh(api: session.api, search: search.committed, relevantIds: relevantIds, trackedIds: trackedIds)
    }

    private func loadMore() async {
        await model.loadMore(api: session.api, search: search.committed, relevantIds: relevantIds, trackedIds: trackedIds)
    }
}

/// The job you're clocked into (shown on a teal row).
struct JobsCurrentCard: View {
    var project: Project
    var onSite: Bool?
    var myTime: TimeInterval?

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "mappin")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(Palette.green, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Label(onSite == false ? "Off site" : "Clocked in", systemImage: "circle.fill")
                    .labelStyle(JobsDotLabelStyle())
                    .font(.app(12, .semibold))
                    .foregroundStyle(Color.white.opacity(0.85))
                Text(project.name).font(.app(17, .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(project.cardAddress ?? "No address on file")
                    .font(.app(13)).foregroundStyle(Color.white.opacity(0.82)).lineLimit(1)
                BudgetProgressBadge(progress: project.budget, dark: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let myTime {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(DurationFormat.hoursMinutes(myTime)).font(.app(20, .bold)).foregroundStyle(.white).monospacedDigit()
                    Text("Your hours").font(.app(11, .medium)).foregroundStyle(Color.white.opacity(0.82))
                }
            }
        }
        .padding(.vertical, 6)
    }
}

/// A small coloured dot before the label text.
private struct JobsDotLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 7)).foregroundStyle(Color(hex: 0xa9f1c4))
            configuration.title
        }
    }
}

/// One job or lead in the list.
struct JobsRow: View {
    var project: Project
    var myTime: TimeInterval?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mappin")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Palette.teal)
                .frame(width: 42, height: 42)
                .background(Palette.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(.app(16, .semibold)).foregroundStyle(.primary).lineLimit(1)
                Text(project.cardAddress ?? "No address on file")
                    .font(.app(13)).foregroundStyle(.secondary).lineLimit(1)
                if project.isLead {
                    Text("Lead · \(project.leadStageLabel)")
                        .font(.app(11, .semibold))
                        .foregroundStyle(Palette.teal)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Palette.teal.opacity(0.12), in: Capsule())
                        .padding(.top, 4)
                } else {
                    BudgetProgressBadge(progress: project.budget, dark: false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let myTime {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(DurationFormat.hoursMinutes(myTime)).font(.app(15, .semibold)).foregroundStyle(Palette.green).monospacedDigit()
                    Text("Your hours").font(.app(11)).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
