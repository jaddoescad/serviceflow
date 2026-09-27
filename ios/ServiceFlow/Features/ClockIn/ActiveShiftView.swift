import ServiceFlowCore
import SwiftUI

/// The running shift: timer, start-time edits, photos and tasks.
struct ActiveShiftView: View {
    var enabled: Bool
    var onClockedOut: (TimeEntry) -> Void

    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker

    @State private var clockingOut = false
    @State private var switching = false
    @State private var adjusting = false
    @State private var actionError: String?
    @State private var showSwitcher = false

    private var shift: TimeEntry? { tracker.activeShift }
    private var project: Project? {
        guard let shift else { return nil }
        return session.mappedProjects.first { $0.id == shift.project.id } ?? shift.project
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                shiftCard
                if let project {
                    JobPhotosPanel(project: project, showCamera: true) { session.open(project, action: .photos) }
                    LabourTasksPanel(project: project, showHoursMeter: true, enabled: enabled)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(project?.name ?? "Clocked In")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    actionError = nil
                    showSwitcher = true
                } label: {
                    Label("Change Job", systemImage: "arrow.left.arrow.right")
                }
                .disabled(switching)
            }
        }
        .sheet(isPresented: $showSwitcher) {
            ProjectSwitcherSheet(currentProject: project, switching: switching, error: actionError) { next in
                switchTo(next)
            }
            .environment(session)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .interactiveDismissDisabled(switching)
        }
    }

    // MARK: Shift card

    private var shiftCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(project?.cardAddress ?? "No address on file").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                if let message = statusMessage {
                    Label(message, systemImage: tracker.locationStatus?.onSite == false ? "exclamationmark.triangle.fill" : "location.fill")
                        .font(.footnote)
                        .foregroundStyle(tracker.locationStatus?.onSite == false ? Color(hex: 0xb56025) : Palette.teal)
                }
            }

            if let suggestion = tracker.suggestedProject {
                Button { switchTo(suggestion) } label: {
                    Label(switching ? "Switching…" : "Switch to \(suggestion.name)", systemImage: "arrow.left.arrow.right")
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(Palette.teal)
                .disabled(switching)
            }

            TimelineView(.periodic(from: .now, by: 1)) { context in
                let parts = DurationFormat.shiftTimer(shift.map { context.date.timeIntervalSince($0.startedAt) } ?? 0)
                HStack(alignment: .lastTextBaseline, spacing: 0) {
                    Text(parts.main).font(.system(size: 48, weight: .bold, design: .rounded)).monospacedDigit()
                    Text(":\(parts.seconds)").font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Shift time \(parts.main) and \(parts.seconds) seconds")
            }

            Button(role: .destructive, action: clockOut) {
                ZStack {
                    Label("Clock Out", systemImage: "stop.circle.fill").opacity(clockingOut ? 0 : 1)
                    if clockingOut { ProgressView().tint(.white) }
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 30)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Palette.red)
            .disabled(clockingOut)
            .accessibilityLabel("Clock out current shift")

            if let actionError {
                Text(actionError).font(.footnote).foregroundStyle(Palette.red)
            }

            Divider()

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Started").font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        Text(DateText.time(shift?.startedAt)).font(.headline)
                        if let minutes = shift?.startAdjustmentMinutes {
                            Text("Edited \(minutes > 0 ? "+" : "")\(minutes)m").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer()
                ControlGroup {
                    Button { adjust(-5) } label: { Text("−5m") }
                        .accessibilityLabel("Move start time 5 minutes earlier")
                    Button { adjust(5) } label: { Text("+5m") }
                        .accessibilityLabel("Move start time 5 minutes later")
                }
                .controlGroupStyle(.navigation)
                .fixedSize()
                .disabled(adjusting)
            }

            Divider()

            Button {
                if let project { session.open(project) }
            } label: {
                HStack {
                    Label("View Project", systemImage: "folder")
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.navy)
            .accessibilityLabel("View project details")
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var statusMessage: String? {
        if let notice = tracker.notice?.message { return notice }
        if !session.locationAuthorization.isAuthorized { return "Location isn't recorded for this shift." }
        return tracker.locationStatus?.label
    }

    // MARK: Actions

    private func clockOut() {
        guard !clockingOut, let project else { return }
        clockingOut = true
        actionError = nil
        // Show the job while the shift closes, so the map never flashes.
        session.open(project)
        Task {
            if let entry = await session.clockOut(reason: .manual) {
                onClockedOut(entry)
            } else {
                actionError = "Clock out could not complete. Try again."
            }
            clockingOut = false
        }
    }

    private func adjust(_ minutes: Int) {
        guard !adjusting else { return }
        adjusting = true
        actionError = nil
        Task {
            do {
                try await tracker.adjustActiveStart(byMinutes: minutes)
            } catch {
                actionError = error.localizedDescription
            }
            adjusting = false
        }
    }

    private func switchTo(_ next: Project) {
        guard !switching else { return }
        guard next.id != project?.id else {
            showSwitcher = false
            return
        }
        switching = true
        actionError = nil
        Task {
            do {
                try await session.switchProject(to: next)
                hideKeyboard()
                showSwitcher = false
            } catch {
                actionError = error.localizedDescription.isEmpty ? "Switch could not complete. Try again." : error.localizedDescription
            }
            switching = false
        }
    }
}
