import ServiceFlowCore
import SwiftUI

/// A job or lead: its clock-ins, hours, tasks, photos and videos.
struct ProjectDetailScreen: View {
    enum Tab { case clock, media }

    let route: ProjectRoute

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker
    @Environment(\.dismiss) private var dismiss
    @State private var model: ProjectDetailModel
    @State private var tab: Tab
    @State private var mediaStore: MediaStore?
    @State private var selectedPainterId: String?
    @State private var editing: TimeEntry?
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

    var body: some View {
        Group {
            if let editing {
                ProjectDetailEditTime(entry: editing, painterName: session.displayName, onClose: { self.editing = nil }) { deleted in
                    if deleted { model.removeLocally(editing) }
                    Task {
                        await model.refreshBudget(api: session.api)
                        await model.refreshEntries(api: session.api)
                    }
                }
            } else {
                screen
            }
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
        }
        .overBudgetPrompt(item: $overBudget)
    }

    // MARK: Layout

    private var screen: some View {
        VStack(spacing: 0) {
            header
            tabPills
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    switch tab {
                    case .clock: clockInsTab
                    case .media: mediaTab
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 4)
                .padding(.bottom, 120)
            }
        }
        .background(Color.white)
        .overlay(alignment: .bottomTrailing) {
            if selectedPainterId == nil || tab == .media {
                cameraButton
            }
        }
    }

    private var header: some View {
        HStack(spacing: 0) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(DetailPalette.ink)
                    .frame(width: 32, height: 36, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")
            VStack(alignment: .leading, spacing: 1) {
                Text(title).text(18, .bold, DetailPalette.ink, tracking: -0.2).lineLimit(1)
                Text(addedLabel).text(12, .medium, DetailPalette.muted).lineLimit(1)
            }
            .padding(.trailing, 8)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 8)
        .background(Color.white)
    }

    private var tabPills: some View {
        HStack(spacing: 8) {
            if !isLead {
                pill("Clock Ins", icon: "clock.fill", iconSize: 13, active: tab == .clock, accessibility: "Clock Ins") {
                    tab = .clock
                }
            }
            pill("Media", icon: "photo.on.rectangle", iconSize: 15, active: tab == .media, accessibility: "Photos and videos") {
                tab = .media
                // Every tap on Media reloads it.
                Task { await mediaStore?.reload() }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 10)
        .background(Color.white)
    }

    private func pill(_ title: String, icon: String, iconSize: CGFloat, active: Bool, accessibility: String,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: iconSize, weight: .semibold))
                    .foregroundStyle(active ? .white : DetailPalette.brand)
                Text(title).font(.app(13, active ? .bold : .semibold)).foregroundStyle(active ? .white : Color(hex: 0x5a6068))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(active ? DetailPalette.navy : DetailPalette.soft, in: Capsule())
            .overlay(Capsule().strokeBorder(active ? DetailPalette.navy : DetailPalette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var cameraButton: some View {
        Button(action: openCamera) {
            Image(systemName: "camera.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 58, height: 58)
                .background(DetailPalette.brand, in: Circle())
                .cardShadow(opacity: 0.2, radius: 14, y: 6)
        }
        .buttonStyle(.pressable(opacity: 0.85))
        .disabled(jobId.isEmpty)
        .padding(.trailing, 16)
        .padding(.bottom, 22)
        .accessibilityLabel("Take project photo")
    }

    private func openCamera() {
        guard !jobId.isEmpty else { return }
        tab = .media
        session.uploads?.clearCompleted()
        cameraOpen = true
    }

    // MARK: Media tab

    @ViewBuilder
    private var mediaTab: some View {
        if let mediaStore {
            ProjectMediaPanel(store: mediaStore, project: project)
        } else {
            ProgressView().tint(DetailPalette.brand).frame(maxWidth: .infinity).padding(.top, 58)
        }
    }

    // MARK: Clock Ins tab

    @ViewBuilder
    private var clockInsTab: some View {
        let summaries = ProjectClockIns.summaries(entries: entries, activeShift: nil, projectId: jobId,
                                                  userId: session.user.id, now: liveNow)
        if let selectedPainterId, let summary = summaries.first(where: { $0.userId == selectedPainterId }) {
            ProjectDetailPainterDetail(summary: summary, now: liveNow, onBack: { self.selectedPainterId = nil }) { entry in
                editing = entry
            }
        } else {
            infoCard
            if isActiveProject, let shift = tracker.activeShift { currentBanner(shift) }
            hoursCard
            clockButton
            if let feedback = tracker.notice?.message ?? clockError {
                Text(feedback).text(13, .bold, Palette.red).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.top, 10)
            }
            JobPhotosPanel(project: project, showCamera: false) { tab = .media }
                .padding(.top, 16)
                .padding(.bottom, 4)
            recentHeader(summaries)
            if summaries.isEmpty {
                emptyClockIns
            } else {
                ForEach(summaries) { summary in
                    ProjectDetailPainterRow(summary: summary) { selectedPainterId = summary.userId }
                }
            }
            LabourTasksPanel(project: project, showHoursMeter: false, enabled: true)
                .padding(.top, 18)
        }
    }

    private var infoCard: some View {
        HStack(spacing: 0) {
            Text(Initials.of(title, fallback: "P"))
                .text(14, .heavy, DetailPalette.brand, tracking: 0.3)
                .frame(width: 42, height: 42)
                .background(Color(hex: 0xeaf4f6), in: Circle())
                .padding(.trailing, 12)
            VStack(alignment: .leading, spacing: 0) {
                Text("PROJECT").text(10, .bold, DetailPalette.subtle, tracking: 1)
                Text(title).text(15, .bold, DetailPalette.ink, tracking: -0.1).lineLimit(1).padding(.top, 2)
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "mappin").font(.system(size: 14, weight: .semibold)).foregroundStyle(DetailPalette.brand)
                    Text(project.fullAddress ?? "No address on file")
                        .text(12, .medium, Color(hex: 0x73777a)).lineSpacing(2).lineLimit(2)
                }
                .padding(.top, 4)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .bordered(14, border: DetailPalette.border)
        .cardShadow(opacity: 0.03, radius: 6, y: 2)
    }

    private func currentBanner(_ shift: TimeEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.fill")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(DetailPalette.brand, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Current clock-in · since \(DateText.time(shift.startedAt))")
                    .text(12, .bold, Color(hex: 0x4a6b72), tracking: 0.1)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(DurationFormat.elapsedClock(shift.duration(at: context.date)))
                        .text(22, .heavy, DetailPalette.ink, tracking: 0.5).monospacedDigit()
                }
            }
            Spacer(minLength: 0)
            Circle().fill(Color(hex: 0x27ae60)).frame(width: 10, height: 10)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .bordered(14, border: Color(hex: 0xcfe6ea), background: Color(hex: 0xeaf4f6))
        .padding(.top, 12)
    }

    private var hoursCard: some View {
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
        .padding(.vertical, 13)
        .padding(.horizontal, 14)
        .bordered(14, border: DetailPalette.border)
        .padding(.top, 12)
    }

    private var clockButton: some View {
        let (label, icon): (String, String) = isActiveProject
            ? ("Clock Out", "stop.circle")
            : tracker.activeShift != nil ? ("Switch Job", "arrow.left.arrow.right") : ("Clock In", "play.fill")
        return Button(action: runClockAction) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(DetailPalette.brand).frame(width: 28, height: 28)
                    if clockPending {
                        Spinner(color: .white)
                    } else {
                        Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                    }
                }
                Text(clockPending ? "Working…" : label).text(15, .bold, DetailPalette.brand, tracking: 0.1)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(DetailPalette.brand, lineWidth: 1.5))
            .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
            .opacity(clockPending ? 0.6 : 1)
        }
        .buttonStyle(.plain)
        .disabled(clockPending || tracker.isClockingOut)
        .padding(.top, 14)
    }

    private func recentHeader(_ summaries: [PainterClockInSummary]) -> some View {
        let days = ProjectClockIns.dayCount(summaries, userId: session.user.id)
        return HStack {
            Text(session.isManager ? "Hours by Crew" : "Your Clock-ins").text(15, .heavy, DetailPalette.ink)
            Spacer()
            Text(session.isManager ? "\(summaries.count) crew" : "\(days) \(days == 1 ? "day" : "days")")
                .text(13, .bold, DetailPalette.brand)
        }
        .padding(.horizontal, 2)
        .padding(.top, 22)
        .padding(.bottom, 10)
    }

    private var emptyClockIns: some View {
        VStack(spacing: 0) {
            Image(systemName: "clock.fill").font(.system(size: 28)).foregroundStyle(DetailPalette.brand)
                .frame(width: 44, height: 44).padding(.bottom, 6)
            Text("No clock-ins yet").text(15, .bold, DetailPalette.ink)
            Text("Time entries will appear here after the crew clocks into this project.")
                .text(12, .medium, DetailPalette.muted).lineSpacing(3).multilineTextAlignment(.center).padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 6)
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

private extension String {
    var nonBlankValue: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
