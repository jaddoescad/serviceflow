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

    @State private var search = Debouncer()
    @State private var results: [Project] = []
    @State private var searching = false
    @State private var searchError: String?
    @State private var selected: Project?
    @State private var latest: Project?
    @State private var loadingLatest = true
    @State private var latestError: String?
    @State private var userPoint: LocationPoint?
    @State private var clockingIn = false
    @State private var clockInError: String?
    @FocusState private var searchFocused: Bool

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
        VStack(spacing: 0) {
            header
            ZStack(alignment: .top) {
                ClockInMap(projects: session.mappedProjects, selected: displayProject, userPoint: $userPoint) { project in
                    hideKeyboard()
                    select(project)
                }
                projectCard.padding(.horizontal, 14).padding(.top, 14)
                VStack {
                    Spacer()
                    if displayProject?.isLead != true { clockInCluster.padding(.bottom, 22) }
                }
            }
            .clipped()
        }
        .background(Color.white)
        .task { await loadLatest() }
        .task(id: search.committed) { await runSearch(search.committed) }
        .onChange(of: search.text) { _, value in
            if !value.trimmingCharacters(in: .whitespaces).isEmpty { searching = true } else {
                searching = false
                results = []
                searchError = nil
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(session.displayName).text(15, .black, Palette.ink).padding(.bottom, 6)
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(DurationFormat.headerHours(tracker.workedToday())).text(22, .black, Palette.ink, tracking: -0.5)
                    Text("Hours used today").text(12.5, .bold, Palette.muted)
                }
            }
            searchField.padding(.top, 14)
            if !search.text.trimmingCharacters(in: .whitespaces).isEmpty { resultsCard.padding(.top, 10) }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
        .background(Color.white)
        .zIndex(1)
    }

    private var searchField: some View {
        @Bindable var search = search
        return HStack(spacing: 10) {
            Icon("magnifyingglass", 20, Palette.muted)
            TextField("", text: $search.text, prompt: Text("Search all projects and leads").foregroundColor(Palette.muted))
                .font(.app(15, .bold))
                .foregroundStyle(Palette.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .onSubmit { searchFocused = false }
            if searching {
                Spinner(color: Palette.teal)
            } else if !search.text.isEmpty {
                Button { search.clear() } label: { Icon("xmark.circle.fill", 20, Palette.muted) }
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .bordered(18, border: Color(hex: 0xe3ebe7), background: Color(hex: 0xf4f7f5))
    }

    private var resultsCard: some View {
        ScrollView {
            VStack(spacing: 0) {
                if results.isEmpty, !searching {
                    Text(searchError ?? "No matching projects or leads found.")
                        .text(13, .bold, Palette.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
                ForEach(results) { result in
                    Button { select(result) } label: { resultRow(result) }
                        .buttonStyle(.pressable)
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: 280)
        .fixedSize(horizontal: false, vertical: true)
        .bordered(18)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .cardShadow(opacity: 0.08, radius: 10, y: 4)
    }

    private func resultRow(_ result: Project) -> some View {
        HStack(spacing: 10) {
            Icon("mappin", 15, Palette.teal)
                .frame(width: 30, height: 30)
                .background(Color(hex: 0xe9f3ee), in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 7) {
                    Text(result.name).text(13, .black, Palette.ink).lineLimit(1)
                    if result.isLead {
                        Text("LEAD").text(8.5, .black, Color(hex: 0x245c9c), tracking: 0.5)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color(hex: 0xe8f1ff), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
                Text(result.cardAddress ?? "No address on file").text(11.5, .semibold, Palette.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: 0xeef1ef)).frame(height: 1) }
    }

    // MARK: Project card

    private var projectCard: some View {
        Button {
            hideKeyboard()
            if let project = displayProject { session.open(project) }
        } label: {
            HStack(spacing: 12) {
                Icon("map.fill", 22, Palette.teal)
                    .frame(width: 42, height: 42)
                    .background(Color(hex: 0xe9f3ee), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    if loadingLatest, displayProject == nil {
                        Spinner(color: Palette.teal)
                    } else if let project = displayProject {
                        Text(project.name).text(15, .black, Palette.ink, tracking: -0.2).lineLimit(1)
                        Text(project.cardAddress ?? "No address on file").text(12.5, .semibold, Palette.muted).lineLimit(1)
                    } else {
                        Text("No active project").text(15, .black, Palette.ink, tracking: -0.2)
                        Text(latestError ?? "No active jobs are available.").text(12.5, .semibold, Palette.muted).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                if displayProject != nil { Icon("chevron.right", 20, Palette.muted) }
            }
            .padding(12)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
            .cardShadow(opacity: 0.08, radius: 10, y: 4)
        }
        .buttonStyle(.pressable(opacity: 0.85, scale: 0.99))
        .disabled(displayProject == nil)
    }

    // MARK: Clock In

    private var clockInCluster: some View {
        VStack(spacing: 10) {
            if let message = tracker.notice?.message ?? clockInError {
                HStack(alignment: .top, spacing: 8) {
                    Icon("exclamationmark.circle.fill", 16, Palette.navy)
                    Text(message).text(12.5, .bold, Palette.ink).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .bordered(8)
                .cardShadow(opacity: 0.12, radius: 8, y: 4)
                .frame(maxWidth: UIScreen.main.bounds.width * 0.86)
            }
            Button(action: startClockIn) {
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(Color.white)
                        if clockingIn { Spinner(color: Palette.navy) } else { Icon("play.fill", 16, Palette.navy) }
                    }
                    .frame(width: 38, height: 38)
                    Text(clockingIn ? "Clocking In" : "Clock In").text(16, .black, .white, tracking: 0.3)
                }
                .padding(.leading, 6)
                .padding(.trailing, 26)
                .padding(.vertical, 6)
                .background(Palette.navy, in: Capsule())
                .cardShadow(opacity: 0.2, radius: 12, y: 6)
            }
            .buttonStyle(.pressable(opacity: 0.9, scale: 0.98))
            .disabled(clockingIn || displayProject == nil)
            .opacity(clockingIn || displayProject == nil ? 0.55 : 1)
            .accessibilityLabel("Start clock in")
        }
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
        results = []
        searchError = nil
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

    private func runSearch(_ query: String) async {
        guard !query.isEmpty else { return }
        do {
            let found = try await session.api.searchProjects(query)
            guard query == search.committed else { return }
            results = found
            searchError = nil
        } catch {
            guard query == search.committed else { return }
            results = []
            searchError = (error as? BackendError)?.message ?? error.localizedDescription
        }
        searching = false
    }
}
