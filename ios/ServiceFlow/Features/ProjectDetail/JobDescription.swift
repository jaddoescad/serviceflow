import ServiceFlowCore
import SwiftUI

/// The job's description under its name: what the work is, for the crew and
/// contractors. Managers add and edit it; everyone else reads it.
struct JobDescriptionRow: View {
    let model: ProjectDetailModel

    @Environment(SessionContext.self) private var session
    @State private var editing = false

    var body: some View {
        if let text = model.jobDescription, !text.isEmpty || session.isManager {
            Button { editing = true } label: {
                if text.isEmpty {
                    Label("Add description", systemImage: "plus")
                        .font(.app(14, .semibold))
                        .foregroundStyle(DetailPalette.brand)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Description").font(.app(12, .semibold)).foregroundStyle(.secondary)
                            Spacer()
                            if session.isManager {
                                Text("Edit").font(.app(12, .semibold)).foregroundStyle(DetailPalette.brand)
                            }
                        }
                        Text(text).font(.app(14)).foregroundStyle(.primary).multilineTextAlignment(.leading)
                    }
                    .padding(.vertical, 2)
                }
            }
            .buttonStyle(.plain)
            .disabled(!session.isManager)
            .sheet(isPresented: $editing) { JobDescriptionSheet(model: model) }
        }
    }
}

/// Writing the description; Save keeps it on the job for everyone.
private struct JobDescriptionSheet: View {
    let model: ProjectDetailModel

    @Environment(SessionContext.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Rooms, surfaces, colours, access…", text: $draft, axis: .vertical)
                    .lineLimit(5...14)
                    .focused($focused)
                    .padding(12)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onChange(of: draft) { _, value in if value.count > 5000 { draft = String(value.prefix(5000)) } }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Color(hex: 0xb42318))
                }
                Spacer()
            }
            .padding(16)
            .navigationTitle("Description")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save", action: save)
                            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines) == (model.jobDescription ?? ""))
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(saving)
        .onAppear {
            draft = model.jobDescription ?? ""
            focused = true
        }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            do {
                try await model.saveDescription(api: session.api, text: draft)
                dismiss()
            } catch {
                self.error = error.localizedDescription.isEmpty ? "The description could not be saved. Try again." : error.localizedDescription
            }
            saving = false
        }
    }
}
