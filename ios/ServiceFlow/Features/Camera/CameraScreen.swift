import AVFoundation
import ServiceFlowCore
import SwiftUI

/// Full-screen project camera, laid out like CompanyCam's: the preview as a
/// rounded card, controls down the right edge, the shutter with Done, a
/// Photo/Video switch, and a drawer of this session's captures where each one
/// gets a note and markup. Captures are held until Done (or close), then
/// upload with their notes and drawings.
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
    @State private var dictation = CameraDictation()
    /// Local ids of this opening's captures, newest first.
    @State private var captures: [String] = []
    @State private var sheetExpanded = false
    @State private var editing: PendingUpload?
    @State private var viewing: CameraViewerItem?
    @State private var noticeExpanded = false
    @State private var closing = false
    @State private var flashPulse = false

    init(projectName: String, projectId: String, projectKind: ProjectKind, onClose: @escaping () -> Void,
         onCapture: (() -> Void)? = nil) {
        self.projectName = projectName
        self.projectId = projectId
        self.projectKind = projectKind
        self.onClose = onClose
        self.onCapture = onCapture
    }

    /// This opening's captures, newest first.
    private var sessionItems: [PendingUpload] {
        let all = session.uploads?.items(for: projectId, kind: projectKind) ?? []
        let byId = Dictionary(all.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return captures.compactMap { byId[$0] }
    }

    private static let spring = Animation.spring(response: 0.3, dampingFraction: 0.88)

    // MARK: Body

    var body: some View {
        GeometryReader { geometry in
            let insets = geometry.safeAreaInsets
            let full = CGSize(width: geometry.size.width + insets.leading + insets.trailing,
                              height: geometry.size.height + insets.top + insets.bottom)
            let layout = CameraLayout(size: full, insets: insets, mode: camera.mode)
            ZStack {
            ZStack(alignment: .top) {
                Color.black

                if camera.permission == .granted && camera.hasDevice {
                    previewCard(layout)
                } else if camera.permission != .granted {
                    permissionCard(layout)
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "camera").font(.system(size: 36)).foregroundStyle(.white)
                        Text("No camera is available on this device.").font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.8))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                closeButton.position(x: 33, y: layout.previewTop + 38)

                if camera.permission == .granted {
                    sideControls.position(x: full.width - 36, y: layout.previewTop + 38 + 26)
                    zoomRail.position(x: full.width - 36, y: layout.zoomCenterY)
                    if camera.isRecording || camera.isFinalizing { recordingPill.position(x: full.width / 2, y: layout.previewTop + 30) }
                    if let notice = camera.notice {
                        errorNotice(notice).frame(width: full.width).position(x: full.width / 2, y: layout.previewTop + 80)
                    }
                    shutterRow.frame(width: full.width).position(x: full.width / 2, y: layout.shutterCenterY)
                    modeSwitcher.frame(width: full.width).position(x: full.width / 2, y: layout.modeCenterY)
                }

                if let viewing {
                    CameraCaptureViewer(item: viewing, safeTop: insets.top, safeBottom: insets.bottom,
                                        onRetry: { session.uploads?.retry($0) }) { self.viewing = nil }
                        .transition(.opacity)
                        .zIndex(5)
                }
            }
            .frame(width: full.width, height: full.height)
            .ignoresSafeArea()

            // Its own layer so it rises with the keyboard while a note is typed.
            if camera.permission == .granted, viewing == nil {
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    CameraCaptureSheet(
                        items: sessionItems,
                        collapsedHeight: layout.sheetCollapsed,
                        expandedHeight: full.height - 60,
                        expanded: $sheetExpanded,
                        dictation: dictation,
                        onEdit: { item in
                            guard item.kind == .image else { return }
                            editing = item
                        },
                        onView: openViewer,
                        onDictationBegin: { camera.beginDictation() },
                        onDictationEnd: { camera.endDictation() }
                    )
                }
                .ignoresSafeArea(.container, edges: .bottom)
            }
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
        .onAppear {
            camera.onPhoto = handlePhoto
            camera.onVideo = handleVideo
            if scenePhase == .active { camera.activate() }
        }
        .onDisappear {
            dictation.stop()
            camera.deactivate()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, editing == nil { camera.activate() } else if phase != .active { camera.deactivate() }
        }
        .onChange(of: camera.notice) { _, _ in noticeExpanded = false }
        .onChange(of: editing?.localId) { _, id in
            // The editor has the screen; the camera rests until it closes.
            if id != nil { camera.deactivate() } else if scenePhase == .active { camera.activate() }
        }
        .fullScreenCover(item: $editing) { item in
            CameraPhotoEditorHost(item: item) { editing = nil }
                .environment(session)
        }
        .animation(.easeOut(duration: 0.15), value: viewing?.id)
    }

    // MARK: Preview

    private func previewCard(_ layout: CameraLayout) -> some View {
        ZStack {
            CameraPreview(model: camera)
            if !camera.previewReady { statusCard.transition(.opacity) }
            // Brief white flash when a photo is taken.
            Color.white.opacity(flashPulse ? 0.55 : 0).allowsHitTesting(false)
        }
        .frame(width: layout.size.width, height: layout.previewHeight)
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .animation(.easeOut(duration: 0.35), value: camera.previewReady)
        .offset(y: layout.previewTop)
        .animation(Self.spring, value: camera.mode)
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    let dx = value.translation.width
                    guard abs(dx) > 50, abs(dx) > abs(value.translation.height) * 1.5 else { return }
                    withAnimation(Self.spring) { camera.select(dx < 0 ? .video : .photo) }
                }
        )
    }

    // MARK: Controls

    private var closeButton: some View {
        Button(action: close) {
            Image(systemName: "xmark")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.35), radius: 4)
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .disabled(closing)
        .accessibilityLabel("Close camera")
    }

    private var sideControls: some View {
        VStack(spacing: 22) {
            sideButton(symbol: "arrow.triangle.2.circlepath", label: "Flip camera", enabled: camera.canFlip && !camera.isRecording) {
                camera.flip()
            }
            sideButton(symbol: flashSymbol, label: camera.flashOn ? "Turn flash off" : "Turn flash on",
                       enabled: camera.canUseFlash && !camera.isRecording) {
                camera.toggleFlash()
            }
        }
    }

    private var flashSymbol: String {
        switch camera.mode {
        case .photo: return camera.flashOn ? "bolt.fill" : "bolt.slash.fill"
        case .video: return camera.flashOn ? "flashlight.on.fill" : "flashlight.off.fill"
        }
    }

    private func sideButton(symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.35), radius: 4)
                .frame(width: 48, height: 40)
                .contentShape(Rectangle())
                .contentTransition(.symbolEffect(.replace))
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }

    private var zoomRail: some View {
        VStack(spacing: 14) {
            ForEach(camera.availableSteps.reversed(), id: \.self) { step in
                let active = step == camera.activeStep
                Button {
                    camera.zoom(to: step)
                } label: {
                    Text(camera.label(for: step))
                        .font(.system(size: 13, weight: .bold).monospacedDigit())
                        .foregroundStyle(active ? .black : .white)
                        .shadow(color: active ? .clear : .black.opacity(0.4), radius: 3)
                        .frame(width: 34, height: 34)
                        .background(active ? Color.white : Color.clear, in: Circle())
                        .contentShape(Circle())
                }
                .accessibilityLabel("Zoom \(step == 0.5 ? "0.5" : String(Int(step)))x")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .animation(.easeOut(duration: 0.15), value: camera.activeStep)
    }

    private var recordingPill: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            let seconds = camera.recordingStartedAt.map { Int(context.date.timeIntervalSince($0)) } ?? 0
            HStack(spacing: 7) {
                if camera.isFinalizing {
                    ProgressView().controlSize(.mini).tint(.white)
                    Text("Saving…")
                } else {
                    Circle().fill(Color.white).frame(width: 8, height: 8)
                    Text(String(format: "%02d:%02d", min(seconds, 600) / 60, min(seconds, 600) % 60))
                }
            }
            .font(.system(size: 15, weight: .bold).monospacedDigit())
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(hex: 0xd92d20), in: Capsule())
        }
        .accessibilityLabel("Recording")
    }

    private var shutterRow: some View {
        ZStack {
            Button(action: shutter) { EmptyView() }
                .buttonStyle(CompanyCamShutterStyle(mode: camera.mode, recording: camera.isRecording))
                .disabled(!camera.canShoot && !camera.isRecording)
                .accessibilityLabel(camera.isRecording ? "Stop recording" : (camera.mode == .video ? "Record video" : "Take photo"))

            Button(action: close) {
                Text("Done")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(width: 74, height: 46)
                    .background(Color.white, in: Capsule())
            }
            .buttonStyle(.pressable(opacity: 0.8))
            .disabled(closing || camera.isRecording)
            .opacity(camera.isRecording ? 0 : 1)
            .offset(x: 119)
            .accessibilityLabel("Done")
        }
    }

    private var modeSwitcher: some View {
        let width: CGFloat = 92
        return HStack(spacing: 0) {
            modeLabel("Photo", mode: .photo, width: width)
            modeLabel("Video", mode: .video, width: width)
        }
        .offset(x: camera.mode == .photo ? width / 2 : -width / 2)
        .animation(Self.spring, value: camera.mode)
        .opacity(camera.isRecording ? 0 : 1)
        .allowsHitTesting(!camera.isRecording)
    }

    private func modeLabel(_ title: String, mode: CameraMode, width: CGFloat) -> some View {
        let selected = camera.mode == mode
        return Button {
            withAnimation(Self.spring) { camera.select(mode) }
        } label: {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(selected ? .black : .white)
                .padding(.horizontal, 16)
                .frame(height: 34)
                .background(selected ? Color.white : Color.clear, in: Capsule())
                .frame(width: width)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title) mode")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Status and errors

    private func errorNotice(_ notice: CameraNotice) -> some View {
        let expandable = notice.details != nil || notice.message.count > 80
        return HStack(alignment: .top, spacing: 7) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.white)
            VStack(alignment: .leading, spacing: 4) {
                Text(notice.message).font(.footnote.weight(.semibold)).foregroundStyle(.white)
                    .lineLimit(noticeExpanded ? nil : 2)
                if noticeExpanded, let details = notice.details {
                    Text(details).font(.caption2).foregroundStyle(.white.opacity(0.76)).textSelection(.enabled)
                }
            }
            Spacer(minLength: 0)
            if expandable {
                Button(noticeExpanded ? "Less" : "More") { noticeExpanded.toggle() }
                    .font(.caption.weight(.bold)).foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color(rgba: 160, 48, 36, 0.92), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 64)
        .onTapGesture { camera.dismissNotice() }
    }

    private var statusCard: some View {
        VStack(spacing: 12) {
            if camera.previewFailed {
                Image(systemName: "camera").font(.system(size: 26)).foregroundStyle(.white)
                Text("Camera preview unavailable").font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                Button("Retry Camera") { camera.retryPreview() }
                    .buttonStyle(.borderedProminent)
                    .tint(.white)
                    .foregroundStyle(.black)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            // Like the system camera: the last frame, blurred, until the live
            // picture is back and has refocused.
            if let frame = camera.frozenFrame, !camera.previewFailed {
                Image(uiImage: frame).resizable().scaledToFill().blur(radius: 22, opaque: true).clipped()
            } else {
                Color.black
            }
        }
        .allowsHitTesting(camera.previewFailed)
    }

    private func permissionCard(_ layout: CameraLayout) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill").font(.system(size: 38)).foregroundStyle(.white)
            Text("Camera access needed").font(.title3.weight(.bold)).foregroundStyle(.white)
            Text("ServiceFlow needs camera access to capture project photos and videos.")
                .font(.subheadline).foregroundStyle(.white.opacity(0.72)).multilineTextAlignment(.center)
            Button(camera.permission == .notDetermined ? "Allow Camera" : "Open Settings") {
                if camera.permission == .notDetermined {
                    camera.requestPermission()
                } else if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundStyle(.black)
            .padding(.top, 8)
        }
        .padding(.horizontal, 36)
        .frame(width: layout.size.width, height: layout.previewHeight)
        .background(Color(hex: 0x16191a), in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .offset(y: layout.previewTop)
    }

    // MARK: Capture

    private func shutter() {
        if camera.mode == .photo, camera.canShoot {
            withAnimation(.easeOut(duration: 0.05)) { flashPulse = true }
            withAnimation(.easeOut(duration: 0.25).delay(0.06)) { flashPulse = false }
        }
        camera.shutter()
    }

    private func handlePhoto(_ photo: CameraPhotoResult) {
        enqueue(CapturedMedia(fileURL: photo.url, kind: .image, mimeType: "image/jpeg", width: photo.width, height: photo.height,
                              capturedAt: photo.capturedAt), cleanup: [photo.url])
    }

    private func handleVideo(_ url: URL, durationMs: Int, startedAt: Date) {
        Task {
            // A still from the video, shown in the drawer and uploaded as the
            // grid thumbnail so nothing has to be generated later.
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
        // Held until Done, so notes and markup are added before it uploads.
        guard let item = uploads.enqueue(capture, projectId: projectId, projectKind: projectKind, held: true) else {
            cleanup.forEach { try? FileManager.default.removeItem(at: $0) }
            camera.show(message: capture.kind == .video ? "The video could not be recorded." : "The photo could not be captured.",
                        details: "The capture could not be saved for upload.")
            return
        }
        withAnimation(Self.spring) { captures.insert(item.localId, at: 0) }
        onCapture?()
    }

    private func openViewer(_ item: PendingUpload) {
        guard let uploads = session.uploads else { return }
        viewing = CameraViewerItem(upload: item, fileURL: uploads.fileURL(for: item), statusText: CameraUploadStatus(item).text)
    }

    /// Done and close both keep the captures: they start uploading now.
    private func close() {
        guard !closing else { return }
        closing = true
        dictation.stop()
        hideKeyboard()
        Task {
            // A recording in progress is finished and kept, not thrown away.
            await camera.finishPendingCapture()
            session.uploads?.release(projectId: projectId)
            camera.deactivate()
            onClose()
        }
    }
}

/// Positions of the camera's parts for the current mode.
private struct CameraLayout {
    let size: CGSize
    let insets: EdgeInsets
    let mode: CameraMode

    /// The drawer's collapsed height, including the home-indicator area.
    var sheetCollapsed: CGFloat { 104 + insets.bottom }
    var previewTop: CGFloat { insets.top + 10 }
    var modeCenterY: CGFloat { size.height - sheetCollapsed - 34 }
    var shutterCenterY: CGFloat { modeCenterY - 17 - 22 - 40 }

    /// Photo: the preview ends above the shutter. Video: it runs behind the
    /// controls down to the drawer.
    var previewHeight: CGFloat {
        let bottom = mode == .photo ? shutterCenterY - 40 - 16 : size.height - sheetCollapsed + 30
        return max(200, bottom - previewTop)
    }

    var zoomCenterY: CGFloat {
        let photoHeight = (shutterCenterY - 40 - 16) - previewTop
        return previewTop + photoHeight * (mode == .photo ? 0.6 : 0.7)
    }
}

/// White ring shutter: white disc for photos, red disc for video, red square while recording.
private struct CompanyCamShutterStyle: ButtonStyle {
    let mode: CameraMode
    let recording: Bool

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed && !recording
        ZStack {
            Circle().strokeBorder(Color.white, lineWidth: 4).frame(width: 80, height: 80)
            if recording {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(hex: 0xd92d20))
                    .frame(width: 30, height: 30)
            } else {
                Circle()
                    .fill(mode == .photo ? Color.white : Color(hex: 0xd92d20))
                    .frame(width: pressed ? 60 : 66, height: pressed ? 60 : 66)
            }
        }
        .frame(width: 84, height: 84)
        .contentShape(Circle())
        .animation(.easeOut(duration: 0.1), value: pressed)
        .animation(.spring(response: 0.25, dampingFraction: 0.8), value: recording)
        .animation(.easeOut(duration: 0.18), value: mode)
    }
}

/// Status text for a queued capture.
struct CameraUploadStatus {
    let text: String

    init(_ item: PendingUpload) {
        switch item.status {
        case .uploading: text = "uploading"
        case .uploaded: text = "uploaded"
        case .failed: text = "upload failed, tap to retry"
        case .queued: text = item.isHeld ? "uploads when you tap Done" : (item.attempts > 0 ? "retrying upload" : "waiting to upload")
        }
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
