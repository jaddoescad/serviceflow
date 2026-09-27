import AVFoundation
import ServiceFlowCore
import SwiftUI

/// Full-screen project camera: photos and up to 10-minute videos. Every
/// capture goes straight into the persistent upload queue.
struct CameraScreen: View {
    let projectName: String
    let projectId: String
    let projectKind: ProjectKind
    let onClose: () -> Void
    let onCapture: (() -> Void)?

    @Environment(SessionContext.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var camera = CameraModel()
    /// Local ids of this opening's captures, newest first.
    @State private var captures: [String] = []
    @State private var viewing: CameraViewerItem?
    @State private var noticeExpanded = false
    @State private var closing = false

    init(projectName: String, projectId: String, projectKind: ProjectKind, onClose: @escaping () -> Void,
         onCapture: (() -> Void)? = nil) {
        self.projectName = projectName
        self.projectId = projectId
        self.projectKind = projectKind
        self.onClose = onClose
        self.onCapture = onCapture
    }

    // MARK: Queue

    private var queueItems: [PendingUpload] {
        session.uploads?.items(for: projectId, kind: projectKind) ?? []
    }

    /// This opening's captures first, then anything else still queued.
    private var filmstrip: [PendingUpload] {
        let all = queueItems
        let byId = Dictionary(all.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        let mine = captures.compactMap { byId[$0] }
        let others = all.filter { !captures.contains($0.localId) }.reversed()
        return mine + others
    }

    /// Failed uploads count as "in progress" until they succeed.
    private var uploadCount: Int { queueItems.filter { $0.status != .uploaded }.count }

    // MARK: Body

    var body: some View {
        GeometryReader { geometry in
            let insets = geometry.safeAreaInsets
            ZStack {
                Color(hex: 0x050708)

                if camera.permission == .granted && camera.hasDevice {
                    CameraPreview(model: camera)
                    if !camera.previewReady { statusCard }
                }

                if camera.permission != .granted {
                    permissionCard
                } else if !camera.hasDevice {
                    VStack(spacing: 10) {
                        Icon("camera", 42, .white)
                        Text("No camera is available on this device.").text(15, .bold, .white.opacity(0.8))
                    }
                }

                VStack(spacing: 0) {
                    topBar(top: insets.top)
                    Spacer(minLength: 0)
                    if camera.permission == .granted {
                        bottomControls(bottom: insets.bottom)
                    }
                }

                if let viewing {
                    CameraCaptureViewer(item: viewing, safeTop: insets.top, safeBottom: insets.bottom,
                                        onRetry: { localId in session.uploads?.retry(localId) }) {
                        self.viewing = nil
                    }
                    .transition(.opacity)
                    .zIndex(5)
                }
            }
            .ignoresSafeArea()
        }
        .statusBarHidden(false)
        .preferredColorScheme(.dark)
        .onAppear {
            camera.onPhoto = handlePhoto
            camera.onVideo = handleVideo
            if scenePhase == .active { camera.activate() }
        }
        .onDisappear { camera.deactivate() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { camera.activate() } else { camera.deactivate() }
        }
        .onChange(of: camera.notice) { _, _ in noticeExpanded = false }
        .animation(.easeOut(duration: 0.15), value: viewing?.id)
    }

    // MARK: Top bar

    private func topBar(top: CGFloat) -> some View {
        ZStack {
            HStack(spacing: 0) {
                roundButton("xmark", size: 26, label: "Close camera", disabled: closing) { close() }
                Spacer()
                HStack(spacing: 8) {
                    roundButton(camera.flashOn ? "bolt.fill" : "bolt.slash.fill", size: 20,
                                label: camera.flashOn ? "Turn flash off" : "Turn flash on",
                                active: camera.flashOn, disabled: camera.isRecording || !camera.canUseFlash) {
                        camera.toggleFlash()
                    }
                    .accessibilityAddTraits(camera.flashOn ? .isSelected : [])
                    roundButton("arrow.triangle.2.circlepath.camera", size: 22, label: "Flip camera",
                                disabled: camera.isRecording || !camera.canFlip) {
                        camera.flip()
                    }
                }
            }
            VStack(spacing: 2) {
                Text(projectName.isEmpty ? "Project" : projectName)
                    .text(15, .heavy, .white)
                    .lineLimit(1)
                Text(uploadCount > 0 ? "\(uploadCount) \(uploadCount == 1 ? "upload" : "uploads") in progress" : "Project camera")
                    .text(11, .semibold, .white.opacity(0.66))
                    .lineLimit(1)
            }
            .padding(.horizontal, 112)
            .allowsHitTesting(false)
        }
        .frame(height: 48)
        .padding(.horizontal, 14)
        .padding(.top, max(top, 14))
        .padding(.bottom, 12)
        .background(Color(rgba: 4, 8, 10, 0.56))
    }

    private func roundButton(_ symbol: String, size: CGFloat, label: String, active: Bool = false, disabled: Bool = false,
                             action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.8, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(active ? Color(rgba: 43, 132, 150, 0.9) : Color(rgba: 18, 26, 30, 0.72), in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(active ? 0.45 : 0.22), lineWidth: 1))
                .contentShape(Circle().inset(by: -8))
        }
        .buttonStyle(.pressable(opacity: 0.7))
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(label)
    }

    // MARK: Bottom controls

    private func bottomControls(bottom: CGFloat) -> some View {
        VStack(spacing: 0) {
            if let notice = camera.notice { errorNotice(notice) }
            if !filmstrip.isEmpty { filmstripView }
            if camera.isFinalizing {
                HStack(spacing: 8) {
                    Spinner(color: .white)
                    Text("Saving…").text(15, .black, .white).monospacedDigit()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Color(rgba: 8, 15, 18, 0.82), in: Capsule())
                .padding(.bottom, 12)
            }
            if camera.isRecording, let started = camera.recordingStartedAt {
                TimelineView(.periodic(from: started, by: 0.5)) { context in
                    let seconds = min(CameraModel.maxVideoSeconds, max(0, Int(context.date.timeIntervalSince(started))))
                    HStack(spacing: 7) {
                        Circle().fill(.white).frame(width: 8, height: 8)
                        Text(DurationFormat.recording(seconds: seconds)).text(15, .black, .white).monospacedDigit()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color(rgba: 160, 36, 30, 0.92), in: Capsule())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Recording, \(seconds) of 600 seconds")
                }
                .padding(.bottom, 12)
            }
            if camera.previewReady { zoomRow }
            modeSwitch
            shutterRow
        }
        .padding(.top, 14)
        .padding(.bottom, max(bottom, 16) + 10)
        .frame(maxWidth: .infinity)
        .background(Color(rgba: 4, 8, 10, 0.68))
    }

    private var zoomRow: some View {
        HStack(spacing: 6) {
            ForEach(camera.availableSteps, id: \.self) { step in
                let active = step == camera.activeStep
                Button {
                    camera.zoom(to: step)
                } label: {
                    Text(camera.label(for: step))
                        .font(.app(12, .heavy))
                        .monospacedDigit()
                        .foregroundStyle(active ? Color(hex: 0x0b1518) : Color.white.opacity(0.86))
                        .padding(.horizontal, 7)
                        .frame(minWidth: 34, minHeight: 30)
                        .background(active ? Color.white : Color(rgba: 18, 26, 30, 0.72), in: Capsule())
                        .overlay(Capsule().strokeBorder(active ? Color.white : Color.white.opacity(0.22), lineWidth: 1))
                        .contentShape(Capsule().inset(by: -8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Zoom \(step == 0.5 ? "0.5" : String(Int(step)))x")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(.bottom, 10)
    }

    private var modeSwitch: some View {
        HStack(spacing: 0) {
            modeSegment(.photo, title: "Photo", icon: "camera.fill", label: "Photo mode")
            modeSegment(.video, title: "Video", icon: "video.fill", label: "Video mode")
        }
        .padding(3)
        .background(Color.white.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
        .padding(.bottom, 12)
    }

    private func modeSegment(_ mode: CameraMode, title: String, icon: String, label: String) -> some View {
        let active = camera.mode == mode
        let color = active ? Color(hex: 0x0b1518) : Color.white.opacity(0.72)
        return Button {
            camera.select(mode)
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                Text(title).font(.app(13, .heavy)).tracking(0.3)
            }
            .foregroundStyle(color)
            .padding(.horizontal, 12)
            .frame(minWidth: 88, minHeight: 34)
            .background(active ? Color.white : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(camera.isRecording || camera.isFinalizing)
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var shutterRow: some View {
        HStack(spacing: 0) {
            Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
            Button {
                camera.shutter()
            } label: {
                EmptyView()
            }
            .buttonStyle(CameraShutterStyle(mode: camera.mode, recording: camera.isRecording))
            .disabled(!camera.canShoot && !camera.isRecording)
            .opacity(!camera.canShoot && !camera.isRecording ? 0.45 : 1)
            .accessibilityLabel(camera.isRecording ? "Stop recording" : camera.mode == .video ? "Record video" : "Take photo")
            ZStack {
                if uploadCount > 0 {
                    Text("\(uploadCount)")
                        .text(14, .black, .white)
                        .padding(.horizontal, 10)
                        .frame(minWidth: 38, minHeight: 38)
                        .background(Color(rgba: 43, 132, 150, 0.92), in: Capsule())
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
                        .accessibilityLabel("\(uploadCount) uploads in progress")
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: Filmstrip

    private var filmstripView: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(filmstrip) { item in
                    filmstripTile(item)
                }
            }
            .padding(.horizontal, 14)
        }
        .scrollIndicators(.hidden)
        .padding(.bottom, 12)
    }

    private func filmstripTile(_ item: PendingUpload) -> some View {
        let status = CameraUploadStatus(item)
        let fileURL = session.uploads?.fileURL(for: item)
        let posterURL = session.uploads?.posterURL(for: item)
        return Button {
            viewing = CameraViewerItem(upload: item, fileURL: fileURL, statusText: status.text)
        } label: {
            ZStack {
                if item.kind == .image {
                    MediaAsyncImage(url: fileURL, downsampleTo: 48)
                } else {
                    Color(hex: 0x223746)
                    if let posterURL, FileManager.default.fileExists(atPath: posterURL.path) {
                        MediaAsyncImage(url: posterURL, downsampleTo: 48)
                    } else {
                        Icon("video.fill", 20, .white)
                    }
                }
                if item.status == .failed {
                    Color(rgba: 160, 48, 36, 0.45)
                    Icon("exclamationmark", 16, .white)
                }
            }
            .frame(width: 48, height: 48)
            .overlay(alignment: .bottomLeading) {
                if item.kind == .video {
                    Circle().fill(Color(rgba: 8, 15, 18, 0.72)).frame(width: 18, height: 18)
                        .overlay { Image(systemName: "play.fill").font(.system(size: 8, weight: .bold)).foregroundStyle(.white) }
                        .padding(3)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Circle().fill(status.background).frame(width: 18, height: 18)
                    .overlay {
                        if item.status == .uploading {
                            ProgressView().controlSize(.mini).tint(.white)
                        } else {
                            Image(systemName: status.symbol).font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                        }
                    }
                    .padding(3)
            }
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Color.white.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.pressable(opacity: 0.7))
        .accessibilityLabel("Open \(item.kind == .video ? "video" : "photo") capture, \(status.text)")
    }

    // MARK: Notices and cards

    private func errorNotice(_ notice: CameraNotice) -> some View {
        let expandable = notice.details != nil || notice.message.count > 80
        return HStack(alignment: .top, spacing: 7) {
            Icon("exclamationmark.circle.fill", 15, .white)
            VStack(alignment: .leading, spacing: 0) {
                Text(notice.message)
                    .text(11, .bold, .white)
                    .lineLimit(noticeExpanded ? nil : 1)
                if noticeExpanded, let details = notice.details {
                    Text(details)
                        .text(9.5, .regular, .white.opacity(0.76))
                        .textSelection(.enabled)
                        .padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
            if expandable {
                Button(noticeExpanded ? "Show less" : "Show more") { noticeExpanded.toggle() }
                    .font(.app(10, .black))
                    .foregroundStyle(.white)
                    .accessibilityLabel(noticeExpanded ? "Show less error detail" : "Show more error detail")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color(rgba: 160, 48, 36, 0.9), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.horizontal, 14)
        .padding(.bottom, 12)
    }

    private var statusCard: some View {
        VStack(spacing: 0) {
            if camera.previewFailed {
                Icon("camera", 28, .white)
                Text("Camera preview unavailable").text(14, .heavy, .white).padding(.top, 10)
                Button {
                    camera.retryPreview()
                } label: {
                    HStack(spacing: 7) {
                        Icon("arrow.clockwise", 18, Color(hex: 0x0b2025))
                        Text("Retry camera").text(14, .black, Color(hex: 0x0b2025))
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(Color(hex: 0x58c7d6), in: Capsule())
                }
                .buttonStyle(.pressable(opacity: 0.8))
                .padding(.top, 14)
                .accessibilityLabel("Retry camera preview")
            } else {
                ProgressView().tint(.white)
                Text("Starting camera…").text(14, .heavy, .white).padding(.top, 10)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .frame(minWidth: 220)
        .background(Color(rgba: 8, 15, 18, 0.82), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
        .allowsHitTesting(camera.previewFailed)
    }

    private var permissionCard: some View {
        ZStack {
            Color(hex: 0x10181c)
            VStack(spacing: 0) {
                Icon("camera", 42, .white)
                Text("Camera access needed").text(21, .black, .white).padding(.top, 16)
                Text("ServiceFlow needs camera access to capture project photos and videos.")
                    .text(14, .semibold, .white.opacity(0.72))
                    .lineSpacing(6)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
                Button {
                    if camera.permission == .notDetermined {
                        camera.requestPermission()
                    } else if let url = URL(string: UIApplication.openSettingsURLString) {
                        openURL(url)
                    }
                } label: {
                    Text(camera.permission == .notDetermined ? "Allow Camera" : "Open Settings")
                        .text(14, .black, Color(hex: 0x0b2025))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 13)
                        .frame(minWidth: 150)
                        .background(Color(hex: 0x58c7d6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.pressable(opacity: 0.8))
                .padding(.top, 22)
            }
            .padding(.horizontal, 34)
        }
    }

    // MARK: Captures

    private func handlePhoto(_ photo: CameraPhotoResult) {
        enqueue(CapturedMedia(fileURL: photo.url, kind: .image, mimeType: "image/jpeg", width: photo.width, height: photo.height,
                              capturedAt: photo.capturedAt), cleanup: [photo.url])
    }

    private func handleVideo(_ url: URL, durationMs: Int, startedAt: Date) {
        Task {
            // A still from the video: shown in the filmstrip and uploaded as
            // the grid thumbnail, so nothing has to be generated later.
            let poster = await CameraPoster.make(from: url)
            enqueue(CapturedMedia(fileURL: url, posterURL: poster, kind: .video, mimeType: "video/mp4", durationMs: durationMs,
                                  capturedAt: startedAt), cleanup: [url, poster].compactMap { $0 })
        }
    }

    private func enqueue(_ capture: CapturedMedia, cleanup: [URL]) {
        guard let uploads = session.uploads else {
            cleanup.forEach { try? FileManager.default.removeItem(at: $0) }
            camera.show(message: "Project media is not configured.")
            return
        }
        guard let item = uploads.enqueue(capture, projectId: projectId, projectKind: projectKind) else {
            cleanup.forEach { try? FileManager.default.removeItem(at: $0) }
            camera.show(message: capture.kind == .video ? "The video could not be recorded." : "The photo could not be captured.",
                        details: "The capture could not be saved for upload.")
            return
        }
        captures.insert(item.localId, at: 0)
        onCapture?()
    }

    private func close() {
        guard !closing else { return }
        closing = true
        Task {
            // A recording in progress is finished and kept, not thrown away.
            await camera.finishPendingCapture()
            camera.deactivate()
            onClose()
        }
    }
}

/// The shutter: white disc for photos, red disc for video, red square while recording.
private struct CameraShutterStyle: ButtonStyle {
    let mode: CameraMode
    let recording: Bool

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed && !recording
        ZStack {
            Circle()
                .strokeBorder(recording ? Color(hex: 0xef4d4d) : .white, lineWidth: 4)
                .frame(width: 80, height: 80)
            if recording {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(hex: 0xef4d4d))
                    .frame(width: 32, height: 32)
            } else {
                Circle()
                    .fill(mode == .photo ? Color.white : Color(hex: 0xef4d4d))
                    .frame(width: pressed ? 56 : 64, height: pressed ? 56 : 64)
                    .opacity(pressed ? 0.85 : 1)
            }
        }
        .contentShape(Circle())
        .animation(.easeOut(duration: 0.12), value: pressed)
        .animation(.easeOut(duration: 0.15), value: recording)
    }
}

/// Filmstrip badge and status text for a queued capture.
struct CameraUploadStatus {
    let text: String
    let symbol: String
    let background: Color

    init(_ item: PendingUpload) {
        switch item.status {
        case .uploading:
            self.init("uploading", "arrow.up", Color(rgba: 20, 86, 97, 0.92))
        case .uploaded:
            self.init("uploaded", "checkmark", Color(hex: 0x2e9e5b))
        case .failed:
            self.init("upload failed, tap to retry", "arrow.clockwise", Color(hex: 0xc24836))
        case .queued:
            if item.attempts > 0 {
                self.init("retrying upload", "arrow.triangle.2.circlepath", Color(hex: 0xb07c1f))
            } else {
                self.init("waiting to upload", "clock", Color(rgba: 20, 86, 97, 0.92))
            }
        }
    }

    private init(_ text: String, _ symbol: String, _ background: Color) {
        self.text = text
        self.symbol = symbol
        self.background = background
    }
}

enum CameraPoster {
    /// A JPEG still from near the start of a video, oriented upright.
    static func make(from url: URL) async -> URL? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 1280, height: 1280)
        guard let image = try? await generator.image(at: CMTime(seconds: 0.1, preferredTimescale: 600)).image,
              let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.8) else { return nil }
        let posterURL = url.deletingPathExtension().appendingPathExtension("poster.jpg")
        do {
            try data.write(to: posterURL, options: .atomic)
            return posterURL
        } catch {
            return nil
        }
    }
}
