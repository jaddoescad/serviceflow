import ServiceFlowCore
import SwiftUI

/// Edit one of your own clock-ins from Project Detail (pushed).
struct ProjectDetailEditTime: View {
    let painterName: String
    /// Called after a successful save or delete.
    let onChanged: (_ deleted: Bool) -> Void

    @Environment(TimeTracker.self) private var tracker
    @Environment(\.dismiss) private var dismiss
    @State private var edit: TimeEntryEditModel
    @State private var confirmDelete = false

    init(entry: TimeEntry, painterName: String, onChanged: @escaping (_ deleted: Bool) -> Void) {
        self.painterName = painterName
        self.onChanged = onChanged
        _edit = State(initialValue: TimeEntryEditModel(entry: entry))
    }

    var body: some View {
        @Bindable var edit = edit
        Form {
            Section {
                LabeledContent("Crew member", value: painterName)
                LabeledContent("Job") {
                    Label(edit.entry.project.name, systemImage: "mappin").foregroundStyle(.secondary).lineLimit(1)
                }
                LabeledContent("Location") {
                    Text(locationText).foregroundStyle(.secondary)
                }
            }

            Section {
                DatePicker("Clock in", selection: $edit.startAt, in: ...Date(), displayedComponents: [.date, .hourAndMinute])
                if edit.isActive {
                    LabeledContent("Clock out", value: "In progress")
                } else {
                    DatePicker("Clock out", selection: $edit.endAt, in: edit.startAt...Date(), displayedComponents: [.date, .hourAndMinute])
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
                    Text(error).foregroundStyle(Palette.red)
                }
            }

            Section {
                Button("Delete Time Entry", role: .destructive) { confirmDelete = true }
                    .frame(maxWidth: .infinity)
                    .disabled(edit.busy)
            }
        }
        .navigationTitle("Edit Time")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if edit.busy {
                    ProgressView()
                } else {
                    Button("Save", action: save).disabled(!edit.canSave)
                }
            }
        }
        .confirmationDialog("Delete time entry?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: delete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This can't be undone.")
        }
    }

    private var locationText: String {
        let summary = SegmentSummary(edit.entry, now: Date())
        let status = ProjectDetailSiteStatus(summary.status).label
        guard let distance = summary.latestDistance else { return status }
        return "\(status) · \(DistanceFormat.meters(distance)) from site"
    }

    private func save() {
        Task {
            guard await edit.save(with: tracker) else { return }
            onChanged(false)
            dismiss()
        }
    }

    private func delete() {
        Task {
            await edit.delete(with: tracker)
            onChanged(true)
            dismiss()
        }
    }
}
