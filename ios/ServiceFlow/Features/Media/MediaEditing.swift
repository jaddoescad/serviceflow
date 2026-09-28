import ServiceFlowCore
import SwiftUI

/// Opens an uploaded photo in the photo editor. The editor works on the
/// original; only the drawings and description are saved, exactly as the web
/// admin does, so the photo itself never changes.
struct MediaPhotoEditFlow: View {
    let item: MediaItem
    let store: MediaStore
    let onDone: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var original: UIImage?
    @State private var loadFailed = false
    @State private var saving = false
    @State private var alert: EditAlert?

    /// Big enough to draw on precisely; drawings are stored as fractions, so
    /// the exact size doesn't matter.
    private static let editPixels: CGFloat = 2400

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let original {
                PhotoEditorScreen(
                    image: original,
                    annotations: item.annotations ?? AnnotationDocument(),
                    description: item.mediaDescription ?? "",
                    onSave: save,
                    onCancel: onDone
                )
                .disabled(saving)
            } else if loadFailed {
                loadError
            } else {
                ProgressView().tint(.white)
            }
            if saving {
                Color.black.opacity(0.35).ignoresSafeArea()
                ProgressView().tint(.white).controlSize(.large)
            }
        }
        .task { await loadOriginal() }
        .alert(item: $alert) { alert in
            Alert(title: Text(alert.title), message: Text(alert.message), dismissButton: .default(Text("OK")) {
                if alert.closesEditor { onDone() }
            })
        }
    }

    private var loadError: some View {
        VStack(spacing: 14) {
            Text("This photo couldn't be loaded.").font(.headline).foregroundStyle(.white)
            HStack(spacing: 12) {
                Button("Cancel", action: onDone).buttonStyle(.bordered).tint(.white)
                Button("Try Again") {
                    loadFailed = false
                    Task { await loadOriginal() }
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private func loadOriginal() async {
        guard original == nil, let client = session.mediaClient else {
            loadFailed = session.mediaClient == nil
            return
        }
        original = await MediaImageLoader.shared.image(for: client.originalURL(item.id), maxPixel: Self.editPixels, client: client)
        loadFailed = original == nil
    }

    private func save(annotations: AnnotationDocument, description: String) {
        let changedDrawings = annotations.sanitized() != (item.annotations ?? AnnotationDocument()).sanitized()
        let changedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines) != (item.mediaDescription ?? "")
        guard changedDrawings || changedDescription else {
            onDone()
            return
        }
        saving = true
        Task {
            let outcome = await store.saveEdits(to: item, description: changedDescription ? description : nil,
                                                annotations: changedDrawings ? annotations : nil)
            saving = false
            switch outcome {
            case .saved: onDone()
            case .conflict: alert = .conflict
            case .failed(let message): alert = .failed(message)
            }
        }
    }
}

/// Edits a video's description.
struct MediaDescriptionEditor: View {
    let item: MediaItem
    let store: MediaStore

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var saving = false
    @State private var alert: EditAlert?

    init(item: MediaItem, store: MediaStore) {
        self.item = item
        self.store = store
        _text = State(initialValue: item.mediaDescription ?? "")
    }

    private var changed: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines) != (item.mediaDescription ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Add a description…", text: $text, axis: .vertical)
                    .lineLimit(3...10)
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
                        Button("Save", action: save).disabled(!changed)
                    }
                }
            }
            .alert(item: $alert) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message), dismissButton: .default(Text("OK")) {
                    if alert.closesEditor { dismiss() }
                })
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(saving)
    }

    private func save() {
        saving = true
        Task {
            let outcome = await store.saveEdits(to: item, description: text, annotations: nil)
            saving = false
            switch outcome {
            case .saved: dismiss()
            case .conflict: alert = .conflict
            case .failed(let message): alert = .failed(message)
            }
        }
    }
}

/// Why an edit didn't save.
struct EditAlert: Identifiable {
    var id: String { title + message }
    var title: String
    var message: String
    /// After a conflict the editor closes so the reloaded photo can be reopened.
    var closesEditor: Bool

    static let conflict = EditAlert(
        title: "Photo changed",
        message: "This photo was changed on another device. It's been reloaded — try again.",
        closesEditor: true
    )

    static func failed(_ message: String) -> EditAlert {
        EditAlert(title: "Couldn't save", message: message, closesEditor: false)
    }
}
