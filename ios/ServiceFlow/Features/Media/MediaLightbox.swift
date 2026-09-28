import AVKit
import ServiceFlowCore
import SwiftUI

/// Full-screen viewer for a project's uploaded photos and videos: paging,
/// pinch zoom, swipe down to close, editing the description and drawings, and
/// delete for the person who uploaded it.
struct MediaLightbox: View {
    let store: MediaStore
    let onClose: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var currentId: String?
    @State private var zoomed = false
    @State private var confirmDelete: MediaItem?
    @State private var deleteFailure: String?
    @State private var visible = false
    @State private var editingPhoto: MediaItem?
    @State private var editingDescription: MediaItem?

    init(store: MediaStore, startId: String, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        _currentId = State(initialValue: startId)
    }

    private var items: [MediaItem] { store.sortedItems }
    private var index: Int? { items.firstIndex { $0.id == currentId } }
    private var current: MediaItem? { index.map { items[$0] } }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            pager
            captionBar
        }
        .padding(.top, 10)
        .background(Color(hex: 0x050607).opacity(visible ? 1 : 0).ignoresSafeArea())
        .mediaSwipeToDismiss(enabled: !zoomed) { close(animated: false) }
        .opacity(visible ? 1 : 0)
        .onAppear { withAnimation(.easeOut(duration: 0.2)) { visible = true } }
        .onChange(of: items.map(\.id)) { _, ids in
            // The open item was deleted or disappeared.
            if let currentId, !ids.contains(currentId) { close(animated: true) }
        }
        .preferredColorScheme(.dark)
        .alert(deleteTitle, isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
               presenting: confirmDelete) { item in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { delete(item) }
        } message: { _ in
            Text("It will be removed from this project. A manager can restore it from the trash.")
        }
        .alert("Delete failed", isPresented: Binding(get: { deleteFailure != nil }, set: { if !$0 { deleteFailure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(deleteFailure ?? "")
        }
        .accessibilityAction(.escape) { close(animated: true) }
        .fullScreenCover(item: $editingPhoto) { item in
            MediaPhotoEditFlow(item: item, store: store) { editingPhoto = nil }
                .environment(session)
        }
        .sheet(item: $editingDescription) { item in
            MediaDescriptionEditor(item: item, store: store)
        }
    }

    private var deleteTitle: String {
        confirmDelete?.kind == .video ? "Delete video?" : "Delete photo?"
    }

    // MARK: Parts

    private var topBar: some View {
        HStack(spacing: 0) {
            Button {
                close(animated: true)
            } label: {
                HStack(spacing: 4) {
                    Icon("xmark", 24, .white)
                    Text("Close").text(15, .bold, .white)
                }
                .frame(minWidth: 68, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.pressable(opacity: 0.7))
            .accessibilityLabel("Close media viewer")

            VStack(spacing: 2) {
                if let current, let index {
                    Text("\(current.kind == .video ? "Video" : "Photo") \(index + 1) / \(items.count)")
                        .text(14, .heavy, .white)
                    Text("Taken by \(current.sourceName)")
                        .text(10.5, .semibold, Color(hex: 0xb7c0c5))
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 6)

            actions
                .frame(minWidth: 68, alignment: .trailing)
        }
        .frame(height: 54)
        .padding(.horizontal, 16)
    }

    /// Edit (photo drawings and description, or a video's description) and delete.
    private var actions: some View {
        HStack(spacing: 4) {
            if let current, store.canEdit(current) {
                Button {
                    if current.kind == .video { editingDescription = current } else { editingPhoto = current }
                } label: {
                    Text(current.kind == .video ? "Description" : "Edit")
                        .text(15, .bold, .white)
                        .frame(minHeight: 44)
                        .padding(.horizontal, 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.pressable(opacity: 0.7))
                .disabled(zoomed)
                .accessibilityLabel(current.kind == .video ? "Edit description" : "Edit photo")
            }
            if let current, current.canDelete(userId: session.user.id) {
                Button {
                    confirmDelete = current
                } label: {
                    Group {
                        if store.deletingId == current.id {
                            Spinner(color: .white)
                        } else {
                            Icon("trash", 21, .white)
                        }
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressable(opacity: 0.7))
                .disabled(store.deletingId != nil)
                .accessibilityLabel("Delete media")
            }
        }
    }

    private var pager: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(items) { item in
                        page(item)
                            .padding(.horizontal, 10)
                            .containerRelativeFrame([.horizontal, .vertical])
                            .id(item.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $currentId)
            .scrollIndicators(.hidden)
            .scrollDisabled(zoomed)
            .onAppear {
                if let currentId { proxy.scrollTo(currentId) }
            }
        }
        .frame(maxHeight: .infinity)
        .onChange(of: currentId) { _, _ in zoomed = false }
    }

    @ViewBuilder
    private func page(_ item: MediaItem) -> some View {
        let isCurrent = item.id == currentId
        if item.kind == .video {
            if isCurrent, let client = session.mediaClient {
                MediaLightboxVideo(url: client.originalURL(item.id), client: client)
            } else {
                Color(hex: 0x101820).overlay { Icon("video.fill", 42, .white) }
            }
        } else {
            MediaLightboxPhoto(item: item, isCurrent: isCurrent) { isZoomed in
                if isCurrent { zoomed = isZoomed }
            }
        }
    }

    private var captionBar: some View {
        VStack(spacing: 6) {
            if let description = current?.mediaDescription {
                Text(description)
                    .text(13, .semibold, .white.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .lineLimit(4)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 18)
            }
            dateCaption
        }
    }

    private var dateCaption: some View {
        HStack(spacing: 7) {
            if let current {
                Icon(current.kind == .video ? "video" : "camera", 15, .white.opacity(0.7))
                Text("\(DateText.canadianLongDate(current.timestamp)) · \(DateText.canadianTime(current.timestamp))")
                    .text(11, .bold, .white.opacity(0.72))
                    .lineLimit(1)
            }
        }
        .frame(height: 30)
        .padding(.horizontal, 18)
    }

    // MARK: Actions

    private func delete(_ item: MediaItem) {
        Task {
            let ok = await store.delete(item)
            if ok {
                close(animated: true)
            } else {
                deleteFailure = store.error ?? "Unable to delete this media."
            }
        }
    }

    private func close(animated: Bool) {
        guard animated else {
            dismissWithoutAnimation()
            return
        }
        withAnimation(.easeIn(duration: 0.18)) { visible = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { dismissWithoutAnimation() }
    }

    private func dismissWithoutAnimation() {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { onClose() }
    }
}

/// A lightbox photo page: the original, downsampled to the screen, zoomable,
/// with its drawings on top.
private struct MediaLightboxPhoto: View {
    let item: MediaItem
    let isCurrent: Bool
    let onZoomChange: (Bool) -> Void

    @Environment(SessionContext.self) private var session
    @Environment(\.displayScale) private var displayScale
    @State private var original: UIImage?
    /// The original with its drawings painted on, redrawn only when they change.
    @State private var displayed: UIImage?

    private static let pointSize: CGFloat = 1400

    var body: some View {
        ZStack {
            if let displayed {
                MediaZoomableImage(image: displayed, isCurrent: isCurrent, onZoomChange: onZoomChange)
            } else {
                Spinner(color: .white)
            }
        }
        .task(id: item.id) {
            guard original == nil, let client = session.mediaClient else { return }
            original = await MediaImageLoader.shared.image(for: client.originalURL(item.id),
                                                          maxPixel: Self.pointSize * displayScale, client: client)
            redraw()
        }
        .onChange(of: item.annotations) { _, _ in redraw() }
    }

    private func redraw() {
        guard let original else { return }
        displayed = item.annotations.map { AnnotationRenderer.composite(original, document: $0) } ?? original
    }
}

/// A lightbox video page: streamed from the Worker with the current token.
/// It never autoplays or loops.
private struct MediaLightboxVideo: View {
    let url: URL
    let client: MediaClient
    @State private var player: AVPlayer?

    init(url: URL, client: MediaClient) {
        self.url = url
        self.client = client
    }

    var body: some View {
        ZStack {
            if let player {
                MediaVideoPlayer(player: player)
            } else {
                Spinner(color: .white)
            }
        }
        .task(id: url) {
            guard player == nil, let headers = try? await client.authorizationHeaders() else { return }
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
            player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        }
        .onDisappear { player?.pause() }
    }
}
