import ServiceFlowCore
import SwiftUI

/// Edit the start and end of one of your own clock-ins, or delete it.
struct TimesheetEditTimeView: View {
    var entry: TimeEntry
    var day: TimesheetDay
    var painterName: String
    var onBack: () -> Void
    /// Saved or deleted: return to the list.
    var onFinished: () -> Void

    @Environment(TimeTracker.self) private var tracker
    @State private var startAt: Date
    @State private var endAt: Date
    @State private var busy = false
    @State private var error: String?
    @State private var confirmingDelete = false

    private static let step: TimeInterval = 5 * 60

    init(entry: TimeEntry, day: TimesheetDay, painterName: String, onBack: @escaping () -> Void, onFinished: @escaping () -> Void) {
        self.entry = entry
        self.day = day
        self.painterName = painterName
        self.onBack = onBack
        self.onFinished = onFinished
        _startAt = State(initialValue: entry.startedAt)
        _endAt = State(initialValue: entry.endedAt ?? entry.startedAt)
    }

    private var isActive: Bool { entry.isActive }
    private var startChanged: Bool { startAt != entry.startedAt }
    private var endChanged: Bool { !isActive && endAt != (entry.endedAt ?? entry.startedAt) }

    private var canSave: Bool {
        guard !busy else { return false }
        if isActive { return startChanged }
        return (startChanged || endChanged) && endAt > startAt
    }

    var body: some View {
        let info = TimesheetEntryInfo(entry, now: Date())
        VStack(spacing: 0) {
            HStack {
                TimesheetBackButton(label: "Back to day", action: onBack)
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 4)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Edit Time").text(30, .black, TimesheetColors.ink, tracking: -1)
                    Text("Adjust this clock-in entry").text(13.5, .semibold, TimesheetColors.muted).padding(.top, 4)
                    shiftCard(info).padding(.top, 18)
                    formCard(info).padding(.top, 14)
                }
                .padding(.horizontal, 18)
                .padding(.top, 2)
                .padding(.bottom, 14)
            }
            .scrollBounceBehavior(.basedOnSize)

            footer
        }
        .background(TimesheetColors.bg)
        .alert("Delete time entry?", isPresented: $confirmingDelete) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { delete() }
        } message: {
            Text("This can't be undone.")
        }
    }

    // MARK: Shift card

    private func shiftCard(_ info: TimesheetEntryInfo) -> some View {
        let status = statusPresentation(info.summary.status)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(painterName).text(16, .black, TimesheetColors.ink).lineLimit(1)
                    HStack(spacing: 5) {
                        Image(systemName: "briefcase.fill").font(.system(size: 12)).foregroundStyle(TimesheetColors.teal)
                        Text(info.job).text(14, .heavy, TimesheetColors.tealInk).lineLimit(1)
                    }
                    .padding(.top, 8)
                    Text(info.address).text(12.5, .semibold, TimesheetColors.muted).lineLimit(1).padding(.top, 4)
                }
                Spacer(minLength: 0)
                VStack(spacing: 4) {
                    Image(systemName: "mappin").font(.system(size: 19, weight: .semibold)).foregroundStyle(status.pin)
                    Text(info.summary.distanceLabel).text(10, .heavy, TimesheetColors.tealInk).multilineTextAlignment(.center)
                        .lineLimit(2).minimumScaleFactor(0.8)
                }
                .padding(.horizontal, 6)
                .frame(width: 86, height: 80)
                .bordered(10, border: Color(hex: 0xd5e7e2), background: TimesheetColors.tealSoft)
            }
            HStack(spacing: 6) {
                Image(systemName: status.icon).font(.system(size: 13)).foregroundStyle(status.text)
                Text(status.label).text(12, .heavy, status.text)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(status.background, in: Capsule())
            .padding(.top, 12)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .bordered(14, border: TimesheetColors.border, background: TimesheetColors.surface)
    }

    private struct StatusPresentation {
        var icon: String
        var label: String
        var background: Color
        var text: Color
        var pin: Color
    }

    private func statusPresentation(_ status: SegmentSummary.Status) -> StatusPresentation {
        switch status {
        case .unavailable:
            return StatusPresentation(icon: "questionmark.circle.fill", label: "Location was not recorded for this clock-in",
                                      background: TimesheetColors.unknownBg, text: TimesheetColors.inkSoft, pin: TimesheetColors.muted)
        case .onSite:
            return StatusPresentation(icon: "checkmark.circle.fill", label: "On site during clock-in",
                                      background: TimesheetColors.tealSoft, text: TimesheetColors.tealInk, pin: TimesheetColors.teal)
        case .mixed:
            return StatusPresentation(icon: "arrow.left.arrow.right.circle.fill", label: "On and off site during clock-in",
                                      background: TimesheetColors.tealSoft, text: TimesheetColors.tealInk, pin: TimesheetColors.teal)
        case .offSite:
            return StatusPresentation(icon: "exclamationmark.circle.fill", label: "Off site during clock-in",
                                      background: TimesheetColors.redBg, text: TimesheetColors.redInk, pin: TimesheetColors.red)
        }
    }

    // MARK: Form

    private func formCard(_ info: TimesheetEntryInfo) -> some View {
        VStack(spacing: 0) {
            row("Date", day.fullDate())
            Rectangle().fill(TimesheetColors.divider).frame(height: 1)

            row("Clock-In Time", "\(DateText.time(startAt)) · \(info.startSource)")
            if let note = TimesheetBuilder.originalTimeNote(entry: entry, startAt: startAt, endAt: isActive ? nil : endAt) {
                Text(note).text(11.5, .bold, TimesheetColors.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, -6)
                    .padding(.bottom, 8)
            }
            stepper(label: "clock-in time", enabled: !busy) { startAt = startAt.addingTimeInterval($0) }
            Rectangle().fill(TimesheetColors.divider).frame(height: 1)

            row("Clock-Out Time", isActive ? "In progress" : "\(DateText.time(endAt)) · \(info.endSource)")
            stepper(label: "clock-out time", enabled: !busy && !isActive) { endAt = endAt.addingTimeInterval($0) }
                .opacity(isActive ? 0.4 : 1)
            Rectangle().fill(TimesheetColors.divider).frame(height: 1)

            TimelineView(.periodic(from: .now, by: 1)) { context in
                let duration = isActive ? context.date.timeIntervalSince(startAt) : endAt.timeIntervalSince(startAt)
                row("Duration", DurationFormat.hoursMinutes(max(0, duration)), muted: true)
            }
        }
        .padding(.horizontal, 14)
        .bordered(14, border: TimesheetColors.border, background: TimesheetColors.surface)
    }

    private func row(_ label: String, _ value: String, muted: Bool = false) -> some View {
        HStack {
            Text(label).text(13.5, .bold, TimesheetColors.muted)
            Spacer(minLength: 12)
            Text(value)
                .text(14.5, muted ? .bold : .heavy, muted ? TimesheetColors.muted : TimesheetColors.ink)
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, 14)
    }

    private func stepper(label: String, enabled: Bool, change: @escaping (TimeInterval) -> Void) -> some View {
        HStack(spacing: 8) {
            Spacer()
            stepButton("-5m", accessibility: "Subtract 5 minutes from \(label)", enabled: enabled) {
                change(-Self.step)
                error = nil
            }
            stepButton("+5m", accessibility: "Add 5 minutes to \(label)", enabled: enabled) {
                change(Self.step)
                error = nil
            }
        }
        .padding(.horizontal, 2)
        .padding(.bottom, 10)
    }

    private func stepButton(_ title: String, accessibility: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).text(12, .heavy, TimesheetColors.tealInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .bordered(99, border: TimesheetColors.border, background: TimesheetColors.surface)
        }
        .buttonStyle(.pressable(opacity: 0.7))
        .disabled(!enabled)
        .accessibilityLabel(accessibility)
    }

    // MARK: Footer

    private var footer: some View {
        VStack(spacing: 0) {
            if let error {
                Text(error).text(13, .heavy, TimesheetColors.redInk).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.bottom, 8)
            }
            if isActive {
                Text("This shift is still in progress. Only the start time can be changed.")
                    .text(12.5, .bold, TimesheetColors.muted).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.bottom, 8)
            }
            Button(action: save) {
                Group {
                    if busy {
                        ProgressView().tint(TimesheetColors.buttonText)
                    } else {
                        Text("Save Changes").text(15.5, .black, TimesheetColors.buttonText, tracking: 0.2)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(canSave ? TimesheetColors.teal : TimesheetColors.disabled, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.pressable(opacity: 0.9))
            .disabled(!canSave)
            .accessibilityLabel("Save changes")

            HStack(spacing: 10) {
                Button(action: onBack) {
                    Text("Cancel").text(14.5, .heavy, TimesheetColors.inkSoft)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .bordered(12, border: TimesheetColors.border, background: TimesheetColors.surface)
                }
                .buttonStyle(.pressable(opacity: 0.85))
                .disabled(busy)
                .accessibilityLabel("Cancel editing")

                Button { confirmingDelete = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "trash").font(.system(size: 14, weight: .semibold)).foregroundStyle(TimesheetColors.red)
                        Text("Delete").text(14.5, .heavy, TimesheetColors.red)
                    }
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .bordered(12, border: TimesheetColors.redBorder, background: busy ? TimesheetColors.disabled : TimesheetColors.redBg)
                }
                .buttonStyle(.pressable(opacity: 0.85))
                .disabled(busy)
                .accessibilityLabel("Delete time entry")
            }
            .padding(.top, 10)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 16)
        .background(TimesheetColors.bg)
    }

    private func save() {
        guard canSave else { return }
        busy = true
        error = nil
        Task {
            do {
                try await tracker.updateEntry(entry, startedAt: startAt, endedAt: isActive ? nil : endAt)
                busy = false
                onFinished()
            } catch {
                busy = false
                let message = error.localizedDescription
                self.error = message.isEmpty ? "Could not save changes. Try again." : message
            }
        }
    }

    private func delete() {
        busy = true
        error = nil
        Task {
            await tracker.deleteEntry(entry)
            busy = false
            onFinished()
        }
    }
}
