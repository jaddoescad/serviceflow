import AVFoundation
import Foundation

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

/// Things the capture session reports, always delivered on the main queue.
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

    static func photo(_ details: String?) -> CameraFailure {
        CameraFailure(message: "The photo could not be captured.", details: details)
    }

    static func video(_ details: String?) -> CameraFailure {
        CameraFailure(message: "The video could not be recorded.", details: details)
    }
}

struct CameraPhotoResult {
    var url: URL
    var width: Int?
    var height: Int?
    var capturedAt: Date
}

/// A message in the camera's red notice banner.
struct CameraNotice: Equatable, Identifiable {
    let id = UUID()
    var message: String
    var details: String?

    static func == (lhs: CameraNotice, rhs: CameraNotice) -> Bool { lhs.id == rhs.id }

    static let phoneCallUsesMicrophone = "Your phone call is using the microphone. Photo mode is still available."
    static let cameraInUse = "Your iPhone is using the camera in another app or call."

    /// Friendly text for a native camera error; nil when it should be ignored.
    static func forNativeError(_ message: String) -> CameraNotice? {
        func matches(_ pattern: String) -> Bool {
            message.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
        }
        if matches("cancel") { return nil }
        if matches("audio-device-in-use-by-another-client|audio.*(busy|in use|another client)") {
            return CameraNotice(message: phoneCallUsesMicrophone, details: message)
        }
        if matches("video-device-in-use-by-another-client|camera.*(busy|in use|another client)") {
            return CameraNotice(message: cameraInUse, details: message)
        }
        return CameraNotice(message: "The camera could not start.", details: message)
    }
}

/// Lens and flash choices last the whole app run, not just one opening.
enum CameraPreferences {
    static var facing: CameraFacing = .back
    static var flashOn = false
}

enum CameraPermission {
    case notDetermined, granted, denied

    static var camera: CameraPermission {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .granted
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    static var microphoneGranted: Bool { AVCaptureDevice.authorizationStatus(for: .audio) == .authorized }

    /// Asks for the microphone only if the person has never answered.
    static func ensureMicrophone() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }
}
