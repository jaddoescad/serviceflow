import ServiceFlowCore
import SwiftUI

/// Opens the photo editor for a capture that hasn't uploaded yet and applies
/// its result to the upload queue.
struct CameraPhotoEditorHost: View {
    let item: PendingUpload
    let onDone: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                PhotoEditorScreen(
                    image: image,
                    annotations: item.annotations ?? AnnotationDocument(),
                    description: item.note ?? "",
                    onSave: { edited, annotations, description in
                        save(edited: edited, annotations: annotations, description: description)
                        onDone()
                    },
                    onCancel: onDone
                )
            } else {
                ProgressView().tint(.white)
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let uploads = session.uploads else { return }
        let url = uploads.fileURL(for: item)
        image = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return UIImage(data: data)
        }.value
    }

    private func save(edited: UIImage?, annotations: AnnotationDocument, description: String) {
        guard let uploads = session.uploads else { return }
        if let edited, let data = edited.jpegData(compressionQuality: 0.85) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("edited-\(UUID().uuidString).jpg")
            if (try? data.write(to: url, options: .atomic)) != nil {
                let width = edited.cgImage?.width ?? Int(edited.size.width * edited.scale)
                let height = edited.cgImage?.height ?? Int(edited.size.height * edited.scale)
                uploads.replacePhoto(item.localId, with: url, width: width, height: height)
            }
        }
        uploads.setAnnotations(item.localId, annotations)
        uploads.setNote(item.localId, description)
    }
}
