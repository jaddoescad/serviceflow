import ServiceFlowCore
import SwiftUI

/// A crew member on this job, pushed from "Hours by Crew".
struct ProjectDetailPainterRoute: Hashable {
    let userId: String
}

/// One of your own clock-ins, pushed for editing.
struct ProjectDetailEditRoute: Hashable {
    let entryId: String
}

/// A job or lead: its clock-ins, hours, tasks, photos and videos, and a
/// job's documents.
struct ProjectDetailScreen: View {
    enum Tab: Hashable { case clock, media, documents }

    let route: ProjectRoute

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker
    @State private var model: ProjectDetailModel
    @State private var tab: Tab
    @State private var mediaStore: MediaStore?
    @State private var cameraOpen = false
    @State private var overBudget: OverBudgetPromptItem?
    @State private var liveNow = Date()
    @State private var handledAction = false

    init(route: ProjectRoute) {
        self.route = route
        _model = State(initialValue: ProjectDetailModel(project: route.project))
        _tab = State(initialValue: route.project.isLead || route.action != nil ? .media : .clock)
    }

    private var project: Project { route.project }
    private var jobId: String { project.id }

    private var title: String {
        let name = project.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        let contact = project.contactName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return contact.isEmpty ? "Project" : contact
    }

    private var addedLabel: String {
        guard let created = project.createdAt else { return "Added recently" }
        return "Added \(DateText.canadianShortDate(created))"
    }

    var body: some View {
        // Built once per render and shared by the tab and the pushed screens.
        let entries = visibleEntries
        let summaries = ProjectClockIns.summaries(entries: entries, activeShift: nil, projectId: jobId,
                                                  userId: session.user.id, now: liveNow)
        Group {
            switch tab {
            case .clock:
                ProjectDetailClockInsTab(project: project, title: title, model: model, summaries: summaries,
                                         onOpenMedia: { tab = .media }, onOverBudget: { overBudget = $0 })
            case .media:
                mediaTab
            case .documents:
                ProjectDocumentsTab(project: project)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if !project.isLead { tabPicker }
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
        .navigationDestination(for: ProjectDocumentRoute.self) { documentRoute in
            ProjectDocumentPageScreen(document: documentRoute.document)
        }
        .navigationDestination(for: ProjectDetailEditRoute.self) { editRoute in
            if let entry = entries.first(where: { $0.localId == editRoute.entryId }) {
                ProjectDetailEditTime(entry: entry, painterName: session.displayName) { deleted in
                    if deleted { model.removeLocally(entry) }
                    Task { await model.refresh(api: session.api) }
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
            // Team time and budget, every 45 s while the screen is open.
            guard !project.isLead else { return }
            while !Task.isCancelled {
                await model.refresh(api: session.api)
                try? await Task.sleep(nanoseconds: 45_000_000_000)
            }
        }
        .task {
            // Running shifts on this job tick every 15 s.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if tracker.activeShift != nil || model.hasRunningEntry { liveNow = Date() }
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

    /// This job's entries; crew only see their own.
    private var visibleEntries: [TimeEntry] {
        let all = model.entries(local: tracker.allEntries)
        return session.isManager ? all : all.filter { $0.userId == session.user.id }
    }

    private var tabPicker: some View {
        Picker("Section", selection: $tab) {
            Label("Clock Ins", systemImage: "clock").tag(Tab.clock)
            Label("Media", systemImage: "photo.on.rectangle").tag(Tab.media)
            Label("Documents", systemImage: "doc.text").tag(Tab.documents)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: Media

    private var mediaTab: some View {
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
