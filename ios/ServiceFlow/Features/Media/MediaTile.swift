import ServiceFlowCore
import SwiftUI

/// Something shown in a media grid: a capture still uploading, or an
/// uploaded photo or video.
enum MediaEntry: Identifiable {
    case pending(PendingUpload)
    case remote(MediaItem)

    var id: String {
        switch self {
        case .pending(let upload): return "pending-\(upload.localId)"
        case .remote(let item): return item.id
        }
    }

    var kind: MediaKind {
        switch self {
        case .pending(let upload): return upload.kind
        case .remote(let item): return item.kind
        }
    }

    var timestamp: Date? {
        switch self {
        case .pending(let upload): return upload.capturedAt
        case .remote(let item): return item.timestamp
        }
    }

    var annotations: AnnotationDocument? {
        switch self {
        case .pending(let upload): return upload.annotations
        case .remote(let item): return item.annotations
        }
    }

    var hasDescription: Bool {
        switch self {
        case .pending(let upload): return !(upload.note ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .remote(let item): return item.mediaDescription != nil
        }
    }

    var pendingUpload: PendingUpload? {
        if case .pending(let upload) = self { return upload }
        return nil
    }

    /// Captures first (queue order), then uploads.
    @MainActor static func all(in store: MediaStore) -> [MediaEntry] {
        store.pending.map(MediaEntry.pending) + store.items.map(MediaEntry.remote)
    }
}

/// The square picture of a grid entry: the image with its drawings, a play
/// badge for videos, a note badge when it has a description, and the upload
/// state for captures.
struct MediaTileImage: View {
    enum Style {
        /// The small photos card: compact badges.
        case compact
        /// The Media tab grid: larger badges and an upload label.
        case grid
    }

    let entry: MediaEntry
    let store: MediaStore
    let style: Style

    @Environment(SessionContext.self) private var session

    private var pointSize: CGFloat { style == .compact ? 90 : 140 }

    var body: some View {
        placeholderColor
            .aspectRatio(1, contentMode: .fit)
            .overlay { image }
            .overlay { if entry.kind == .video { playBadge } }
            .overlay(alignment: .topTrailing) { if entry.hasDescription { noteBadge } }
            .overlay { if let upload = entry.pendingUpload { uploadOverlay(upload) } }
            .clipped()
    }

    private var placeholderColor: Color {
        entry.kind == .video ? DetailPalette.navy : (style == .compact ? Color(hex: 0xdfe6e4) : DetailPalette.soft)
    }

    @ViewBuilder
    private var image: some View {
        switch entry {
        case .pending(let upload):
            let url = upload.kind == .video ? store.posterURL(for: upload) : store.fileURL(for: upload)
            MediaAsyncImage(url: url, downsampleTo: pointSize, annotations: upload.annotations)
        case .remote(let item):
            if let client = session.mediaClient {
                MediaAsyncImage(url: client.tileURL(for: item), downsampleTo: pointSize,
                                annotations: item.kind == .image ? item.annotations : nil,
                                showsSpinner: style == .grid && item.kind == .image)
            }
        }
    }

    @ViewBuilder
    private var playBadge: some View {
        switch style {
        case .compact:
            Circle()
                .fill(Color(rgba: 8, 15, 18, 0.7))
                .frame(width: 16, height: 16)
                .overlay { Image(systemName: "play.fill").font(.system(size: 7, weight: .bold)).foregroundStyle(.white) }
                .padding(4)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        case .grid:
            Circle()
                .fill(Color.white.opacity(0.2))
                .frame(width: 38, height: 38)
                .overlay {
                    Image(systemName: "play.fill").font(.system(size: 17, weight: .bold)).foregroundStyle(.white).padding(.leading, 3)
                }
        }
    }

    private var noteBadge: some View {
        Image(systemName: "text.alignleft")
            .font(.system(size: style == .compact ? 7 : 9, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: style == .compact ? 15 : 20, height: style == .compact ? 15 : 20)
            .background(Color(rgba: 8, 15, 18, 0.7), in: Circle())
            .padding(style == .compact ? 3 : 5)
            .accessibilityLabel("Has a note")
    }

    @ViewBuilder
    private func uploadOverlay(_ upload: PendingUpload) -> some View {
        let failed = upload.status == .failed
        switch style {
        case .compact:
            Color(rgba: 17, 32, 29, 0.45)
                .overlay { if failed { Icon("exclamationmark", 13, .white) } else { Spinner(color: .white) } }
        case .grid:
            (failed ? Color(rgba: 137, 49, 36, 0.72) : Color(rgba: 19, 45, 51, 0.5))
                .overlay {
                    VStack(spacing: 5) {
                        if failed {
                            Icon("arrow.clockwise", 20, .white)
                            Text("Tap to retry").text(8.5, .black, .white)
                        } else {
                            Spinner(color: .white)
                            Text("Uploading").text(8.5, .black, .white)
                        }
                    }
                }
        }
    }
}
