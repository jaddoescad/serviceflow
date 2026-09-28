import ServiceFlowCore
import SwiftUI

/// Full-screen project camera, laid out like CompanyCam's: the preview as a
/// rounded card, flip/flash/zoom down the right edge, the shutter with Done, a
/// Photo/Video switch, and a drawer of this opening's captures where each
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
    @State private var camera = CameraModel()
    @State private var dictation = CameraDictation()
    /// Local ids of this opening's captures, newest first.
    @State private var captureIds: [String] = []
    @State private var editing: PendingUpload?
    /// The job's photos already on the server, shown under this opening's shots.
    @State private var jobMedia: MediaStore?
    @State private var editingUploaded: MediaItem?
    @State private var viewing: CameraViewerItem?
    @State private var closing = false
    @State private var shutterFlash = false

    init(projectName: String, projectId: String, projectKind: ProjectKind, onClose: @escaping () -> Void,
         onCapture: (() -> Void)? = nil) {
        self.projectName = projectName
        self.projectId = projectId
        self.projectKind = projectKind
        self.onClose = onClose
        self.onCapture = onCapture
    }

    static let spring = Animation.spring(response: 0.3, dampingFraction: 0.88)

    private var isEditing: Bool { editing != nil || editingUploaded != nil }

    private var drawerEntries: [CameraDrawerEntry] {
        CameraDrawerEntry.list(captures: captures, uploaded: jobMedia?.items ?? [])
    }

    /// This opening's captures, newest first.
    private var captures: [PendingUpload] {
        let all = session.uploads?.items(for: projectId, kind: projectKind) ?? []
        let byId = Dictionary(all.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return captureIds.compactMap { byId[$0] }
    }

    // MARK: Body

    var body: some View {
        GeometryReader { geometry in
            let insets = geometry.safeAreaInsets
            let size = CGSize(width: geometry.size.width + insets.leading + insets.trailing,
                              height: geometry.size.height + insets.top + insets.bottom)
            let layout = CameraLayout(size: size, insets: insets, mode: camera.mode)
            ZStack {
                cameraLayer(layout)
                    .frame(width: size.width, height: size.height)
                    .ignoresSafeArea()
                // Its own layer so it rises with the keyboard while a note is typed.
                if camera.permission == .granted, viewing == nil { drawer(layout) }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            camera.onPhoto = handlePhoto
            camera.onVideo = handleVideo
            if scenePhase == .active { camera.activate() }
        }
        .task { await loadJobMedia() }
        .onDisappear {
            dictation.stop()
            camera.deactivate()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, !isEditing { camera.activate() } else if phase != .active { camera.deactivate() }
        }
        .onChange(of: isEditing) { _, editing in
            // The editor has the screen; the camera rests until it closes.
            if editing { camera.deactivate() } else if scenePhase == .active { camera.activate() }
        }
        .fullScreenCover(item: $editing) { item in
            CameraPhotoEditorHost(localId: item.localId) { editing = nil }
                .environment(session)
        }
        .fullScreenCover(item: $editingUploaded) { item in
            if let jobMedia {
                MediaPhotoEditFlow(item: item, store: jobMedia) { editingUploaded = nil }
                    .environment(session)
            }
        }
        .animation(.easeOut(duration: 0.15), value: viewing?.id)
    }

    private func cameraLayer(_ layout: CameraLayout) -> some View {
        ZStack(alignment: .top) {
            Color.black

            switch (camera.permission, camera.hasDevice) {
            case (.granted, true): preview(layout)
            case (.granted, false): CameraUnavailableView()
            default:
                CameraPermissionCard(permission: camera.permission, onAllow: camera.requestPermission)
                    .frame(width: layout.size.width, height: layout.previewHeight)
                    .background(Color(hex: 0x16191a), in: RoundedRectangle(cornerRadius: CameraLayout.previewCornerRadius, style: .continuous))
                    .offset(y: layout.previewTop)
            }

            CameraCloseButton(disabled: closing, action: close).position(x: 33, y: layout.topControlsY)

            if camera.permission == .granted { controls(layout) }

            if let viewing {
                CameraCaptureViewer(item: viewing, safeTop: layout.insets.top, safeBottom: layout.insets.bottom,
                                    onRetry: { session.uploads?.retry($0) }) { self.viewing = nil }
                    .transition(.opacity)
                    .zIndex(5)
            }
        }
    }

    @ViewBuilder
    private func controls(_ layout: CameraLayout) -> some View {
        let width = layout.size.width
        CameraSideControls(camera: camera).position(x: width - 36, y: layout.topControlsY + 26)
        CameraZoomRail(camera: camera).position(x: width - 36, y: layout.zoomCenterY)
        if camera.isRecording || camera.isFinalizing {
            CameraRecordingPill(camera: camera).position(x: width / 2, y: layout.previewTop + 30)
        }
        if let notice = camera.notice {
            CameraNoticeBanner(notice: notice, onDismiss: camera.dismissNotice)
                .frame(width: width).position(x: width / 2, y: layout.previewTop + 80)
        }
        CameraShutterRow(camera: camera, closing: closing, onShutter: shutter, onDone: close)
            .frame(width: width).position(x: width / 2, y: layout.shutterCenterY)
        CameraModeSwitcher(camera: camera, animation: Self.spring)
            .frame(width: width).position(x: width / 2, y: layout.modeCenterY)
    }

    private func preview(_ layout: CameraLayout) -> some View {
        ZStack {
            CameraPreview(model: camera)
            if !camera.previewReady { CameraPreviewPlaceholder(camera: camera).transition(.opacity) }
            Color.white.opacity(shutterFlash ? 0.55 : 0).allowsHitTesting(false)
        }
        .frame(width: layout.size.width, height: layout.previewHeight)
        .clipShape(RoundedRectangle(cornerRadius: CameraLayout.previewCornerRadius, style: .continuous))
        .animation(.easeOut(duration: 0.35), value: camera.previewReady)
        .offset(y: layout.previewTop)
        .animation(Self.spring, value: camera.mode)
        // Swiping sideways on the preview switches Photo and Video.
        .simultaneousGesture(
            DragGesture(minimumDistance: 24).onEnded { value in
                let dx = value.translation.width
                guard abs(dx) > 50, abs(dx) > abs(value.translation.height) * 1.5 else { return }
                withAnimation(Self.spring) { camera.select(dx < 0 ? .video : .photo) }
            }
        )
    }

    private func drawer(_ layout: CameraLayout) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            CameraCaptureSheet(
                entries: drawerEntries,
                isLoading: jobMedia?.hasLoaded != true,
                collapsedHeight: layout.drawerCollapsed,
                expandedHeight: layout.drawerExpanded,
                dictation: dictation,
                canEdit: canEdit,
                onEdit: edit,
                onView: view,
                onNote: saveNote,
                onDictationBegin: camera.beginDictation,
                onDictationEnd: camera.endDictation
            )
        }
        .ignoresSafeArea(.container, edges: .bottom)
    }

    // MARK: Capture

    private func shutter() {
        if camera.mode == .photo, camera.canShoot {
            withAnimation(.easeOut(duration: 0.05)) { shutterFlash = true }
            withAnimation(.easeOut(duration: 0.25).delay(0.06)) { shutterFlash = false }
        }
        camera.shutter()
    }

    private func handlePhoto(_ photo: CameraPhotoResult) {
        let capture = CapturedMedia(fileURL: photo.url, kind: .image, mimeType: "image/jpeg", width: photo.width,
                                    height: photo.height, capturedAt: photo.capturedAt)
        enqueue(capture, files: [photo.url])
    }

    private func handleVideo(_ url: URL, durationMs: Int, startedAt: Date) {
        Task {
            let poster = await CameraPoster.make(from: url)
            let capture = CapturedMedia(fileURL: url, posterURL: poster, kind: .video, mimeType: "video/mp4",
                                        durationMs: durationMs, capturedAt: startedAt)
            enqueue(capture, files: [url, poster].compactMap { $0 })
        }
    }

    /// Hands a capture to the upload queue, held until Done so notes and
    /// markup go up with it. `files` are removed if it can't be queued.
    private func enqueue(_ capture: CapturedMedia, files: [URL]) {
        guard let uploads = session.uploads else {
            files.forEach { try? FileManager.default.removeItem(at: $0) }
            camera.show(message: "Project media is not configured.")
            return
        }
        guard let item = uploads.enqueue(capture, projectId: projectId, projectKind: projectKind, held: true) else {
            files.forEach { try? FileManager.default.removeItem(at: $0) }
            let failure: CameraFailure = capture.kind == .video ? .video(nil) : .photo(nil)
            camera.show(message: failure.message, details: "The capture could not be saved for upload.")
            return
        }
        withAnimation(Self.spring) { captureIds.insert(item.localId, at: 0) }
        onCapture?()
    }

    // MARK: Drawer

    private func loadJobMedia() async {
        let project = Project(id: projectId, name: projectName, isLead: projectKind == .lead)
        let store = MediaStore(project: project, session: session, includeLinkedLead: true)
        jobMedia = store
        await store.load()
    }

    private func canEdit(_ entry: CameraDrawerEntry) -> Bool {
        switch entry {
        case .capture: return true
        case .uploaded(let item): return jobMedia?.canEdit(item) ?? false
        }
    }

    private func edit(_ entry: CameraDrawerEntry) {
        guard entry.kind == .image else { return }
        switch entry {
        case .capture(let upload): editing = upload
        case .uploaded(let item): editingUploaded = item
        }
    }

    private func view(_ entry: CameraDrawerEntry) {
        if case .capture(let upload) = entry { openViewer(upload) }
    }

    /// A shot's note travels with its upload; an earlier photo's description
    /// is saved the same way the photo viewer and the web admin save it.
    private func saveNote(_ entry: CameraDrawerEntry, _ text: String) {
        switch entry {
        case .capture(let upload):
            session.uploads?.setNote(upload.localId, text)
        case .uploaded(let item):
            guard let jobMedia else { return }
            Task { _ = await jobMedia.saveEdits(to: item, description: text, annotations: nil) }
        }
    }

    private func openViewer(_ item: PendingUpload) {
        guard let uploads = session.uploads else { return }
        viewing = CameraViewerItem(upload: item, fileURL: uploads.fileURL(for: item))
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
