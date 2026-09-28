import AVFoundation
import CoreImage
import UIKit

/// Keeps a small copy of a recent camera frame. The screen shows it blurred
/// while the camera restarts (returning to the app, flipping lenses), like
/// the system camera, instead of a spinner.
final class CameraFrameSnapshot: @unchecked Sendable {
    /// Keep one frame in this many; a snapshot a fraction of a second old is plenty.
    private static let interval = 12
    private static let width: CGFloat = 480

    private let context = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var image: CGImage?
    private var mirrored = false
    private var frameCount = 0

    /// Called on the sample-buffer queue for every video frame.
    func offer(_ sampleBuffer: CMSampleBuffer, mirrored: Bool) {
        frameCount &+= 1
        guard frameCount % Self.interval == 0, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let frame = CIImage(cvPixelBuffer: buffer)
        let scale = Self.width / max(frame.extent.width, 1)
        let small = frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cgImage = context.createCGImage(small, from: small.extent) else { return }
        lock.lock()
        image = cgImage
        self.mirrored = mirrored
        lock.unlock()
    }

    /// The latest frame, upright for a portrait screen. Video frames keep the
    /// sensor's landscape orientation, so they are turned here.
    var latest: UIImage? {
        lock.lock()
        defer { lock.unlock() }
        guard let image else { return nil }
        return UIImage(cgImage: image, scale: 1, orientation: mirrored ? .leftMirrored : .right)
    }
}
