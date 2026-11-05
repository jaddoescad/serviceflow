import ServiceFlowCore
import SwiftUI

/// The job's description under its name: what the work is, for the crew and
/// contractors. Managers add and edit it; everyone else reads it.
struct JobDescriptionRow: View {
    let model: ProjectDetailModel

    @Environment(SessionContext.self) private var session
    @State private var editing = false

    var body: some View {
        if let text = model.jobDescription {
            if session.isManager {
                // A list-styled button: the whole row is the tap target.
                Button { editing = true } label: { content(text) }
                    .fullScreenCover(isPresented: $editing) { JobDescriptionEditor(model: model) }
            } else if !text.isEmpty {
                content(text)
            }
        }
    }

    @ViewBuilder
    private func content(_ text: String) -> some View {
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
                RichTextView(markdown: text)
            }
            .padding(.vertical, 2)
        }
    }
}

/// Writing the description on its own screen, with bold, italic, links and
/// lists; Save keeps it on the job for everyone.
private struct JobDescriptionEditor: View {
    let model: ProjectDetailModel

    @Environment(SessionContext.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var editor = RichTextEditorModel()
    @State private var original = ""
    @State private var saving = false
    @State private var error: String?
    @State private var linking = false
    @State private var linkAddress = ""

    var body: some View {
        NavigationStack {
            RichTextEditorView(editor: editor, initial: model.jobDescription ?? "")
                .padding(.horizontal, 12)
                .overlay(alignment: .topLeading) {
                    if editor.markdown.isEmpty {
                        Text("Rooms, surfaces, colours, access…")
                            .font(.system(size: RichTextEditorModel.size))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 17)
                            .padding(.top, 12)
                            .allowsHitTesting(false)
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    VStack(spacing: 0) {
                        if let error {
                            Text(error)
                                .font(.footnote)
                                .foregroundStyle(Color(hex: 0xb42318))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                        RichTextFormatBar(editor: editor) {
                            editor.rememberSelection()
                            linkAddress = editor.link ?? ""
                            linking = true
                        }
                    }
                }
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
                            Button("Save", action: save).disabled(editor.markdown == original)
                        }
                    }
                }
                .alert("Link", isPresented: $linking) {
                    TextField("example.com", text: $linkAddress)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button(editor.link == nil ? "Add" : "Save") {
                        if let address = RichText.linkAddress(linkAddress) {
                            editor.setLink(address, label: linkAddress.trimmingCharacters(in: .whitespaces))
                        }
                    }
                    if editor.link != nil {
                        Button("Remove link", role: .destructive) { editor.setLink(nil, label: "") }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Links the selected text, or adds the address where the cursor is.")
                }
        }
        .interactiveDismissDisabled(saving)
        .onAppear {
            // Plain descriptions can read back slightly differently ("1)" as "1."); that alone isn't a change.
            original = RichTextEditorModel.markdown(from: RichTextEditorModel.attributed(model.jobDescription ?? ""))
        }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            do {
                try await model.saveDescription(api: session.api, text: editor.markdown)
                dismiss()
            } catch {
                self.error = error.localizedDescription.isEmpty ? "The description could not be saved. Try again." : error.localizedDescription
            }
            saving = false
        }
    }
}
