import AVFoundation
import Observation
import SwiftUI

/// State and actions of the camera screen, on top of `CameraSessionEngine`.
@MainActor
@Observable
final class CameraModel {
    static let maxVideoSeconds = 600

    private(set) var permission: CameraPermission = .camera
    private(set) var mode: CameraMode = .photo
    private(set) var facing: CameraFacing = CameraPreferences.facing
    private(set) var flashOn = CameraPreferences.flashOn
    private(set) var zoom = CameraZoom()
    private(set) var device: AVCaptureDevice?
    private(set) var hasDevice = true
    private(set) var isRunning = false
    /// The first live frame has arrived since the last (re)start.
    private(set) var previewReady = false
    private(set) var previewFailed = false
    /// The last frame, shown blurred while the camera restarts.
    private(set) var frozenFrame: UIImage?
    private(set) var isRecording = false
    /// A stopped recording is still being written.
    private(set) var isFinalizing = false
    private(set) var recordingStartedAt: Date?
    private(set) var isCapturingPhoto = false
    private(set) var notice: CameraNotice?

    /// A photo was taken.
    @ObservationIgnored var onPhoto: (@MainActor (CameraPhotoResult) -> Void)?
    /// A video finished: its file, wall-clock duration (ms) and start time.
    @ObservationIgnored var onVideo: (@MainActor (URL, Int, Date) -> Void)?
    /// Capture rotation (degrees) for the current device orientation.
    @ObservationIgnored var captureRotationAngle: @MainActor () -> CGFloat = { 90 }

    @ObservationIgnored let engine = CameraSessionEngine()
    @ObservationIgnored private var active = false
    @ObservationIgnored private var askedPermission = false
    @ObservationIgnored private var watchdog: Task<Void, Never>?
    @ObservationIgnored private var restartedOnce = false
    @ObservationIgnored private var noticeTimer: Task<Void, Never>?
    @ObservationIgnored private var recordingLimit: Task<Void, Never>?
    @ObservationIgnored private var recordingStarting = false
    @ObservationIgnored private var stopRequested = false
    @ObservationIgnored private var finishWaiters: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private var pinchStartZoom: CGFloat = 1
    @ObservationIgnored private var audioAttached = false
    @ObservationIgnored private var dictating = false

    init() {
        engine.onEvent = { [weak self] event in
            MainActor.assumeIsolated { self?.handle(event) }
        }
    }

    // MARK: Lifecycle

    /// The camera is visible and the app is active.
    func activate() {
        active = true
        permission = .camera
        switch permission {
        case .granted:
            startSession()
        case .notDetermined:
            // Ask once per opening; the system prompt comes first.
            guard !askedPermission else { return }
            askedPermission = true
            Task {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                permission = granted ? .granted : .denied
                if granted, active { startSession() }
            }
        case .denied:
            break
        }
    }

    /// Hidden or backgrounded: the session stops.
    func deactivate() {
        active = false
        watchdog?.cancel()
        if isRecording { stopRecording() }
        freezeLastFrame()
        engine.setTorch(false)
        engine.stop()
        previewReady = false
        isRunning = false
    }

    func requestPermission() {
        askedPermission = false
        activate()
    }

    func retryPreview() {
        restartedOnce = false
        previewFailed = false
        notice = nil
        previewReady = false
        engine.restart()
    }

    private func startSession() {
        let available = CameraSessionEngine.device(for: facing) ?? CameraSessionEngine.device(for: facing == .back ? .front : .back)
        hasDevice = available != nil
        guard hasDevice else { return }
        engine.configure(facing: facing)
        if mode == .video, CameraPermission.microphoneGranted, !dictating { attachAudio() }
        engine.start()
    }

    private func freezeLastFrame() {
        frozenFrame = engine.latestSnapshot ?? frozenFrame
    }

    // MARK: Events

    private func handle(_ event: CameraEvent) {
        switch event {
        case let .configured(info, device):
            zoom.info = info
            self.device = device
            updateTorch()
        case .configurationFailed(let message):
            hasDevice = false
            show(message: "The camera could not start.", details: message)
        case .running(let running):
            isRunning = running
            if running {
                startWatchdog()
            } else {
                previewReady = false
                watchdog?.cancel()
            }
        case .firstFrame:
            previewReady = true
            previewFailed = false
            watchdog?.cancel()
            notice = nil
        case .zoomChanged(let raw):
            zoom.raw = raw
        case .interrupted(let reason):
            handleInterruption(reason)
        case .interruptionEnded:
            notice = nil
        case .runtimeError(let message):
            if let notice = CameraNotice.forNativeError(message) { show(notice) }
        }
    }

    /// If no frame arrives within 3 s, restart once, then give up with a Retry button.
    private func startWatchdog() {
        watchdog?.cancel()
        guard !previewReady else { return }
        watchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self, !Task.isCancelled, !self.previewReady, self.active else { return }
            if self.restartedOnce {
                self.previewFailed = true
                self.show(message: "The camera preview did not start.")
            } else {
                self.restartedOnce = true
                self.show(message: "Restarting camera preview…")
                self.engine.restart()
            }
        }
    }

    private func handleInterruption(_ reason: String?) {
        let details = "iPhone camera interruption: \(reason ?? "")"
        switch reason {
        case "audio-device-in-use-by-another-client":
            // A phone call owns the microphone: fall back to photos.
            show(message: CameraNotice.phoneCallUsesMicrophone, details: details)
            engine.setAudio(false)
            audioAttached = false
            if mode == .video, !isRecording {
                mode = .photo
                updateTorch()
            }
        case "video-device-in-use-by-another-client", "video-device-not-available-with-multiple-foreground-apps":
            show(message: CameraNotice.cameraInUse, details: details)
        case "video-device-not-available-in-background":
            break
        default:
            show(message: "The camera was temporarily interrupted by your iPhone.", details: reason == nil ? nil : details)
        }
    }

    // MARK: Notices

    func show(message: String, details: String? = nil) {
        let detail = details?.trimmingCharacters(in: .whitespacesAndNewlines)
        show(CameraNotice(message: message, details: detail == message || detail?.isEmpty == true ? nil : detail))
    }

    private func show(_ newNotice: CameraNotice) {
        notice = newNotice
        noticeTimer?.cancel()
        // Clears itself after 6 s once the preview is running.
        noticeTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, !Task.isCancelled, self.previewReady else { return }
            self.notice = nil
        }
    }

    func dismissNotice() { notice = nil }

    // MARK: Controls

    var canUseFlash: Bool {
        guard let info = zoom.info else { return false }
        return mode == .video ? info.hasTorch : info.hasFlash
    }

    var canFlip: Bool { zoom.info?.canFlip ?? CameraSessionEngine.canFlip }

    var canShoot: Bool {
        permission == .granted && isRunning && previewReady && !isFinalizing && !isCapturingPhoto
    }

    func toggleFlash() {
        guard !isRecording, canUseFlash else { return }
        flashOn.toggle()
        CameraPreferences.flashOn = flashOn
        updateTorch()
    }

    func flip() {
        guard !isRecording, canFlip else { return }
        facing = facing == .back ? .front : .back
        CameraPreferences.facing = facing
        freezeLastFrame()
        previewReady = false
        restartedOnce = false
        previewFailed = false
        engine.configure(facing: facing)
        startWatchdog()
    }

    /// Switches between photo and video instantly: the running session is
    /// left alone; only the microphone is attached the first time.
    func select(_ newMode: CameraMode) {
        guard newMode != mode, !isRecording, !isFinalizing else { return }
        mode = newMode
        notice = nil
        updateTorch()
        guard newMode == .video, !dictating else { return }
        if CameraPermission.microphoneGranted {
            attachAudio()
        } else if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            Task {
                if await AVCaptureDevice.requestAccess(for: .audio), mode == .video, !dictating { attachAudio() }
            }
        }
    }

    private func attachAudio() {
        guard !audioAttached else { return }
        audioAttached = true
        engine.setAudio(true)
    }

    /// Dictating a note needs the microphone, so the camera lets go of it.
    func beginDictation() {
        dictating = true
        guard audioAttached else { return }
        audioAttached = false
        engine.setAudio(false)
    }

    func endDictation() {
        dictating = false
        if mode == .video, CameraPermission.microphoneGranted { attachAudio() }
    }

    /// In video mode the flash button is a torch that stays on.
    private func updateTorch() {
        engine.setTorch(mode == .video && flashOn && (zoom.info?.hasTorch ?? false) && active)
    }

    // MARK: Zoom and focus

    func zoom(to step: CGFloat) {
        engine.setZoom(raw: zoom.raw(for: step), animated: true)
    }

    func pinchBegan() { pinchStartZoom = zoom.raw }

    func pinchChanged(_ scale: CGFloat) {
        engine.setZoom(raw: pinchStartZoom * scale)
    }

    func focus(at devicePoint: CGPoint) { engine.focus(at: devicePoint) }

    // MARK: Capture

    func shutter() {
        switch mode {
        case .photo: takePhoto()
        case .video: isRecording ? stopRecording() : startRecording()
        }
    }

    private func takePhoto() {
        guard canShoot, !isRecording else { return }
        notice = nil
        isCapturingPhoto = true
        let flash = flashOn && (zoom.info?.hasFlash ?? false)
        engine.capturePhoto(flash: flash, rotationAngle: captureRotationAngle()) { [weak self] result in
            guard let self else { return }
            self.isCapturingPhoto = false
            switch result {
            case .success(let photo): self.onPhoto?(photo)
            case .failure(let failure): self.show(message: failure.message, details: failure.details)
            }
        }
    }

    private func startRecording() {
        guard canShoot, !isRecording, !recordingStarting else { return }
        Task {
            // Records without sound when the microphone isn't allowed.
            if !CameraPermission.microphoneGranted, await CameraPermission.ensureMicrophone(), !dictating { attachAudio() }
            notice = nil
            // The UI flips immediately so a second tap is a stop.
            isRecording = true
            recordingStarting = true
            stopRequested = false
            let startedAt = Date()
            recordingStartedAt = startedAt
            scheduleRecordingLimit()
            engine.startRecording(rotationAngle: captureRotationAngle()) { [weak self] result in
                self?.recordingDidStart(result, startedAt: startedAt)
            }
        }
    }

    private func recordingDidStart(_ result: Result<Void, CameraFailure>, startedAt: Date) {
        recordingStarting = false
        switch result {
        case .success:
            // Stop was tapped while the recorder was still starting.
            if stopRequested {
                stopRequested = false
                finishRecording(startedAt: startedAt)
            }
        case .failure(let failure):
            isRecording = false
            isFinalizing = false
            recordingLimit?.cancel()
            resumeFinishWaiters()
            show(message: failure.message, details: failure.details)
        }
    }

    private func scheduleRecordingLimit() {
        recordingLimit?.cancel()
        recordingLimit = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.maxVideoSeconds) * 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.stopRecording()
        }
    }

    func stopRecording() {
        guard isRecording, let startedAt = recordingStartedAt else { return }
        isRecording = false
        isFinalizing = true
        recordingLimit?.cancel()
        if recordingStarting {
            stopRequested = true
        } else {
            finishRecording(startedAt: startedAt)
        }
    }

    private func finishRecording(startedAt: Date) {
        engine.stopRecording { [weak self] result in
            guard let self else { return }
            let durationMs = Int(Date().timeIntervalSince(startedAt) * 1000)
            self.isFinalizing = false
            self.recordingStartedAt = nil
            switch result {
            case .success(let url): self.onVideo?(url, durationMs, startedAt)
            case .failure(let failure): self.show(message: failure.message, details: failure.details)
            }
            self.resumeFinishWaiters()
        }
    }

    /// Stops a recording in progress and waits until its file is saved, so
    /// closing the camera never loses a video.
    func finishPendingCapture() async {
        if isRecording { stopRecording() }
        guard isFinalizing || isRecording else { return }
        await withCheckedContinuation { continuation in finishWaiters.append(continuation) }
    }

    private func resumeFinishWaiters() {
        let waiters = finishWaiters
        finishWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }
}
