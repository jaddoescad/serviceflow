import AVFoundation
import CoreImage
import UIKit

enum CameraFacing: Equatable { case back, front }
enum CameraMode: Equatable { case photo, video }

/// What the active camera can do.
struct CameraDeviceInfo: Equatable {
    var hasFlash: Bool
    var hasTorch: Bool
    var minZoom: CGFloat
    var maxZoom: CGFloat
    /// Raw zoom factor of the 1× (wide) lens. On triple and dual-wide
    /// cameras raw 1.0 is the ultra-wide, shown as 0.5×.
    var rawPerDisplay: CGFloat
    var canFlip: Bool
}

enum CameraEvent {
    case configured(CameraDeviceInfo, AVCaptureDevice)
    case configurationFailed(String)
    case running(Bool)
    case firstFrame
    case zoomChanged(CGFloat)
    /// A session interruption, with the reason as a stable code.
    case interrupted(String?)
    case interruptionEnded
    case runtimeError(String)
}

struct CameraFailure: Error {
    var message: String
    var details: String?
}

struct CameraPhotoResult {
    var url: URL
    var width: Int?
    var height: Int?
    var capturedAt: Date
}

/// Owns the `AVCaptureSession`. All session work runs on a private serial
/// queue; sample buffers (first-frame detection and recording) on another.
/// Events are delivered on the main queue.
final class CameraSessionEngine: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate,
    AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    var onEvent: ((CameraEvent) -> Void)?

    private let sessionQueue = DispatchQueue(label: "com.serviceflow.camera.session")
    private let dataQueue = DispatchQueue(label: "com.serviceflow.camera.data")
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let audioOutput = AVCaptureAudioDataOutput()

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
    // A small, recent frame kept for the blurred placeholder shown while the
    // camera restarts (returning to the app, flipping lenses).
    private let snapshotContext = CIContext(options: [.cacheIntermediates: false])
    private let snapshotLock = NSLock()
    private var snapshotImage: CGImage?
    private var snapshotFront = false
    private var frameCount = 0
    private var recorder: CameraMovieRecorder?

    private var observers: [NSObjectProtocol] = []

    override init() {
        super.init()
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
            let reason = raw.flatMap(AVCaptureSession.InterruptionReason.init(rawValue:))
            self?.onEvent?(.interrupted(reason.map(Self.code)))
        })
        observers.append(center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: .main) { [weak self] _ in
            self?.onEvent?(.interruptionEnded)
        })
        observers.append(center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: .main) { [weak self] note in
            let error = note.userInfo?[AVCaptureSessionErrorKey] as? Error
            self?.onEvent?(.runtimeError(error?.localizedDescription ?? "Camera error"))
        })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        let session = session
        sessionQueue.async { if session.isRunning { session.stopRunning() } }
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

    private func emit(_ event: CameraEvent) {
        DispatchQueue.main.async { [weak self] in self?.onEvent?(event) }
    }

    // MARK: Devices

    static func device(for facing: CameraFacing) -> AVCaptureDevice? {
        switch facing {
        case .back:
            let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
            for type in types {
                if let device = AVCaptureDevice.default(type, for: .video, position: .back) { return device }
            }
            return nil
        case .front:
            return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
        }
    }

    static var canFlip: Bool { device(for: .back) != nil && device(for: .front) != nil }

    static func rawPerDisplay(for device: AVCaptureDevice) -> CGFloat {
        guard device.deviceType == .builtInTripleCamera || device.deviceType == .builtInDualWideCamera else { return 1 }
        return device.virtualDeviceSwitchOverVideoZoomFactors.first.map { CGFloat(truncating: $0) } ?? 2
    }

    // MARK: Configuration

    /// Sets up the lens, and the photo and video outputs once. The session
    /// uses one preset for both photo and video, so switching modes never
    /// reconfigures or restarts it (that caused the flash and delay).
    func configure(facing: CameraFacing) {
        sessionQueue.async { [self] in
            session.beginConfiguration()
            if session.sessionPreset != .photo, session.canSetSessionPreset(.photo) { session.sessionPreset = .photo }

            var deviceChanged = false
            let position: AVCaptureDevice.Position = facing == .back ? .back : .front
            if device?.position != position || videoInput == nil {
                guard let newDevice = Self.device(for: facing), let input = try? AVCaptureDeviceInput(device: newDevice) else {
                    session.commitConfiguration()
                    emit(.configurationFailed("No camera is available on this device."))
                    return
                }
                if let videoInput { session.removeInput(videoInput) }
                if session.canAddInput(input) {
                    session.addInput(input)
                    videoInput = input
                    device = newDevice
                    deviceChanged = true
                } else if let videoInput, session.canAddInput(videoInput) {
                    session.addInput(videoInput)
                }
            }

            if !outputsAdded {
                if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
                photoOutput.maxPhotoQualityPrioritization = .balanced
                videoOutput.alwaysDiscardsLateVideoFrames = true
                videoOutput.setSampleBufferDelegate(self, queue: dataQueue)
                if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
                audioOutput.setSampleBufferDelegate(self, queue: dataQueue)
                outputsAdded = true
            }
            session.commitConfiguration()

            guard let device else { return }
            // Only a size the active format lists may be set, and it must
            // happen after the output is connected. Capped at about 12 MP so a
            // photo stays well under the 25 MB upload limit.
            if photoOutput.connection(with: .video) != nil {
                let supported = device.activeFormat.supportedMaxPhotoDimensions
                let capped = supported.filter { Int($0.width) * Int($0.height) <= 12_600_000 }
                if let best = (capped.isEmpty ? supported : capped).max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) {
                    photoOutput.maxPhotoDimensions = best
                }
            }
            if deviceChanged {
                rawPerDisplay = Self.rawPerDisplay(for: device)
                do {
                    try device.lockForConfiguration()
                    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
                    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
                    // Open at 1×, not at the ultra-wide.
                    device.videoZoomFactor = min(max(rawPerDisplay, device.minAvailableVideoZoomFactor), device.maxAvailableVideoZoomFactor)
                    device.unlockForConfiguration()
                } catch {}
                zoomObservation = device.observe(\.videoZoomFactor, options: [.initial, .new]) { [weak self] device, _ in
                    let zoom = device.videoZoomFactor
                    self?.emit(.zoomChanged(zoom))
                }
                dataQueue.async { self.sawFirstFrame = false }
            }
            let info = CameraDeviceInfo(
                hasFlash: device.hasFlash && photoOutput.supportedFlashModes.contains(.on),
                hasTorch: device.hasTorch && device.isTorchModeSupported(.on),
                minZoom: device.minAvailableVideoZoomFactor,
                maxZoom: min(device.maxAvailableVideoZoomFactor, rawPerDisplay * 10),
                rawPerDisplay: rawPerDisplay,
                canFlip: Self.canFlip
            )
            let configuredDevice = device
            DispatchQueue.main.async { [weak self] in self?.onEvent?(.configured(info, configuredDevice)) }
        }
    }

    /// Attaches or detaches the microphone. Added once when video is first
    /// used and then kept, so later mode switches don't touch the session.
    /// Detached for dictation and when a phone call needs the microphone.
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
                if let audioInput {
                    session.removeInput(audioInput)
                    self.audioInput = nil
                }
                if session.outputs.contains(audioOutput) { session.removeOutput(audioOutput) }
                session.commitConfiguration()
            }
        }
    }

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

    /// Stops and starts the session again (the preview watchdog's retry).
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
            do {
                try device.lockForConfiguration()
                if animated {
                    device.ramp(toVideoZoomFactor: clamped, withRate: 12)
                } else {
                    device.videoZoomFactor = clamped
                }
                device.unlockForConfiguration()
            } catch {}
        }
    }

    /// Focus and expose at a point in device coordinates (0…1).
    func focus(at point: CGPoint) {
        sessionQueue.async { [self] in
            guard let device else { return }
            do {
                try device.lockForConfiguration()
                if device.isFocusPointOfInterestSupported, device.isFocusModeSupported(.autoFocus) {
                    device.focusPointOfInterest = point
                    device.focusMode = .autoFocus
                }
                if device.isExposurePointOfInterestSupported, device.isExposureModeSupported(.continuousAutoExposure) {
                    device.exposurePointOfInterest = point
                    device.exposureMode = .continuousAutoExposure
                }
                device.isSubjectAreaChangeMonitoringEnabled = true
                device.unlockForConfiguration()
            } catch {}
        }
    }

    func setTorch(_ on: Bool) {
        sessionQueue.async { [self] in
            guard let device, device.hasTorch else { return }
            let mode: AVCaptureDevice.TorchMode = on ? .on : .off
            guard device.torchMode != mode, device.isTorchModeSupported(mode) else { return }
            do {
                try device.lockForConfiguration()
                device.torchMode = mode
                device.unlockForConfiguration()
            } catch {}
        }
    }

    // MARK: Photo

    /// A JPEG at quality 0.85. iPhones default to HEIC, which Android crew
    /// members can't always view, so JPEG is forced.
    func capturePhoto(flash: Bool, rotationAngle: CGFloat, completion: @escaping (Result<CameraPhotoResult, CameraFailure>) -> Void) {
        sessionQueue.async { [self] in
            let settings: AVCapturePhotoSettings
            if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
                settings = AVCapturePhotoSettings(format: [
                    AVVideoCodecKey: AVVideoCodecType.jpeg,
                    AVVideoCompressionPropertiesKey: [AVVideoQualityKey: 0.85],
                ])
            } else {
                settings = AVCapturePhotoSettings()
            }
            if flash, photoOutput.supportedFlashModes.contains(.on) { settings.flashMode = .on }
            settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
            settings.photoQualityPrioritization = .balanced
            if let connection = photoOutput.connection(with: .video), connection.isVideoRotationAngleSupported(rotationAngle) {
                connection.videoRotationAngle = rotationAngle
            }
            let id = settings.uniqueID
            let delegate = CameraPhotoDelegate { [weak self] result in
                self?.sessionQueue.async { self?.photoDelegates[id] = nil }
                DispatchQueue.main.async { completion(result) }
            }
            photoDelegates[id] = delegate
            photoOutput.capturePhoto(with: settings, delegate: delegate)
        }
    }

    // MARK: Video

    /// Starts writing an MP4 (H.264 + AAC). Frames keep their sensor
    /// orientation; the track transform carries the rotation.
    func startRecording(rotationAngle: CGFloat, completion: @escaping (Result<Void, CameraFailure>) -> Void) {
        sessionQueue.async { [self] in
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("project-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6)).mp4")
            // The photo preset delivers large frames; the writer scales them to
            // at most 1920 px on the long side (H.264 can't take full sensor size).
            var source = CGSize(width: 1920, height: 1440)
            if let format = device?.activeFormat.formatDescription {
                let dims = CMVideoFormatDescriptionGetDimensions(format)
                if dims.width > 0, dims.height > 0 { source = CGSize(width: Int(dims.width), height: Int(dims.height)) }
            }
            let scale = min(1, 1920 / max(source.width, source.height))
            let width = Int((source.width * scale / 2).rounded()) * 2
            let height = Int((source.height * scale / 2).rounded()) * 2
            let videoSettings: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 10_000_000,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                    AVVideoExpectedSourceFrameRateKey: 30,
                ],
            ]
            let hasAudio = audioInput != nil && session.outputs.contains(audioOutput)
            var audioSettings: [String: Any]?
            if hasAudio {
                audioSettings = audioOutput.recommendedAudioSettingsForAssetWriter(writingTo: .mp4) ?? [
                    AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 1, AVSampleRateKey: 44_100, AVEncoderBitRateKey: 96_000,
                ]
            }
            do {
                let recorder = try CameraMovieRecorder(url: url, videoSettings: videoSettings, audioSettings: audioSettings,
                                                       rotationAngle: rotationAngle)
                dataQueue.async { self.recorder = recorder }
                DispatchQueue.main.async { completion(.success(())) }
            } catch {
                DispatchQueue.main.async {
                    completion(.failure(CameraFailure(message: "The video could not be recorded.", details: error.localizedDescription)))
                }
            }
        }
    }

    func stopRecording(completion: @escaping (Result<URL, CameraFailure>) -> Void) {
        dataQueue.async { [self] in
            guard let recorder else {
                DispatchQueue.main.async {
                    completion(.failure(CameraFailure(message: "The video could not be recorded.", details: "Recording was not running.")))
                }
                return
            }
            self.recorder = nil
            recorder.finish { result in DispatchQueue.main.async { completion(result) } }
        }
    }

    /// Stops a recording and throws the file away.
    func discardRecording() {
        dataQueue.async { [self] in
            recorder?.cancel()
            recorder = nil
        }
    }

    // MARK: Sample buffers

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let isVideo = output === videoOutput
        if isVideo, !sawFirstFrame {
            sawFirstFrame = true
            emit(.firstFrame)
        }
        if isVideo {
            frameCount &+= 1
            if frameCount % 12 == 0 { keepSnapshot(sampleBuffer, front: connection.isVideoMirrored) }
        }
        recorder?.append(sampleBuffer, isVideo: isVideo)
    }
}

extension CameraSessionEngine {
    /// The latest kept frame, upright for a portrait screen.
    var latestSnapshot: UIImage? {
        snapshotLock.lock(); defer { snapshotLock.unlock() }
        guard let snapshotImage else { return nil }
        return UIImage(cgImage: snapshotImage, scale: 1, orientation: snapshotFront ? .leftMirrored : .right)
    }

    fileprivate func keepSnapshot(_ sampleBuffer: CMSampleBuffer, front: Bool) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let image = CIImage(cvPixelBuffer: buffer)
        let scale = 480 / max(image.extent.width, 1)
        let small = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cgImage = snapshotContext.createCGImage(small, from: small.extent) else { return }
        snapshotLock.lock()
        snapshotImage = cgImage
        snapshotFront = front
        snapshotLock.unlock()
    }
}

/// Receives one photo and writes it to a temporary JPEG.
final class CameraPhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let completion: (Result<CameraPhotoResult, CameraFailure>) -> Void
    private var finished = false

    init(completion: @escaping (Result<CameraPhotoResult, CameraFailure>) -> Void) {
        self.completion = completion
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error {
            finish(.failure(CameraFailure(message: "The photo could not be captured.", details: error.localizedDescription)))
            return
        }
        guard var data = photo.fileDataRepresentation() else {
            finish(.failure(CameraFailure(message: "The photo could not be captured.", details: "No image data.")))
            return
        }
        if !Self.isJPEG(data), let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) {
            data = jpeg
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("project-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6)).jpg")
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            finish(.failure(CameraFailure(message: "The photo could not be captured.", details: error.localizedDescription)))
            return
        }
        let size = CameraImageInfo.pixelSize(of: url)
        finish(.success(CameraPhotoResult(url: url, width: size?.width, height: size?.height, capturedAt: Date())))
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        if let error {
            finish(.failure(CameraFailure(message: "The photo could not be captured.", details: error.localizedDescription)))
        }
    }

    private func finish(_ result: Result<CameraPhotoResult, CameraFailure>) {
        guard !finished else { return }
        finished = true
        completion(result)
    }

    private static func isJPEG(_ data: Data) -> Bool {
        data.count > 3 && data[0] == 0xff && data[1] == 0xd8
    }
}

enum CameraImageInfo {
    /// Pixel size with the EXIF orientation applied.
    static func pixelSize(of url: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        return (5...8).contains(orientation) ? (height, width) : (width, height)
    }
}

/// Writes camera sample buffers to an MP4 with `AVAssetWriter`.
final class CameraMovieRecorder {
    let url: URL
    private let writer: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private let audioInput: AVAssetWriterInput?
    private var started = false
    private var done = false

    init(url: URL, videoSettings: [String: Any], audioSettings: [String: Any]?, rotationAngle: CGFloat) throws {
        self.url = url
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = true
        videoInput.transform = CGAffineTransform(rotationAngle: rotationAngle * .pi / 180)
        guard writer.canAdd(videoInput) else {
            throw CameraFailure(message: "The video could not be recorded.", details: "The video track could not be created.")
        }
        writer.add(videoInput)
        if let audioSettings {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
            input.expectsMediaDataInRealTime = true
            if writer.canAdd(input) {
                writer.add(input)
                audioInput = input
            } else {
                audioInput = nil
            }
        } else {
            audioInput = nil
        }
    }

    /// Called on the data queue.
    func append(_ buffer: CMSampleBuffer, isVideo: Bool) {
        guard !done else { return }
        if !started {
            guard isVideo else { return }
            guard writer.startWriting() else {
                done = true
                return
            }
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(buffer))
            started = true
        }
        guard writer.status == .writing else { return }
        if isVideo {
            if videoInput.isReadyForMoreMediaData { videoInput.append(buffer) }
        } else if let audioInput, audioInput.isReadyForMoreMediaData {
            audioInput.append(buffer)
        }
    }

    func finish(completion: @escaping (Result<URL, CameraFailure>) -> Void) {
        done = true
        guard started, writer.status == .writing else {
            let details = writer.error?.localizedDescription ?? "No video frames were recorded."
            completion(.failure(CameraFailure(message: "The video could not be recorded.", details: details)))
            return
        }
        videoInput.markAsFinished()
        audioInput?.markAsFinished()
        writer.finishWriting { [writer, url] in
            if writer.status == .completed {
                completion(.success(url))
            } else {
                let details = writer.error?.localizedDescription
                completion(.failure(CameraFailure(message: "The video could not be recorded.", details: details)))
            }
        }
    }

    func cancel() {
        done = true
        if started { writer.cancelWriting() }
        try? FileManager.default.removeItem(at: url)
    }
}
