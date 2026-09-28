import ServiceFlowCore
import SwiftUI

/// Opens the photo editor on a capture that hasn't uploaded yet. The photo
/// itself never changes: drawings and the description are saved with the
/// capture and sent after it uploads, the same data the web admin edits.
struct CameraPhotoEditorHost: View {
    let localId: String
    let onDone: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var image: UIImage?
    @State private var loadFailed = false

    /// The capture as the queue has it now (the note may have just changed).
    private var item: PendingUpload? {
        session.uploads?.items.first { $0.localId == localId }
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image, let item {
                PhotoEditorScreen(
                    image: image,
                    annotations: item.annotations ?? AnnotationDocument(),
                    description: item.note ?? "",
                    onSave: { annotations, description in
                        save(annotations: annotations, description: description)
                        onDone()
                    },
                    onCancel: onDone
                )
            } else if loadFailed {
                VStack(spacing: 14) {
                    Text("This photo couldn't be opened.").foregroundStyle(.white)
                    Button("Close", action: onDone).buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                }
            } else {
                ProgressView().tint(.white)
            }
        }
        .task { await load() }
    }

    /// Decodes the capture off the main thread.
    private func load() async {
        guard let uploads = session.uploads, let item else {
            loadFailed = true
            return
        }
        let url = uploads.fileURL(for: item)
        image = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return UIImage(data: data)
        }.value
        loadFailed = image == nil
    }

    private func save(annotations: AnnotationDocument, description: String) {
        guard let uploads = session.uploads else { return }
        uploads.setAnnotations(localId, annotations)
        uploads.setNote(localId, description)
    }
}
