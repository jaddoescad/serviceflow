import ServiceFlowCore
import SwiftUI

/// The Jobs tab: the current job, active or assigned jobs, and search.
struct JobsScreen: View {
    let enabled: Bool

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker
    @State private var model = JobsModel()
    @State private var search = Debouncer()
    @FocusState private var searchFocused: Bool

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
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                header
                searchBar
                if let error = model.error, !error.isEmpty {
                    Text(error).text(13, .bold, Color(hex: 0xb42318))
                        .padding(.horizontal, 20).padding(.bottom, 10)
                }
                if !model.hasLoaded {
                    VStack(spacing: 10) {
                        ProgressView().tint(Palette.teal)
                        Text("Loading projects…").text(14, .bold, Palette.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 60)
                } else {
                    content
                }
                Color.clear.frame(height: 110)
            }
            .padding(.top, 6)
            .padding(.bottom, 24)
        }
        .background(Color.white)
        .scrollDismissesKeyboard(.interactively)
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("SERVICEFLOW").text(11.5, .heavy, Palette.teal, tracking: 1.4).padding(.bottom, 3)
            Text("Jobs").text(28, .black, Palette.ink, tracking: -0.6)
        }
        .padding(.horizontal, 20)
        .padding(.top, 6)
        .padding(.bottom, 16)
    }

    private var searchBar: some View {
        @Bindable var search = search
        return HStack(spacing: 12) {
            Image(systemName: "magnifyingglass").font(.system(size: 21, weight: .regular)).foregroundStyle(Palette.muted)
            TextField("", text: $search.text, prompt: Text("Search jobs and leads").foregroundColor(Palette.muted))
                .font(.app(15, .semibold))
                .foregroundStyle(Palette.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .onSubmit { hideKeyboard() }
            if !search.text.isEmpty {
                Button {
                    search.clear()
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 19)).foregroundStyle(Palette.muted)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 54)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { searchFocused = true }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private var content: some View {
        if let featured {
            JobsCurrentCard(project: featured, onSite: tracker.activeShift?.onSite, myTime: myTime[featured.id]) {
                session.open(featured)
            }
        }
        if !isSearching {
            HStack(spacing: 8) {
                chip("Active", .active)
                chip("Assigned", .assigned)
            }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 14)
        }
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(sectionTitle).text(17, .black, Palette.ink, tracking: -0.2)
            Text("(\(sectionCount))").text(15, .bold, Palette.muted)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)

        ForEach(remaining) { project in
            JobsRow(project: project, myTime: myTime[project.id]) { session.open(project) }
        }
        if remaining.isEmpty, featured == nil {
            emptyCard
        }
        if model.hasMore {
            ZStack {
                if model.loadingMore { ProgressView().tint(Palette.green) }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 10)
            .onAppear { Task { await loadMore() } }
        }
    }

    private var sectionTitle: String {
        if isSearching { return "Search Results" }
        return model.filter == .assigned ? "Assigned Jobs" : "Active Jobs"
    }

    private var sectionCount: Int {
        (model.filter == .assigned || isSearching) ? filtered.count : visibleProjects.count
    }

    private func chip(_ title: String, _ value: JobsModel.Filter) -> some View {
        let active = model.filter == value
        return Button {
            model.filter = value
        } label: {
            Text(title)
                .text(13.5, .bold, active ? Palette.ink : Palette.muted)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.white, in: Capsule())
                .overlay(Capsule().strokeBorder(active ? Palette.ink : Palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var emptyCard: some View {
        let copy: (String, String)
        if isSearching {
            copy = ("No matching jobs", "Try another name, email, phone, address, city, or postal code.")
        } else if model.filter == .assigned {
            copy = ("No assigned jobs", "Assignments can be created from the office.")
        } else if session.isManager {
            copy = ("No active jobs yet", "New jobs from the office will appear here.")
        } else {
            copy = ("No active jobs yet", "Ask a manager to assign you to an active job.")
        }
        return VStack(alignment: .leading, spacing: 0) {
            Text(copy.0).text(17, .black, Palette.ink).padding(.bottom, 6)
            Text(copy.1).text(14, .regular, Palette.muted).lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .bordered(18)
        .padding(.horizontal, 20)
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

/// The teal card for the job you're clocked into.
struct JobsCurrentCard: View {
    var project: Project
    var onSite: Bool?
    var myTime: TimeInterval?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "mappin")
                    .font(.system(size: 29, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(Palette.green, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 6) {
                        Circle().fill(Color(hex: 0xa9f1c4)).frame(width: 7, height: 7)
                        Text(onSite == false ? "OFF SITE" : "CLOCKED IN")
                            .text(11, .heavy, Color.white.opacity(0.85), tracking: 1.1)
                    }
                    .padding(.bottom, 6)
                    Text(project.name).text(17, .black, .white, tracking: -0.3).lineLimit(1)
                    Text(project.cardAddress ?? "No address on file")
                        .text(13, .medium, Color.white.opacity(0.82)).lineLimit(1).padding(.top, 2)
                    BudgetProgressBadge(progress: project.budget, dark: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let myTime {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(DurationFormat.hoursMinutes(myTime)).text(26, .black, .white, tracking: 0.5).monospacedDigit()
                        Text("YOUR HOURS").text(11, .heavy, Color.white.opacity(0.82), tracking: 1.2).padding(.top, 2)
                    }
                    .padding(.leading, 6)
                }
            }
            .padding(16)
            .background(Palette.teal, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .cardShadow(Palette.green, opacity: 0.18, radius: 18, y: 10)
        }
        .buttonStyle(.pressable(opacity: 0.7))
        .padding(.horizontal, 20)
        .padding(.bottom, 22)
    }
}

/// One job or lead in the list.
struct JobsRow: View {
    var project: Project
    var myTime: TimeInterval?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "mappin")
                    .font(.system(size: 25, weight: .semibold))
                    .foregroundStyle(Palette.teal)
                    .frame(width: 52, height: 52)
                    .bordered(12, background: Palette.surface)
                VStack(alignment: .leading, spacing: 0) {
                    Text(project.name).text(15, .black, Palette.ink, tracking: -0.2).lineLimit(1)
                    Text(project.cardAddress ?? "No address on file")
                        .text(13, .medium, Palette.muted).lineLimit(1).padding(.top, 3)
                    if project.isLead {
                        Text("LEAD · \(project.leadStageLabel.uppercased())")
                            .text(10.5, .black, Palette.teal, tracking: 0.4)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(Color(hex: 0xe6f4f7), in: Capsule())
                            .padding(.top, 7)
                    } else {
                        BudgetProgressBadge(progress: project.budget, dark: false)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let myTime {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(DurationFormat.hoursMinutes(myTime)).text(15, .black, Palette.green, tracking: -0.2).monospacedDigit()
                        Text("YOUR HOURS").text(10, .heavy, Palette.muted, tracking: 1.1).padding(.top, 2)
                    }
                    .padding(.leading, 6)
                }
            }
            .padding(12)
            .bordered(16)
        }
        .buttonStyle(.pressable(opacity: 0.7))
        .padding(.horizontal, 20)
        .padding(.bottom, 10)
    }
}
