import ServiceFlowCore
import SwiftUI

/// The Clock In tab: a map to pick a job while clocked out, the running
/// shift while clocked in.
struct ClockInScreen: View {
    var enabled: Bool
    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker
    @State private var overBudget: OverBudgetPromptItem?

    var body: some View {
        Group {
            if tracker.activeShift != nil {
                ActiveShiftView(enabled: enabled, onClockedOut: promptOverBudget)
            } else {
                ClockedOutView()
            }
        }
        .overBudgetPrompt(item: $overBudget)
    }

    private func promptOverBudget(_ entry: TimeEntry) {
        Task {
            guard let hours = await session.overBudgetHours(jobId: entry.project.id) else { return }
            overBudget = OverBudgetPromptItem(jobId: entry.project.id, projectName: entry.project.name, hoursOver: hours)
        }
    }
}

// MARK: - Clocked out

struct ClockedOutView: View {
    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker

    @State private var search = ProjectSearch()
    @State private var selected: Project?
    @State private var latest: Project?
    @State private var loadingLatest = true
    @State private var latestError: String?
    @State private var userPoint: LocationPoint?
    @State private var clockingIn = false
    @State private var clockInError: String?

    /// The pin or result tapped, else the nearest job within 2 km, else the most recent job.
    private var displayProject: Project? {
        if let selected { return selected }
        if let userPoint, let nearest = Geo.nearest(session.mappedProjects, to: userPoint.coordinate),
           nearest.distance <= TrackingConstants.nearestProjectRadius {
            return nearest.project
        }
        return latest
    }

    var body: some View {
        @Bindable var query = search.query
        ClockInMap(projects: session.mappedProjects, selected: displayProject, userPoint: $userPoint) { project in
            select(project)
        }
        .ignoresSafeArea(edges: .horizontal)
        .safeAreaInset(edge: .bottom) {
            if displayProject?.isLead != true || displayProject == nil { clockInPanel }
        }
        .overlay { if search.hasQuery { searchResults } }
        .navigationTitle("Clock In")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query.text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search jobs and leads")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .task { await loadLatest() }
        .task(id: search.query.committed) { await search.run(session.api) }
        .onChange(of: search.query.text) { _, _ in search.textChanged() }
    }

    // MARK: Search

    private var searchResults: some View {
        List {
            if search.isSearching && search.results.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if search.results.isEmpty {
                Text(search.error ?? "No matching jobs or leads found.").foregroundStyle(.secondary)
            }
            ForEach(search.results) { result in
                Button { select(result) } label: { ProjectListRow(project: result) }
                    .foregroundStyle(.primary)
            }
        }
        .listStyle(.plain)
    }

    // MARK: Bottom panel

    private var clockInPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(session.displayName).font(.subheadline.weight(.semibold))
                Spacer()
                TimelineView(.periodic(from: .now, by: 30)) { _ in
                    Text("\(DurationFormat.hoursMinutes(tracker.workedToday())) today")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Button {
                if let project = displayProject { session.open(project) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "mappin.circle.fill")
                        .font(.title2)
                        .foregroundStyle(Palette.teal)
                    VStack(alignment: .leading, spacing: 2) {
                        if loadingLatest, displayProject == nil {
                            ProgressView()
                        } else if let project = displayProject {
                            Text(project.name).font(.headline).lineLimit(1)
                            Text(project.cardAddress ?? "No address on file").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        } else {
                            Text("No active job").font(.headline)
                            Text(latestError ?? "Search for a job to clock in.").font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                    if displayProject != nil {
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(displayProject == nil)

            if let message = tracker.notice?.message ?? clockInError {
                Label(message, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Button(action: startClockIn) {
                ZStack {
                    Label("Clock In", systemImage: "play.fill").opacity(clockingIn ? 0 : 1)
                    if clockingIn { ProgressView().tint(.white) }
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 30)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Palette.navy)
            .disabled(clockingIn || displayProject == nil || displayProject?.isLead == true)
            .accessibilityLabel("Start clock in")
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private func startClockIn() {
        guard !clockingIn, let project = displayProject else { return }
        hideKeyboard()
        clockingIn = true
        clockInError = nil
        tracker.clearNotice()
        Task {
            do {
                try await session.clockIn(project)
                selected = nil
            } catch {
                clockInError = error.localizedDescription.isEmpty ? "Clock in could not start. Try again." : error.localizedDescription
            }
            clockingIn = false
        }
    }

    // MARK: Data

    private func select(_ project: Project) {
        hideKeyboard()
        selected = project
        search.clear()
        clockInError = nil
    }

    private func loadLatest() async {
        loadingLatest = true
        do {
            latest = try await session.api.latestActiveProject()
            latestError = nil
        } catch {
            latestError = (error as? BackendError)?.message
        }
        loadingLatest = false
    }
}
