import AVFoundation
import Observation
import SwiftUI

/// A message in the camera's red notice banner.
struct CameraNotice: Equatable, Identifiable {
    let id = UUID()
    var message: String
    var details: String?

    static func == (lhs: CameraNotice, rhs: CameraNotice) -> Bool { lhs.id == rhs.id }
}

/// Lens and flash choices last the whole app run, like the RN camera that
/// stayed mounted with its host screen.
enum CameraPreferences {
    static var facing: CameraFacing = .back
    static var flashOn = false
}

/// State and behaviour of the camera screen, on top of `CameraSessionEngine`.
@MainActor
@Observable
final class CameraModel {
    enum Permission { case notDetermined, granted, denied }

    static let zoomSteps: [CGFloat] = [0.5, 1, 2]
    static let maxVideoSeconds = 600

    private(set) var permission: Permission = CameraModel.currentPermission()
    private(set) var mode: CameraMode = .photo
    private(set) var facing: CameraFacing = CameraPreferences.facing
    private(set) var flashOn = CameraPreferences.flashOn
    private(set) var info: CameraDeviceInfo?
    private(set) var device: AVCaptureDevice?
    private(set) var hasDevice = true
    private(set) var isRunning = false
    private(set) var previewReady = false
    private(set) var previewFailed = false
    private(set) var rawZoom: CGFloat = 1
    private(set) var isRecording = false
    private(set) var isFinalizing = false
    private(set) var recordingStartedAt: Date?
    private(set) var isCapturingPhoto = false
    private(set) var notice: CameraNotice?

    /// A photo was taken: its file, pixel size and time.
    @ObservationIgnored var onPhoto: (@MainActor (CameraPhotoResult) -> Void)?
    /// A video finished: its file, wall-clock duration (ms) and start time.
    @ObservationIgnored var onVideo: (@MainActor (URL, Int, Date) -> Void)?
    /// Capture rotation (degrees) for the current device orientation.
    @ObservationIgnored var captureRotationAngle: @MainActor () -> CGFloat = { 90 }

    @ObservationIgnored let engine = CameraSessionEngine()
    @ObservationIgnored private var requestedPermission = false
    @ObservationIgnored private var active = false
    @ObservationIgnored private var watchdog: Task<Void, Never>?
    @ObservationIgnored private var retries = 0
    @ObservationIgnored private var noticeTimer: Task<Void, Never>?
    @ObservationIgnored private var recordingLimit: Task<Void, Never>?
    @ObservationIgnored private var recordingStarting = false
    @ObservationIgnored private var stopRequested = false
    @ObservationIgnored private var finishWaiters: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private var pinchStartZoom: CGFloat = 1
    @ObservationIgnored private var audioAttached = false
    private(set) var dictating = false

    init() {
        // Events arrive on the main queue.
        engine.onEvent = { @Sendable [weak self] event in
            MainActor.assumeIsolated { self?.handle(event) }
        }
    }

    static func currentPermission() -> Permission {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .granted
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    // MARK: Lifecycle

    /// The camera became visible (and the app is active).
    func activate() {
        active = true
        permission = Self.currentPermission()
        switch permission {
        case .granted:
            startSession()
        case .notDetermined:
            // Ask once per opening; the system prompt comes first.
            guard !requestedPermission else { return }
            requestedPermission = true
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
        engine.setTorch(false)
        engine.stop()
        previewReady = false
        isRunning = false
    }

    func requestPermission() {
        requestedPermission = false
        activate()
    }

    private func startSession() {
        guard Self.device(for: facing) != nil else {
            hasDevice = false
            return
        }
        hasDevice = true
        engine.configure(facing: facing)
        if mode == .video, Self.microphoneGranted, !dictating { attachAudio() }
        engine.start()
    }

    private static func device(for facing: CameraFacing) -> AVCaptureDevice? {
        CameraSessionEngine.device(for: facing) ?? CameraSessionEngine.device(for: facing == .back ? .front : .back)
    }

    func retryPreview() {
        retries = 0
        previewFailed = false
        notice = nil
        previewReady = false
        engine.restart()
    }

    // MARK: Events

    private func handle(_ event: CameraEvent) {
        switch event {
        case .configured(let info, let device):
            self.info = info
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
            rawZoom = raw
        case .interrupted(let reason):
            handleInterruption(reason)
        case .interruptionEnded:
            notice = nil
        case .runtimeError(let message):
            showNativeError(message)
        }
    }

    private func startWatchdog() {
        watchdog?.cancel()
        guard !previewReady else { return }
        watchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self, !Task.isCancelled, !self.previewReady, self.active else { return }
            if self.retries == 0 {
                self.retries = 1
                self.show(message: "Restarting camera preview…")
                self.engine.restart()
            } else {
                self.previewFailed = true
                self.show(message: "The camera preview did not start.")
            }
        }
    }

    private func handleInterruption(_ reason: String?) {
        let details = "iPhone camera interruption: \(reason ?? "")"
        switch reason {
        case "audio-device-in-use-by-another-client":
            show(message: "Your phone call is using the microphone. Photo mode is still available.", details: details)
            engine.setAudio(false)
            audioAttached = false
            if mode == .video, !isRecording {
                mode = .photo
                updateTorch()
            }
        case "video-device-in-use-by-another-client", "video-device-not-available-with-multiple-foreground-apps":
            show(message: "Your iPhone is using the camera in another app or call.", details: details)
        case "video-device-not-available-in-background":
            break
        default:
            show(message: "The camera was temporarily interrupted by your iPhone.", details: reason == nil ? nil : details)
        }
    }

    private func showNativeError(_ message: String) {
        if message.range(of: "cancel", options: .caseInsensitive) != nil { return }
        if message.range(of: "audio-device-in-use-by-another-client|audio.*(busy|in use|another client)",
                         options: [.regularExpression, .caseInsensitive]) != nil {
            show(message: "Your phone call is using the microphone. Photo mode is still available.", details: message)
        } else if message.range(of: "video-device-in-use-by-another-client|camera.*(busy|in use|another client)",
                                options: [.regularExpression, .caseInsensitive]) != nil {
            show(message: "Your iPhone is using the camera in another app or call.", details: message)
        } else {
            show(message: "The camera could not start.", details: message)
        }
    }

    func show(message: String, details: String? = nil) {
        let detail = details?.trimmingCharacters(in: .whitespacesAndNewlines)
        notice = CameraNotice(message: message, details: detail == message || detail?.isEmpty == true ? nil : detail)
        noticeTimer?.cancel()
        noticeTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, !Task.isCancelled, self.previewReady else { return }
            self.notice = nil
        }
    }

    func dismissNotice() { notice = nil }

    // MARK: Controls

    var canUseFlash: Bool {
        guard let info else { return false }
        return mode == .video ? info.hasTorch : info.hasFlash
    }

    var canFlip: Bool { info?.canFlip ?? CameraSessionEngine.canFlip }

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
        previewReady = false
        retries = 0
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
        guard newMode == .video else { return }
        if Self.microphoneGranted {
            if !dictating { attachAudio() }
        } else if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            Task {
                if await AVCaptureDevice.requestAccess(for: .audio), self.mode == .video, !self.dictating { self.attachAudio() }
            }
        }
    }

    private func attachAudio() {
        guard !audioAttached else { return }
        audioAttached = true
        engine.setAudio(true)
    }

    /// Dictating a note needs the microphone; the camera lets go of it.
    func beginDictation() {
        dictating = true
        if audioAttached {
            audioAttached = false
            engine.setAudio(false)
        }
    }

    func endDictation() {
        dictating = false
        if mode == .video, Self.microphoneGranted { attachAudio() }
    }

    private func updateTorch() {
        engine.setTorch(mode == .video && flashOn && (info?.hasTorch ?? false) && active)
    }

    // MARK: Zoom and focus

    var rawPerDisplay: CGFloat { info?.rawPerDisplay ?? 1 }
    var displayZoom: CGFloat { rawZoom / max(rawPerDisplay, 0.01) }

    /// Zoom steps this lens can reach; 1× is always offered.
    var availableSteps: [CGFloat] {
        guard let info else { return [1] }
        return Self.zoomSteps.filter { step in
            step == 1 || (step * info.rawPerDisplay >= info.minZoom - 0.001 && step * info.rawPerDisplay <= info.maxZoom + 0.001)
        }
    }

    var activeStep: CGFloat {
        availableSteps.min { abs($0 - displayZoom) < abs($1 - displayZoom) } ?? 1
    }

    func label(for step: CGFloat) -> String {
        if step == activeStep, abs(step - displayZoom) > 0.05 {
            let value = String(format: "%.1f", displayZoom)
            return (value.hasPrefix("0") ? String(value.dropFirst()) : value) + "x"
        }
        return step == 0.5 ? ".5x" : "\(Int(step))x"
    }

    func zoom(to step: CGFloat) {
        engine.setZoom(raw: step * rawPerDisplay, animated: true)
    }

    func pinchBegan() { pinchStartZoom = rawZoom }

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
        engine.capturePhoto(flash: flashOn && (info?.hasFlash ?? false), rotationAngle: captureRotationAngle()) { [weak self] result in
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
            if !Self.microphoneGranted {
                // Records without sound when the microphone isn't allowed.
                if await Self.ensureMicrophone(), !dictating { attachAudio() }
            }
            notice = nil
            // The UI flips immediately so a second tap is a stop.
            isRecording = true
            recordingStarting = true
            stopRequested = false
            let startedAt = Date()
            recordingStartedAt = startedAt
            recordingLimit?.cancel()
            recordingLimit = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(Self.maxVideoSeconds) * 1_000_000_000)
                guard !Task.isCancelled else { return }
                self?.stopRecording()
            }
            engine.startRecording(rotationAngle: captureRotationAngle()) { [weak self] result in
                guard let self else { return }
                self.recordingStarting = false
                switch result {
                case .success:
                    if self.stopRequested {
                        self.stopRequested = false
                        self.finishRecording(startedAt: startedAt)
                    }
                case .failure(let failure):
                    self.isRecording = false
                    self.isFinalizing = false
                    self.recordingLimit?.cancel()
                    self.resumeWaiters()
                    self.show(message: failure.message, details: failure.details)
                }
            }
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
            self.resumeWaiters()
        }
    }

    /// Stops a recording in progress and waits until its file is saved, so
    /// closing the camera never loses a video.
    func finishPendingCapture() async {
        if isRecording { stopRecording() }
        guard isFinalizing || isRecording else { return }
        await withCheckedContinuation { continuation in finishWaiters.append(continuation) }
    }

    private func resumeWaiters() {
        let waiters = finishWaiters
        finishWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    // MARK: Microphone

    static var microphoneGranted: Bool { AVCaptureDevice.authorizationStatus(for: .audio) == .authorized }

    static func ensureMicrophone() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }
}
