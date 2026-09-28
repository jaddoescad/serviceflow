import AVFoundation
import ImageIO
import UIKit

enum CameraPhotoSettings {
    /// About 12 MP: full detail for job-site photos, and well under the
    /// 25 MB upload limit. Some sensors list 48 MP, which is far too large.
    static let maxPixels = 12_600_000

    /// The largest photo size the format supports, up to `maxPixels`.
    static func bestDimensions(for format: AVCaptureDevice.Format) -> CMVideoDimensions? {
        let supported = format.supportedMaxPhotoDimensions
        let capped = supported.filter { pixels($0) <= maxPixels }
        return (capped.isEmpty ? supported : capped).max { pixels($0) < pixels($1) }
    }

    /// A JPEG at quality 0.85. iPhones default to HEIC, which Android crew
    /// members can't always view, so JPEG is forced.
    static func make(for output: AVCapturePhotoOutput, flash: Bool) -> AVCapturePhotoSettings {
        let settings = output.availablePhotoCodecTypes.contains(.jpeg)
            ? AVCapturePhotoSettings(format: [
                AVVideoCodecKey: AVVideoCodecType.jpeg,
                AVVideoCompressionPropertiesKey: [AVVideoQualityKey: 0.85],
            ])
            : AVCapturePhotoSettings()
        if flash, output.supportedFlashModes.contains(.on) { settings.flashMode = .on }
        settings.maxPhotoDimensions = output.maxPhotoDimensions
        settings.photoQualityPrioritization = .balanced
        return settings
    }

    private static func pixels(_ dimensions: CMVideoDimensions) -> Int {
        Int(dimensions.width) * Int(dimensions.height)
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
        if let error { return finish(.failure(.photo(error.localizedDescription))) }
        guard var data = photo.fileDataRepresentation() else { return finish(.failure(.photo("No image data."))) }
        if !Self.isJPEG(data), let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) {
            data = jpeg
        }
        let url = CameraFiles.temporaryURL(extension: "jpg")
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            return finish(.failure(.photo(error.localizedDescription)))
        }
        let size = Self.pixelSize(of: url)
        finish(.success(CameraPhotoResult(url: url, width: size?.width, height: size?.height, capturedAt: Date())))
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
                     error: Error?) {
        if let error { finish(.failure(.photo(error.localizedDescription))) }
    }

    private func finish(_ result: Result<CameraPhotoResult, CameraFailure>) {
        guard !finished else { return }
        finished = true
        completion(result)
    }

    private static func isJPEG(_ data: Data) -> Bool {
        data.count > 3 && data[0] == 0xff && data[1] == 0xd8
    }

    /// Pixel size with the EXIF orientation applied.
    private static func pixelSize(of url: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        return (5...8).contains(orientation) ? (height, width) : (width, height)
    }
}

enum CameraFiles {
    /// A unique file in the temporary directory, e.g. `project-1727…-a1b2c3.jpg`.
    static func temporaryURL(extension ext: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("project-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6)).\(ext)")
    }
}
