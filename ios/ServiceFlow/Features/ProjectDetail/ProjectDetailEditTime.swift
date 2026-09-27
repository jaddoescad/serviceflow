import ServiceFlowCore
import SwiftUI

/// Edit one of your own clock-ins from Project Detail (pushed).
struct ProjectDetailEditTime: View {
    let entry: TimeEntry
    let painterName: String
    /// Called after a successful save or delete.
    let onChanged: (_ deleted: Bool) -> Void

    @Environment(TimeTracker.self) private var tracker
    @Environment(\.dismiss) private var dismiss
    @State private var startAt: Date
    @State private var endAt: Date
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false

    init(entry: TimeEntry, painterName: String, onChanged: @escaping (_ deleted: Bool) -> Void) {
        self.entry = entry
        self.painterName = painterName
        self.onChanged = onChanged
        _startAt = State(initialValue: entry.startedAt)
        _endAt = State(initialValue: entry.endedAt ?? entry.startedAt)
    }

    private var isActive: Bool { entry.isActive }
    private var startChanged: Bool { Int(startAt.timeIntervalSince(entry.startedAt)) != 0 }
    private var endChanged: Bool { !isActive && Int(endAt.timeIntervalSince(entry.endedAt ?? entry.startedAt)) != 0 }

    private var canSave: Bool {
        guard !busy else { return false }
        if isActive { return startChanged }
        return (startChanged || endChanged) && endAt > startAt
    }

    var body: some View {
        let summary = SegmentSummary(entry, now: Date())
        Form {
            Section {
                LabeledContent("Crew member", value: painterName)
                LabeledContent("Job") {
                    Label(entry.project.name, systemImage: "mappin").foregroundStyle(.secondary).lineLimit(1)
                }
                LabeledContent("Location") {
                    Text(locationText(summary)).foregroundStyle(.secondary)
                }
            }

            Section {
                DatePicker("Clock in", selection: $startAt, in: ...Date(), displayedComponents: [.date, .hourAndMinute])
                if isActive {
                    LabeledContent("Clock out", value: "In progress")
                } else {
                    DatePicker("Clock out", selection: $endAt, in: startAt...Date(), displayedComponents: [.date, .hourAndMinute])
                }
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    LabeledContent("Duration",
                                   value: DurationFormat.hoursMinutes(max(0, (isActive ? context.date : endAt).timeIntervalSince(startAt))))
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
                    Text(error).foregroundStyle(Palette.red)
                }
            }

            Section {
                Button("Delete Time Entry", role: .destructive) { confirmDelete = true }
                    .frame(maxWidth: .infinity)
                    .disabled(busy)
            }
        }
        .navigationTitle("Edit Time")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if busy {
                    ProgressView()
                } else {
                    Button("Save", action: save).disabled(!canSave)
                }
            }
        }
        .confirmationDialog("Delete time entry?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { delete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This can't be undone.")
        }
    }

    private func locationText(_ summary: SegmentSummary) -> String {
        let status = ProjectDetailSiteStatus(summary.status).label
        guard let distance = summary.latestDistance else { return status }
        return "\(status) · \(DistanceFormat.meters(distance)) from site"
    }

    // MARK: Actions

    private func save() {
        guard canSave else { return }
        busy = true
        error = nil
        Task {
            do {
                try await tracker.updateEntry(entry, startedAt: startAt, endedAt: isActive ? nil : endAt)
                busy = false
                onChanged(false)
                dismiss()
            } catch {
                busy = false
                self.error = error.localizedDescription.isEmpty ? "Could not save changes. Try again." : error.localizedDescription
            }
        }
    }

    private func delete() {
        busy = true
        error = nil
        Task {
            await tracker.deleteEntry(entry)
            busy = false
            onChanged(true)
            dismiss()
        }
    }
}
