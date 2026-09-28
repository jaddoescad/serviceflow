import ServiceFlowCore
import SwiftUI

/// Edit the start and end of one of your own clock-ins, or delete it.
struct TimesheetEditTimeView: View {
    let day: TimesheetDay
    let painterName: String
    /// Saved or deleted: return to the list.
    let onFinished: () -> Void

    @Environment(TimeTracker.self) private var tracker
    @State private var edit: TimeEntryEditModel
    @State private var confirmingDelete = false

    private static let step: TimeInterval = 5 * 60

    init(entry: TimeEntry, day: TimesheetDay, painterName: String, onFinished: @escaping () -> Void) {
        self.day = day
        self.painterName = painterName
        self.onFinished = onFinished
        _edit = State(initialValue: TimeEntryEditModel(entry: entry))
    }

    var body: some View {
        @Bindable var edit = edit
        let info = TimesheetEntryInfo(edit.entry, now: Date())
        Form {
            shiftSection(info)

            Section {
                DatePicker(selection: $edit.startAt, displayedComponents: [.hourAndMinute]) {
                    timeLabel("Clock-in", source: info.startSource)
                }
                stepRow(label: "clock-in time") { edit.startAt += $0 }

                if edit.isActive {
                    LabeledContent("Clock-out", value: "In progress")
                } else {
                    DatePicker(selection: $edit.endAt, displayedComponents: [.hourAndMinute]) {
                        timeLabel("Clock-out", source: info.endSource)
                    }
                    stepRow(label: "clock-out time") { edit.endAt += $0 }
                }

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    LabeledContent("Duration", value: DurationFormat.hoursMinutes(edit.duration(now: context.date)))
                }
            } header: {
                Text("Time")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if let note = edit.originalTimeNote { Text(note) }
                    if edit.isActive { Text(TimeEntryEditModel.inProgressHint) }
                }
            }

            if let error = edit.error {
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
                .disabled(edit.busy)
                .accessibilityLabel("Delete time entry")
            }
        }
        .tint(TimesheetColors.teal)
        .navigationTitle("Edit Time")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(edit.busy)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if edit.busy {
                    ProgressView()
                } else {
                    Button("Save") { Task { if await edit.save(with: tracker) { onFinished() } } }
                        .fontWeight(.semibold)
                        .disabled(!edit.canSave)
                        .accessibilityLabel("Save changes")
                }
            }
        }
        .confirmationDialog("Delete time entry?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    await edit.delete(with: tracker)
                    onFinished()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This can't be undone.")
        }
    }

    private func shiftSection(_ info: TimesheetEntryInfo) -> some View {
        let status = TimesheetEditStatus(info.summary.status)
        return Section {
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
                Image(systemName: status.icon).foregroundStyle(status.color)
            }
            LabeledContent("Distance", value: info.summary.distanceLabel)
        }
    }

    private func timeLabel(_ title: String, source: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(source).font(.caption).foregroundStyle(.secondary)
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
        .disabled(edit.busy)
    }
}

/// How the edit screen describes where the clock-in happened.
private struct TimesheetEditStatus {
    var icon: String
    var label: String
    var color: Color

    init(_ status: SegmentSummary.Status) {
        switch status {
        case .unavailable:
            self.init(icon: "questionmark.circle.fill", label: "Location was not recorded for this clock-in", color: TimesheetColors.muted)
        case .onSite:
            self.init(icon: "checkmark.circle.fill", label: "On site during clock-in", color: TimesheetColors.teal)
        case .mixed:
            self.init(icon: "arrow.left.arrow.right.circle.fill", label: "On and off site during clock-in", color: TimesheetColors.teal)
        case .offSite:
            self.init(icon: "exclamationmark.circle.fill", label: "Off site during clock-in", color: TimesheetColors.red)
        }
    }

    init(icon: String, label: String, color: Color) {
        self.icon = icon
        self.label = label
        self.color = color
    }
}
