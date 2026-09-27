import ServiceFlowCore
import SwiftUI

/// A painter on this job, pushed from "Hours by Crew".
struct ProjectDetailPainterRoute: Hashable {
    let userId: String
}

/// One of your own clock-ins, pushed for editing.
struct ProjectDetailEditRoute: Hashable {
    let entryId: String
}

/// A job or lead: its clock-ins, hours, tasks, photos and videos.
struct ProjectDetailScreen: View {
    enum Tab: Hashable { case clock, media }

    let route: ProjectRoute

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker
    @State private var model: ProjectDetailModel
    @State private var tab: Tab
    @State private var mediaStore: MediaStore?
    @State private var cameraOpen = false
    @State private var clockPending = false
    @State private var clockError: String?
    @State private var overBudget: OverBudgetPromptItem?
    @State private var liveNow = Date()
    @State private var handledAction = false

    init(route: ProjectRoute) {
        self.route = route
        _model = State(initialValue: ProjectDetailModel(project: route.project))
        _tab = State(initialValue: route.project.isLead || route.action != nil ? .media : .clock)
    }

    private var project: Project { route.project }
    private var isLead: Bool { project.isLead }
    private var jobId: String { project.id }

    private var title: String { project.name.nonBlankValue ?? project.contactName?.nonBlankValue ?? "Project" }

    private var addedLabel: String {
        guard let created = project.createdAt else { return "Added recently" }
        return "Added \(DateText.canadianShortDate(created))"
    }

    private var isActiveProject: Bool {
        tracker.activeShift?.project.id == jobId && !tracker.isClockingOut
    }

    /// Entries on this job; crew only see their own.
    private var entries: [TimeEntry] {
        let all = model.entries(local: tracker.allEntries)
        return session.isManager ? all : all.filter { $0.userId == session.user.id }
    }

    private var summaries: [PainterClockInSummary] {
        ProjectClockIns.summaries(entries: entries, activeShift: nil, projectId: jobId, userId: session.user.id, now: liveNow)
    }

    var body: some View {
        Group {
            switch tab {
            case .clock: clockInsList
            case .media: mediaScroll
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if !isLead {
                Picker("Section", selection: $tab) {
                    Label("Clock Ins", systemImage: "clock").tag(Tab.clock)
                    Label("Media", systemImage: "photo.on.rectangle").tag(Tab.media)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.bar)
            }
        }
        .overlay(alignment: .bottomTrailing) { cameraButton }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .projectDetailSubtitle(addedLabel, title: title)
        .navigationDestination(for: ProjectDetailPainterRoute.self) { painterRoute in
            if let summary = summaries.first(where: { $0.userId == painterRoute.userId }) {
                ProjectDetailPainterDetail(summary: summary, now: liveNow)
            } else {
                ContentUnavailableView("No clock-ins", systemImage: "clock")
            }
        }
        .navigationDestination(for: ProjectDetailEditRoute.self) { editRoute in
            if let entry = entries.first(where: { $0.localId == editRoute.entryId }) {
                ProjectDetailEditTime(entry: entry, painterName: session.displayName) { deleted in
                    if deleted { model.removeLocally(entry) }
                    Task {
                        await model.refreshBudget(api: session.api)
                        await model.refreshEntries(api: session.api)
                    }
                }
            } else {
                ContentUnavailableView("Clock-in not found", systemImage: "clock.badge.xmark")
            }
        }
        .onChange(of: tab) { _, newTab in
            // Opening Media always reloads it.
            if newTab == .media { Task { await mediaStore?.load() } }
        }
        .task {
            if mediaStore == nil {
                mediaStore = MediaStore(project: project, session: session, includeLinkedLead: true)
            }
            if route.action == .camera, !handledAction { openCamera() }
            handledAction = true
        }
        .task(id: jobId) {
            guard !isLead else { return }
            while !Task.isCancelled {
                async let budget: Void = model.refreshBudget(api: session.api)
                async let team: Void = model.refreshEntries(api: session.api)
                _ = await (budget, team)
                try? await Task.sleep(nanoseconds: 45_000_000_000)
            }
        }
        .task {
            // Running shifts on this job tick every 15 s.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if entries.contains(where: \.isActive) || tracker.activeShift != nil { liveNow = Date() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { await model.refreshBudget(api: session.api) }
        }
        .fullScreenCover(isPresented: $cameraOpen) {
            CameraScreen(projectName: title, projectId: jobId, projectKind: project.kind) {
                cameraOpen = false
                tab = .media
            }
            .environment(session)
        }
        .overBudgetPrompt(item: $overBudget)
    }

    // MARK: Camera

    private var cameraButton: some View {
        let deleting = mediaStore?.deletingId != nil
        return Button(action: openCamera) {
            Group {
                if deleting {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "camera.fill").font(.system(size: 22, weight: .semibold))
                }
            }
            .frame(width: 30, height: 30)
            .padding(8)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.circle)
        .tint(DetailPalette.brand)
        .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
        .disabled(jobId.isEmpty || deleting)
        .padding(.trailing, 20)
        .padding(.bottom, 20)
        .accessibilityLabel("Take project photo")
    }

    private func openCamera() {
        guard !jobId.isEmpty, mediaStore?.deletingId == nil else { return }
        tab = .media
        session.uploads?.clearCompleted()
        cameraOpen = true
    }

    // MARK: Media tab

    private var mediaScroll: some View {
        ScrollView {
            Group {
                if let mediaStore {
                    ProjectMediaPanel(store: mediaStore, project: project)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 58)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 96)
        }
        .refreshable { await mediaStore?.load() }
    }

    // MARK: Clock Ins tab

    private var clockInsList: some View {
        let summaries = self.summaries
        return List {
            Section {
                infoRow
                if isActiveProject, let shift = tracker.activeShift { currentRow(shift) }
            }

            Section {
                hoursPanel
            }

            Section {
                clockButton
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } footer: {
                if let feedback = tracker.notice?.message ?? clockError {
                    Text(feedback).foregroundStyle(Palette.red).frame(maxWidth: .infinity)
                }
            }

            Section {
                JobPhotosPanel(project: project, showCamera: false) { tab = .media }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            Section {
                if summaries.isEmpty {
                    ContentUnavailableView {
                        Label("No clock-ins yet", systemImage: "clock")
                    } description: {
                        Text("Time entries will appear here after the crew clocks into this project.")
                    }
                } else {
                    ForEach(summaries) { summary in
                        NavigationLink(value: ProjectDetailPainterRoute(userId: summary.userId)) {
                            ProjectDetailPainterRow(summary: summary)
                        }
                    }
                }
            } header: {
                recentHeader(summaries)
            }

            Section {
                LabourTasksPanel(project: project, showHoursMeter: false, enabled: true)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            Color.clear.frame(height: 60).listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(16)
        .refreshable {
            async let budget: Void = model.refreshBudget(api: session.api)
            async let team: Void = model.refreshEntries(api: session.api)
            _ = await (budget, team)
        }
    }

    private var infoRow: some View {
        HStack(spacing: 12) {
            Text(Initials.of(title, fallback: "P"))
                .font(.app(14, .semibold))
                .foregroundStyle(DetailPalette.brand)
                .frame(width: 42, height: 42)
                .background(DetailPalette.brand.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.app(16, .semibold)).lineLimit(1)
                Label(project.fullAddress ?? "No address on file", systemImage: "mappin")
                    .font(.app(13))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    private func currentRow(_ shift: TimeEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.fill")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(DetailPalette.brand, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Current clock-in · since \(DateText.time(shift.startedAt))")
                    .font(.app(13)).foregroundStyle(.secondary)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(DurationFormat.elapsedClock(shift.duration(at: context.date)))
                        .font(.app(22, .semibold)).monospacedDigit()
                }
            }
            Spacer(minLength: 0)
            Circle().fill(Color(hex: 0x27ae60)).frame(width: 10, height: 10)
        }
        .padding(.vertical, 2)
    }

    private var hoursPanel: some View {
        let me = session.user
        let mine = entries.filter { $0.userId == me.id || ($0.userEmail != nil && $0.userEmail == me.email) }
        let yourSeconds = mine.reduce(0) { $0 + $1.duration(at: liveNow) }
        let teamSeconds = entries.reduce(0) { $0 + $1.duration(at: liveNow) }
        return BudgetHoursPanel(
            progress: model.shownBudget,
            loading: model.budgetLoading,
            yourHours: HoursFormat.fromMilliseconds(yourSeconds * 1000),
            secondaryLabel: session.isManager ? "Team total" : "Entries shown",
            secondaryValue: HoursFormat.fromMilliseconds(teamSeconds * 1000)
        )
        .padding(.vertical, 6)
    }

    private var clockButton: some View {
        let (label, icon): (String, String) = isActiveProject
            ? ("Clock Out", "stop.circle.fill")
            : tracker.activeShift != nil ? ("Switch Job", "arrow.left.arrow.right") : ("Clock In", "play.fill")
        return Button(action: runClockAction) {
            HStack(spacing: 8) {
                if clockPending {
                    ProgressView().tint(.white)
                    Text("Working…")
                } else {
                    Image(systemName: icon)
                    Text(label)
                }
            }
            .font(.app(17, .semibold))
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .tint(isActiveProject ? Palette.red : DetailPalette.brand)
        .disabled(clockPending || tracker.isClockingOut)
    }

    private func recentHeader(_ summaries: [PainterClockInSummary]) -> some View {
        let days = ProjectClockIns.dayCount(summaries, userId: session.user.id)
        return HStack {
            Text(session.isManager ? "Hours by Crew" : "Your Clock-ins")
            Spacer()
            Text(session.isManager ? "\(summaries.count) crew" : "\(days) \(days == 1 ? "day" : "days")")
        }
    }

    // MARK: Actions

    private func runClockAction() {
        guard !clockPending else { return }
        clockPending = true
        clockError = nil
        tracker.clearNotice()
        Task {
            defer { clockPending = false }
            do {
                if isActiveProject {
                    guard await session.clockOut(reason: .projectDetail) != nil else {
                        clockError = "Clock out could not complete. Try again."
                        return
                    }
                    await model.refreshBudget(api: session.api)
                    if let hoursOver = await session.overBudgetHours(jobId: jobId) {
                        overBudget = OverBudgetPromptItem(jobId: jobId, projectName: title, hoursOver: hoursOver)
                    }
                } else if tracker.activeShift != nil {
                    guard try await session.switchProject(to: project) != nil else {
                        clockError = "Switch job could not complete. Try again."
                        return
                    }
                    await model.refreshBudget(api: session.api)
                    session.showClockIn()
                } else {
                    try await session.clockIn(project)
                    await model.refreshBudget(api: session.api)
                    session.showClockIn()
                }
            } catch {
                let message = error.localizedDescription
                clockError = message.isEmpty ? "Clock action could not complete. Try again." : message
            }
        }
    }
}

private extension View {
    /// The navigation bar subtitle (iOS 26), or a two-line title on older systems.
    @ViewBuilder
    func projectDetailSubtitle(_ subtitle: String, title: String) -> some View {
        if #available(iOS 26.0, *) {
            navigationSubtitle(subtitle)
        } else {
            toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(title).font(.headline).lineLimit(1)
                        Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
        }
    }
}

private extension String {
    var nonBlankValue: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
