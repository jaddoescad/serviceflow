import ServiceFlowCore
import SwiftUI

/// The "Photos" card on the active clock-in screen and in Project Detail's
/// Clock Ins tab: a count, the four newest photos, upload progress and, on the
/// clock-in screen, a button that opens the camera.
struct JobPhotosPanel: View {
    let project: Project
    let showCamera: Bool
    let onOpenAll: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var store: MediaStore?
    @State private var cameraOpen = false

    private static let previewCount = 4
    private let navy = Color(hex: 0x31495d)
    private let ink = Color(hex: 0x11201d)
    private let muted = Color(hex: 0x6d7f7b)

    init(project: Project, showCamera: Bool, onOpenAll: @escaping () -> Void) {
        self.project = project
        self.showCamera = showCamera
        self.onOpenAll = onOpenAll
    }

    private enum Tile: Identifiable {
        case pending(PendingUpload)
        case remote(MediaItem)

        var id: String {
            switch self {
            case .pending(let upload): return "pending-\(upload.localId)"
            case .remote(let item): return item.id
            }
        }
    }

    var body: some View {
        let pending = store?.pending ?? []
        let remote = store?.items ?? []
        let tiles = pending.map(Tile.pending) + remote.map(Tile.remote)
        let total = tiles.count
        let loading = store.map { $0.isLoading || !$0.hasLoaded } ?? true
        let counts = store?.pendingCounts ?? (active: 0, uploading: 0, failed: 0)

        VStack(alignment: .leading, spacing: 0) {
            Button(action: onOpenAll) {
                HStack(spacing: 8) {
                    Icon("photo.on.rectangle", 17, navy)
                    Text("Photos").text(14, .black, ink)
                    Spacer(minLength: 0)
                    if loading && total == 0 {
                        Spinner(color: muted)
                    } else {
                        Text("\(total)").text(13, .heavy, muted).monospacedDigit()
                    }
                    Icon("chevron.right", 15, muted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open job photos")

            if tiles.isEmpty {
                Text(loading ? "Loading photos…" : "No photos on this job yet.")
                    .text(12.5, .semibold, muted)
                    .padding(.top, 10)
            } else {
                Button(action: onOpenAll) {
                    HStack(spacing: 8) {
                        ForEach(tiles.prefix(Self.previewCount)) { tile in
                            tileView(tile)
                        }
                        if total > Self.previewCount {
                            Color(hex: 0xeef2f1)
                                .aspectRatio(1, contentMode: .fit)
                                .overlay { Text("+\(total - Self.previewCount)").text(14, .black, navy) }
                                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 12)
                .accessibilityLabel("View all \(total) photos and videos")
            }

            if counts.active > 0 {
                HStack(spacing: 8) {
                    Spinner(color: muted)
                    Text(UploadCopy.uploading(counts.active)).text(12.5, .bold, muted)
                }
                .padding(.top, 10)
            }

            if counts.failed > 0 {
                let reason = pending.first(where: { $0.status == .failed })?.error
                Button {
                    store?.retryAllFailed()
                } label: {
                    HStack(spacing: 8) {
                        Icon("exclamationmark.circle.fill", 15, Color(hex: 0xa5321f))
                        Text(UploadCopy.failed(counts.failed, reason: reason))
                            .text(12, .bold, Color(hex: 0xa5321f))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 9)
                    .background(Color(hex: 0xfdecea), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.pressable(opacity: 0.85))
                .padding(.top, 10)
                .accessibilityLabel("Retry failed uploads")
            }

            if showCamera {
                Button {
                    cameraOpen = true
                } label: {
                    HStack(spacing: 8) {
                        Icon("camera.fill", 19, .white)
                        Text("Take Photo or Video").text(14, .black, .white, tracking: 0.2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .background(navy, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.pressable(opacity: 0.85))
                .disabled(project.id.isEmpty)
                .padding(.top, 12)
                .accessibilityLabel("Take a photo or video for this job")
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .bordered(14, border: Color(hex: 0xe4eae8))
        .task(id: project.id) {
            if store?.project.id != project.id || store?.project.kind != project.kind {
                store = MediaStore(project: project, session: session, includeLinkedLead: false)
            }
            await store?.load()
        }
        .fullScreenCover(isPresented: $cameraOpen) {
            CameraScreen(projectName: project.name, projectId: project.id, projectKind: project.kind) {
                cameraOpen = false
            }
            .environment(session)
        }
    }

    @ViewBuilder
    private func tileView(_ tile: Tile) -> some View {
        Color(hex: 0xdfe6e4)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                switch tile {
                case .pending(let upload):
                    let url = upload.kind == .video ? store?.posterURL(for: upload) : store?.fileURL(for: upload)
                    if let url {
                        MediaAsyncImage(url: url, downsampleTo: 90)
                    } else {
                        Color(hex: 0xc9d4d1)
                    }
                case .remote(let item):
                    if let client = session.mediaClient {
                        MediaAsyncImage(url: client.tileURL(for: item), downsampleTo: 90)
                    } else {
                        Color(hex: 0xc9d4d1)
                    }
                }
            }
            .overlay(alignment: .bottomLeading) {
                if isVideo(tile) {
                    Circle()
                        .fill(Color(rgba: 8, 15, 18, 0.7))
                        .frame(width: 16, height: 16)
                        .overlay { Image(systemName: "play.fill").font(.system(size: 7, weight: .bold)).foregroundStyle(.white) }
                        .padding(4)
                }
            }
            .overlay {
                if case .pending(let upload) = tile {
                    Color(rgba: 17, 32, 29, 0.45)
                        .overlay {
                            if upload.status == .failed {
                                Icon("exclamationmark", 13, .white)
                            } else {
                                Spinner(color: .white)
                            }
                        }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func isVideo(_ tile: Tile) -> Bool {
        switch tile {
        case .pending(let upload): return upload.kind == .video
        case .remote(let item): return item.kind == .video
        }
    }
}
