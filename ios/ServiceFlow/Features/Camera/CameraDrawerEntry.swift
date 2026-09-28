import ServiceFlowCore
import SwiftUI

/// A row in the camera drawer: a shot taken in this opening (still on the
/// device until Done), or a photo or video already on the job.
enum CameraDrawerEntry: Identifiable {
    case capture(PendingUpload)
    case uploaded(MediaItem)

    var id: String {
        switch self {
        case .capture(let upload): return upload.localId
        case .uploaded(let item): return item.id
        }
    }

    var kind: MediaKind {
        switch self {
        case .capture(let upload): return upload.kind
        case .uploaded(let item): return item.kind
        }
    }

    /// The description, shown as the row's note.
    var note: String {
        switch self {
        case .capture(let upload): return upload.note ?? ""
        case .uploaded(let item): return item.mediaDescription ?? ""
        }
    }

    var annotations: AnnotationDocument? {
        switch self {
        case .capture(let upload): return upload.annotations
        case .uploaded(let item): return item.annotations
        }
    }

    /// Captures come first, newest first, then the job's photos newest first.
    /// A capture that has already uploaded appears once, as the capture.
    static func list(captures: [PendingUpload], uploaded: [MediaItem]) -> [CameraDrawerEntry] {
        let capturedIds = Set(captures.compactMap { $0.remote?.id })
        let earlier = uploaded
            .filter { !capturedIds.contains($0.id) }
            .sorted { ($0.timestamp ?? .distantPast) > ($1.timestamp ?? .distantPast) }
        return captures.map(CameraDrawerEntry.capture) + earlier.map(CameraDrawerEntry.uploaded)
    }
}

/// A square thumbnail of a drawer entry, with its drawings on top.
struct CameraDrawerThumbnail: View {
    let entry: CameraDrawerEntry

    @Environment(SessionContext.self) private var session
    static let side: CGFloat = 64

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(hex: 0xdfe6e4))
            image
            if entry.kind == .video {
                Image(systemName: "play.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 20, height: 20)
                    .background(Color(rgba: 8, 15, 18, 0.7), in: Circle())
                    .padding(5)
            }
        }
        .frame(width: Self.side, height: Self.side)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private var image: some View {
        switch entry {
        case .capture(let upload):
            if let url = localURL(upload) {
                MediaAsyncImage(url: url, downsampleTo: Self.side, annotations: upload.annotations)
                    .frame(width: Self.side, height: Self.side)
            }
        case .uploaded(let item):
            if let client = session.mediaClient {
                MediaAsyncImage(url: client.tileURL(for: item), downsampleTo: Self.side, annotations: item.annotations)
                    .frame(width: Self.side, height: Self.side)
            }
        }
    }

    private func localURL(_ upload: PendingUpload) -> URL? {
        guard let uploads = session.uploads else { return nil }
        return upload.kind == .video ? uploads.posterURL(for: upload) : uploads.fileURL(for: upload)
    }
}
