import AVFoundation
import UIKit

/// Owns the `AVCaptureSession`.
///
/// Threading: session work runs on `sessionQueue`; sample buffers (first-frame
/// detection, snapshots, recording) on `dataQueue`; events are delivered on
/// the main queue. The session keeps one preset for photo and video, so
/// switching modes never reconfigures or restarts it.
final class CameraSessionEngine: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate,
    AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    /// Set from the main thread; called on the main thread.
    var onEvent: ((CameraEvent) -> Void)?

    private let sessionQueue = DispatchQueue(label: "com.serviceflow.camera.session")
    private let dataQueue = DispatchQueue(label: "com.serviceflow.camera.data")
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let audioOutput = AVCaptureAudioDataOutput()
    private let snapshot = CameraFrameSnapshot()

    // Session-queue state.
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var device: AVCaptureDevice?
    private var rawPerDisplay: CGFloat = 1
    private var zoomObservation: NSKeyValueObservation?
    private var photoDelegates: [Int64: CameraPhotoDelegate] = [:]
    private var outputsAdded = false

    // Data-queue state.
    private var sawFirstFrame = false
    private var recorder: CameraMovieRecorder?

    private var observers: [NSObjectProtocol] = []

    override init() {
        super.init()
        observeSessionNotifications()
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        let session = session
        sessionQueue.async { if session.isRunning { session.stopRunning() } }
    }

    /// The latest frame, for the blurred placeholder while restarting.
    var latestSnapshot: UIImage? { snapshot.latest }

    private func emit(_ event: CameraEvent) {
        DispatchQueue.main.async { [weak self] in self?.onEvent?(event) }
    }

    private func observeSessionNotifications() {
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
                let reason = raw.flatMap(AVCaptureSession.InterruptionReason.init(rawValue:))
                self?.onEvent?(.interrupted(reason.map(Self.code)))
            },
            center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: .main) { [weak self] _ in
                self?.onEvent?(.interruptionEnded)
            },
            center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: .main) { [weak self] note in
                let error = note.userInfo?[AVCaptureSessionErrorKey] as? Error
                self?.onEvent?(.runtimeError(error?.localizedDescription ?? "Camera error"))
            },
        ]
    }

    static func code(_ reason: AVCaptureSession.InterruptionReason) -> String {
        switch reason {
        case .audioDeviceInUseByAnotherClient: return "audio-device-in-use-by-another-client"
        case .videoDeviceInUseByAnotherClient: return "video-device-in-use-by-another-client"
        case .videoDeviceNotAvailableWithMultipleForegroundApps: return "video-device-not-available-with-multiple-foreground-apps"
        case .videoDeviceNotAvailableInBackground: return "video-device-not-available-in-background"
        case .videoDeviceNotAvailableDueToSystemPressure: return "video-device-not-available-due-to-system-pressure"
        default: return "interruption-\(reason.rawValue)"
        }
    }

    // MARK: Devices

    /// The best camera for a side: the multi-lens back camera where there is one.
    static func device(for facing: CameraFacing) -> AVCaptureDevice? {
        switch facing {
        case .back:
            let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
            return types.lazy.compactMap { AVCaptureDevice.default($0, for: .video, position: .back) }.first
        case .front:
            return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
        }
    }

    static var canFlip: Bool { device(for: .back) != nil && device(for: .front) != nil }

    private static func rawPerDisplay(for device: AVCaptureDevice) -> CGFloat {
        guard device.deviceType == .builtInTripleCamera || device.deviceType == .builtInDualWideCamera else { return 1 }
        return device.virtualDeviceSwitchOverVideoZoomFactors.first.map { CGFloat(truncating: $0) } ?? 2
    }

    // MARK: Configuration

    /// Selects the lens, and adds the photo and video outputs once.
    func configure(facing: CameraFacing) {
        sessionQueue.async { [self] in
            session.beginConfiguration()
            if session.sessionPreset != .photo, session.canSetSessionPreset(.photo) { session.sessionPreset = .photo }
            let deviceChanged = selectDevice(facing)
            addOutputsOnce()
            session.commitConfiguration()

            guard let device else {
                emit(.configurationFailed("No camera is available on this device."))
                return
            }
            // A photo size may only be set once the output is connected, and
            // only to a size the active format lists.
            if photoOutput.connection(with: .video) != nil,
               let dimensions = CameraPhotoSettings.bestDimensions(for: device.activeFormat) {
                photoOutput.maxPhotoDimensions = dimensions
            }
            if deviceChanged { prepare(device) }
            emit(.configured(info(for: device), device))
        }
    }

    /// Swaps the video input when the lens side changes. Returns true if it did.
    private func selectDevice(_ facing: CameraFacing) -> Bool {
        let position: AVCaptureDevice.Position = facing == .back ? .back : .front
        guard device?.position != position || videoInput == nil,
              let newDevice = Self.device(for: facing),
              let input = try? AVCaptureDeviceInput(device: newDevice) else { return false }
        if let videoInput { session.removeInput(videoInput) }
        guard session.canAddInput(input) else {
            // Keep the previous lens rather than ending up with none.
            if let videoInput, session.canAddInput(videoInput) { session.addInput(videoInput) }
            return false
        }
        session.addInput(input)
        videoInput = input
        device = newDevice
        return true
    }

    private func addOutputsOnce() {
        guard !outputsAdded else { return }
        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
        photoOutput.maxPhotoQualityPrioritization = .balanced
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: dataQueue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        audioOutput.setSampleBufferDelegate(self, queue: dataQueue)
        outputsAdded = true
    }

    /// Focus, exposure and 1× zoom for a newly selected lens.
    private func prepare(_ device: AVCaptureDevice) {
        rawPerDisplay = Self.rawPerDisplay(for: device)
        withLock(device) {
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
            // Open at 1×, not at the ultra-wide.
            device.videoZoomFactor = min(max(rawPerDisplay, device.minAvailableVideoZoomFactor), device.maxAvailableVideoZoomFactor)
        }
        zoomObservation = device.observe(\.videoZoomFactor, options: [.initial, .new]) { [weak self] device, _ in
            self?.emit(.zoomChanged(device.videoZoomFactor))
        }
        dataQueue.async { self.sawFirstFrame = false }
    }

    private func info(for device: AVCaptureDevice) -> CameraDeviceInfo {
        CameraDeviceInfo(
            hasFlash: device.hasFlash && photoOutput.supportedFlashModes.contains(.on),
            hasTorch: device.hasTorch && device.isTorchModeSupported(.on),
            minZoom: device.minAvailableVideoZoomFactor,
            maxZoom: min(device.maxAvailableVideoZoomFactor, rawPerDisplay * 10),
            rawPerDisplay: rawPerDisplay,
            canFlip: Self.canFlip
        )
    }

    /// Attaches or detaches the microphone. It's added the first time video
    /// is used and then kept, so later mode switches don't touch the session.
    /// Detached for dictation, and when a phone call needs the microphone.
    func setAudio(_ enabled: Bool) {
        sessionQueue.async { [self] in
            if enabled {
                guard audioInput == nil, let mic = AVCaptureDevice.default(for: .audio),
                      let input = try? AVCaptureDeviceInput(device: mic) else { return }
                session.beginConfiguration()
                if session.canAddInput(input) {
                    session.addInput(input)
                    audioInput = input
                }
                if !session.outputs.contains(audioOutput), session.canAddOutput(audioOutput) { session.addOutput(audioOutput) }
                session.commitConfiguration()
            } else {
                guard audioInput != nil || session.outputs.contains(audioOutput) else { return }
                session.beginConfiguration()
                if let audioInput { session.removeInput(audioInput) }
                audioInput = nil
                if session.outputs.contains(audioOutput) { session.removeOutput(audioOutput) }
                session.commitConfiguration()
            }
        }
    }

    // MARK: Running

    func start() {
        sessionQueue.async { [self] in
            if !session.isRunning {
                dataQueue.sync { sawFirstFrame = false }
                session.startRunning()
            }
            emit(.running(session.isRunning))
        }
    }

    func stop() {
        sessionQueue.async { [self] in
            if session.isRunning { session.stopRunning() }
            emit(.running(false))
        }
    }

    /// Stops and starts again (the preview watchdog's retry).
    func restart() {
        sessionQueue.async { [self] in
            if session.isRunning { session.stopRunning() }
            dataQueue.sync { sawFirstFrame = false }
            session.startRunning()
            emit(.running(session.isRunning))
        }
    }

    // MARK: Controls

    func setZoom(raw: CGFloat, animated: Bool = false) {
        sessionQueue.async { [self] in
            guard let device else { return }
            let upper = min(device.maxAvailableVideoZoomFactor, rawPerDisplay * 10)
            let clamped = min(max(raw, device.minAvailableVideoZoomFactor), upper)
            withLock(device) {
                if animated {
                    device.ramp(toVideoZoomFactor: clamped, withRate: 12)
                } else {
                    device.videoZoomFactor = clamped
                }
            }
        }
    }

    /// Focus and expose at a point in device coordinates (0…1).
    func focus(at point: CGPoint) {
        sessionQueue.async { [self] in
            guard let device else { return }
            withLock(device) {
                if device.isFocusPointOfInterestSupported, device.isFocusModeSupported(.autoFocus) {
                    device.focusPointOfInterest = point
                    device.focusMode = .autoFocus
                }
                if device.isExposurePointOfInterestSupported, device.isExposureModeSupported(.continuousAutoExposure) {
                    device.exposurePointOfInterest = point
                    device.exposureMode = .continuousAutoExposure
                }
                device.isSubjectAreaChangeMonitoringEnabled = true
            }
        }
    }

    func setTorch(_ on: Bool) {
        sessionQueue.async { [self] in
            guard let device, device.hasTorch else { return }
            let mode: AVCaptureDevice.TorchMode = on ? .on : .off
            guard device.torchMode != mode, device.isTorchModeSupported(mode) else { return }
            withLock(device) { device.torchMode = mode }
        }
    }

    private func withLock(_ device: AVCaptureDevice, _ change: () -> Void) {
        guard (try? device.lockForConfiguration()) != nil else { return }
        change()
        device.unlockForConfiguration()
    }

    // MARK: Photo

    /// Completion runs on the main queue.
    func capturePhoto(flash: Bool, rotationAngle: CGFloat, completion: @escaping (Result<CameraPhotoResult, CameraFailure>) -> Void) {
        sessionQueue.async { [self] in
            let settings = CameraPhotoSettings.make(for: photoOutput, flash: flash)
            if let connection = photoOutput.connection(with: .video), connection.isVideoRotationAngleSupported(rotationAngle) {
                connection.videoRotationAngle = rotationAngle
            }
            let id = settings.uniqueID
            let delegate = CameraPhotoDelegate { [weak self] result in
                self?.sessionQueue.async { self?.photoDelegates[id] = nil }
                DispatchQueue.main.async { completion(result) }
            }
            // The output doesn't retain its delegate; this does until it finishes.
            photoDelegates[id] = delegate
            photoOutput.capturePhoto(with: settings, delegate: delegate)
        }
    }

    // MARK: Video

    /// Starts writing an MP4. Completion runs on the main queue.
    func startRecording(rotationAngle: CGFloat, completion: @escaping (Result<Void, CameraFailure>) -> Void) {
        sessionQueue.async { [self] in
            var source = CGSize(width: 1920, height: 1440)
            if let format = device?.activeFormat.formatDescription {
                let dims = CMVideoFormatDescriptionGetDimensions(format)
                if dims.width > 0, dims.height > 0 { source = CGSize(width: Int(dims.width), height: Int(dims.height)) }
            }
            let hasAudio = audioInput != nil && session.outputs.contains(audioOutput)
            let audioSettings = hasAudio
                ? (audioOutput.recommendedAudioSettingsForAssetWriter(writingTo: .mp4) ?? CameraMovieRecorder.fallbackAudioSettings)
                : nil
            do {
                let recorder = try CameraMovieRecorder(sourceSize: source, audioSettings: audioSettings, rotationAngle: rotationAngle)
                dataQueue.async { self.recorder = recorder }
                DispatchQueue.main.async { completion(.success(())) }
            } catch {
                let failure = error as? CameraFailure ?? .video(error.localizedDescription)
                DispatchQueue.main.async { completion(.failure(failure)) }
            }
        }
    }

    /// Finishes the file. Completion runs on the main queue.
    func stopRecording(completion: @escaping (Result<URL, CameraFailure>) -> Void) {
        dataQueue.async { [self] in
            guard let recorder else {
                DispatchQueue.main.async { completion(.failure(.video("Recording was not running."))) }
                return
            }
            self.recorder = nil
            recorder.finish { result in DispatchQueue.main.async { completion(result) } }
        }
    }

    // MARK: Sample buffers (data queue)

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let isVideo = output === videoOutput
        if isVideo {
            if !sawFirstFrame {
                sawFirstFrame = true
                emit(.firstFrame)
            }
            snapshot.offer(sampleBuffer, mirrored: connection.isVideoMirrored)
        }
        recorder?.append(sampleBuffer, isVideo: isVideo)
    }
}
