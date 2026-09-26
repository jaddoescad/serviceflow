import ServiceFlowCore
import SwiftUI

/// The running shift: job header, timer, start-time edits, photos and tasks.
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
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                header
                shiftCard.padding(.horizontal, 10).padding(.top, 12)
                if let project {
                    JobPhotosPanel(project: project, showCamera: true) { session.open(project, action: .photos) }
                        .padding(.horizontal, 10).padding(.top, 10)
                    LabourTasksPanel(project: project, showHoursMeter: true, enabled: enabled)
                        .padding(.horizontal, 10).padding(.top, 10)
                }
            }
            .padding(.bottom, 24)
        }
        .background(Color(hex: 0xf4f6f6))
        .sheet(isPresented: $showSwitcher) {
            ProjectSwitcherSheet(currentProject: project, switching: switching, error: actionError) { next in
                switchTo(next)
            }
            .presentationDetents([.fraction(0.82), .large])
            .presentationDragIndicator(.hidden)
            .interactiveDismissDisabled(switching)
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(project?.name ?? "Selected Project").text(18, .black, Palette.ink, tracking: -0.3).lineLimit(1)
                Text(project?.cardAddress ?? "No address on file").text(12.5, .medium, Palette.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button {
                actionError = nil
                showSwitcher = true
            } label: {
                HStack(spacing: 5) {
                    Icon("arrow.left.arrow.right", 15, Palette.teal)
                    Text("Change Job").text(11.5, .black, Palette.teal)
                }
                .padding(.horizontal, 10)
                .frame(minHeight: 34)
                .overlay(Capsule().strokeBorder(Color(hex: 0xb9d6cd), lineWidth: 1))
            }
            .buttonStyle(.pressable)
            .disabled(switching)
            .opacity(switching ? 0.55 : 1)
            .accessibilityLabel("Choose a different job")
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 13)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 1) }
    }

    // MARK: Shift card

    private var shiftCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            locationRow.padding(.top, 8)
            if let suggestion = tracker.suggestedProject {
                Button { switchTo(suggestion) } label: {
                    HStack(spacing: 7) {
                        if switching { Spinner(color: .white) } else { Icon("arrow.left.arrow.right", 16, .white) }
                        Text(switching ? "Switching…" : "Switch to \(suggestion.name)").text(13, .black, .white).lineLimit(1)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Palette.teal, in: Capsule())
                }
                .disabled(switching)
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
                .accessibilityLabel("Switch to \(suggestion.name)")
            }
            HStack(spacing: 12) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let parts = DurationFormat.shiftTimer(shift.map { context.date.timeIntervalSince($0.startedAt) } ?? 0)
                    HStack(alignment: .lastTextBaseline, spacing: 0) {
                        Text(parts.main).text(34, .black, Palette.ink, tracking: -1).monospacedDigit()
                        Text(parts.seconds).text(17, .heavy, Palette.muted).monospacedDigit().padding(.bottom, 3)
                    }
                }
                Spacer(minLength: 0)
                Button(action: clockOut) {
                    HStack(spacing: 8) {
                        if clockingOut { Spinner(color: .white) } else { Icon("stop.circle", 19, .white) }
                        Text(clockingOut ? "Clocking Out" : "Clock Out").text(14, .black, .white)
                    }
                    .padding(.horizontal, 15)
                    .frame(minHeight: 44)
                    .background(Palette.red, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.pressable)
                .disabled(clockingOut)
                .opacity(clockingOut ? 0.55 : 1)
                .accessibilityLabel("Clock out current shift")
            }
            .padding(.top, 8)
            .padding(.bottom, 12)

            if let actionError {
                Text(actionError).text(12.5, .bold, Palette.red).padding(.bottom, 10)
            }

            startRow
            viewProjectRow
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .bordered(12)
    }

    private var locationRow: some View {
        HStack(alignment: .top, spacing: 6) {
            if let message = statusMessage {
                Icon(tracker.locationStatus?.onSite == false ? "exclamationmark.triangle" : "location",
                     15, tracker.locationStatus?.onSite == false ? Color(hex: 0xb56025) : Palette.teal)
                Text(message).text(12.5, .semibold, Color(hex: 0x4c5a56)).lineLimit(2)
            }
        }
        .frame(minHeight: 20, alignment: .leading)
    }

    private var statusMessage: String? {
        if let notice = tracker.notice?.message { return notice }
        if !session.locationAuthorization.isAuthorized { return "Location isn't recorded for this shift." }
        guard let status = tracker.locationStatus else { return nil }
        return status.label
    }

    private var startRow: some View {
        HStack(spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text("STARTED").text(10.5, .heavy, Palette.muted, tracking: 0.5)
                Text(DateText.time(shift?.startedAt)).text(14.5, .black, Palette.ink)
                if let minutes = shift?.startAdjustmentMinutes {
                    Text("Edited \(minutes > 0 ? "+" : "")\(minutes)m").text(11, .bold, Palette.muted).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            adjustButton("-5m", minutes: -5, label: "Move start time 5 minutes earlier")
            adjustButton("+5m", minutes: 5, label: "Move start time 5 minutes later")
        }
        .padding(.vertical, 10)
        .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 1) }
    }

    private func adjustButton(_ title: String, minutes: Int, label: String) -> some View {
        Button {
            adjust(minutes)
        } label: {
            Text(title).text(13, .black, Palette.teal)
                .frame(minWidth: 48)
                .padding(.vertical, 6)
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.border, lineWidth: 1.5))
        }
        .disabled(adjusting)
        .opacity(adjusting ? 0.55 : 1)
        .accessibilityLabel(label)
    }

    private var viewProjectRow: some View {
        Button {
            if let project { session.open(project) }
        } label: {
            HStack(spacing: 8) {
                Icon("folder", 17, Palette.navy)
                Text("View Project").text(13.5, .heavy, Palette.navy)
                Spacer(minLength: 0)
                Icon("chevron.right", 16, Palette.muted)
            }
            .padding(.vertical, 12)
            .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 1) }
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("View project details")
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
