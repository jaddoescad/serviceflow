import ServiceFlowCore
import SwiftUI

/// Edit the start and end of one of your own clock-ins, or delete it.
struct TimesheetEditTimeView: View {
    var entry: TimeEntry
    var day: TimesheetDay
    var painterName: String
    /// Saved or deleted: return to the list.
    var onFinished: () -> Void

    @Environment(TimeTracker.self) private var tracker
    @State private var startAt: Date
    @State private var endAt: Date
    @State private var busy = false
    @State private var error: String?
    @State private var confirmingDelete = false

    private static let step: TimeInterval = 5 * 60

    init(entry: TimeEntry, day: TimesheetDay, painterName: String, onFinished: @escaping () -> Void) {
        self.entry = entry
        self.day = day
        self.painterName = painterName
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
        let status = statusPresentation(info.summary.status)
        Form {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Label(info.job, systemImage: "briefcase.fill")
                        .font(.app(16, .semibold))
                        .foregroundStyle(TimesheetColors.ink)
                    Text(info.address).font(.app(13)).foregroundStyle(.secondary).lineLimit(2)
                }
                .padding(.vertical, 2)
                LabeledContent("Crew member", value: painterName)
                LabeledContent("Date", value: day.fullDate())
                Label {
                    Text(status.label)
                } icon: {
                    Image(systemName: status.icon).foregroundStyle(status.pin)
                }
                LabeledContent("Distance", value: info.summary.distanceLabel)
            }

            Section {
                DatePicker(selection: $startAt, displayedComponents: [.hourAndMinute]) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Clock-in")
                        Text(info.startSource).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .onChange(of: startAt) { _, _ in error = nil }
                stepRow(label: "clock-in time") { startAt = startAt.addingTimeInterval($0) }

                if isActive {
                    LabeledContent("Clock-out", value: "In progress")
                } else {
                    DatePicker(selection: $endAt, displayedComponents: [.hourAndMinute]) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Clock-out")
                            Text(info.endSource).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .onChange(of: endAt) { _, _ in error = nil }
                    stepRow(label: "clock-out time") { endAt = endAt.addingTimeInterval($0) }
                }

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let duration = isActive ? context.date.timeIntervalSince(startAt) : endAt.timeIntervalSince(startAt)
                    LabeledContent("Duration", value: DurationFormat.hoursMinutes(max(0, duration)))
                }
            } header: {
                Text("Time")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if let note = TimesheetBuilder.originalTimeNote(entry: entry, startAt: startAt, endAt: isActive ? nil : endAt) {
                        Text(note)
                    }
                    if isActive {
                        Text("This shift is still in progress. Only the start time can be changed.")
                    }
                }
            }

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(TimesheetColors.redInk)
                }
            }

            Section {
                Button(role: .destructive) {
                    confirmingDelete = true
                } label: {
                    Label("Delete Time Entry", systemImage: "trash")
                }
                .disabled(busy)
                .accessibilityLabel("Delete time entry")
            }
        }
        .tint(TimesheetColors.teal)
        .navigationTitle("Edit Time")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(busy)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if busy {
                    ProgressView()
                } else {
                    Button("Save", action: save)
                        .fontWeight(.semibold)
                        .disabled(!canSave)
                        .accessibilityLabel("Save changes")
                }
            }
        }
        .confirmationDialog("Delete time entry?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { delete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This can't be undone.")
        }
    }

    /// −5m / +5m nudges for a time.
    private func stepRow(label: String, change: @escaping (TimeInterval) -> Void) -> some View {
        HStack(spacing: 10) {
            Spacer()
            Button("-5m") { change(-Self.step) }
                .accessibilityLabel("Subtract 5 minutes from \(label)")
            Button("+5m") { change(Self.step) }
                .accessibilityLabel("Add 5 minutes to \(label)")
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(busy)
    }

    private struct StatusPresentation {
        var icon: String
        var label: String
        var pin: Color
    }

    private func statusPresentation(_ status: SegmentSummary.Status) -> StatusPresentation {
        switch status {
        case .unavailable:
            return StatusPresentation(icon: "questionmark.circle.fill", label: "Location was not recorded for this clock-in",
                                      pin: TimesheetColors.muted)
        case .onSite:
            return StatusPresentation(icon: "checkmark.circle.fill", label: "On site during clock-in", pin: TimesheetColors.teal)
        case .mixed:
            return StatusPresentation(icon: "arrow.left.arrow.right.circle.fill", label: "On and off site during clock-in",
                                      pin: TimesheetColors.teal)
        case .offSite:
            return StatusPresentation(icon: "exclamationmark.circle.fill", label: "Off site during clock-in", pin: TimesheetColors.red)
        }
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
