import ServiceFlowCore
import SwiftUI

/// The "Photos" card on the active clock-in screen and in Project Detail's
/// Clock Ins tab: a count, the newest shots as small thumbnails, upload
/// progress and, on the clock-in screen, a button that opens the camera.
struct JobPhotosPanel: View {
    let project: Project
    let showCamera: Bool
    let onOpenAll: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var store: MediaStore?
    @State private var cameraOpen = false

    /// Thumbnails always take one of four equal slots, however many there are.
    private static let slots = 4
    private static let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: slots)

    private let navy = Color(hex: 0x31495d)
    private let ink = Color(hex: 0x11201d)
    private let muted = Color(hex: 0x6d7f7b)
    private let danger = Color(hex: 0xa5321f)

    init(project: Project, showCamera: Bool, onOpenAll: @escaping () -> Void) {
        self.project = project
        self.showCamera = showCamera
        self.onOpenAll = onOpenAll
    }

    var body: some View {
        let entries = store.map(MediaEntry.all(in:)) ?? []
        let loading = store.map { $0.isLoading || !$0.hasLoaded } ?? true

        VStack(alignment: .leading, spacing: 0) {
            header(count: entries.count, loading: loading)

            if let store, !entries.isEmpty {
                thumbnails(entries, store: store).padding(.top, 12)
            } else {
                Text(loading ? "Loading photos…" : "No photos on this job yet.")
                    .text(12.5, .semibold, muted)
                    .padding(.top, 10)
            }

            if let store { uploadStatus(store) }
            if showCamera { cameraButton.padding(.top, 12) }
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

    // MARK: Parts

    private func header(count: Int, loading: Bool) -> some View {
        Button(action: onOpenAll) {
            HStack(spacing: 8) {
                Icon("photo.on.rectangle", 17, navy)
                Text("Photos").text(14, .black, ink)
                Spacer(minLength: 0)
                if loading && count == 0 {
                    Spinner(color: muted)
                } else {
                    Text("\(count)").text(13, .heavy, muted).monospacedDigit()
                }
                Icon("chevron.right", 15, muted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open job photos")
    }

    /// Up to four thumbnails; when there are more, the last slot shows "+N".
    private func thumbnails(_ entries: [MediaEntry], store: MediaStore) -> some View {
        let overflow = entries.count > Self.slots
        let shown = entries.prefix(overflow ? Self.slots - 1 : Self.slots)

        return Button(action: onOpenAll) {
            LazyVGrid(columns: Self.columns, spacing: 8) {
                ForEach(shown) { entry in
                    MediaTileImage(entry: entry, store: store, style: .compact)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                if overflow {
                    Color(hex: 0xeef2f1)
                        .aspectRatio(1, contentMode: .fit)
                        .overlay { Text("+\(entries.count - shown.count)").text(14, .black, navy) }
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("View all \(entries.count) photos and videos")
    }

    @ViewBuilder
    private func uploadStatus(_ store: MediaStore) -> some View {
        let counts = store.pendingCounts
        if counts.active > 0 {
            HStack(spacing: 8) {
                Spinner(color: muted)
                Text(UploadCopy.uploading(counts.active)).text(12.5, .bold, muted)
            }
            .padding(.top, 10)
        }
        if counts.failed > 0 {
            let reason = store.pending.first { $0.status == .failed }?.error
            Button {
                store.retryAllFailed()
            } label: {
                HStack(spacing: 8) {
                    Icon("exclamationmark.circle.fill", 15, danger)
                    Text(UploadCopy.failed(counts.failed, reason: reason))
                        .text(12, .bold, danger)
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
    }

    private var cameraButton: some View {
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
        .accessibilityLabel("Take a photo or video for this job")
    }
}
