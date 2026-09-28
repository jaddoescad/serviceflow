import AVFoundation
import UIKit

/// Writes camera sample buffers to an MP4 (H.264 + AAC) with `AVAssetWriter`.
/// All calls after `init` happen on the sample-buffer queue.
final class CameraMovieRecorder {
    /// H.264 can't encode the photo format's full sensor size, so frames are
    /// scaled to at most this many pixels on the long side.
    static let maxLongSide: CGFloat = 1920

    let url: URL
    private let writer: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private let audioInput: AVAssetWriterInput?
    private var started = false
    private var done = false

    /// - Parameters:
    ///   - sourceSize: the camera's frame size (landscape, as the sensor delivers it).
    ///   - rotationAngle: degrees; carried in the track transform, not applied to frames.
    init(sourceSize: CGSize, audioSettings: [String: Any]?, rotationAngle: CGFloat) throws {
        url = CameraFiles.temporaryURL(extension: "mp4")
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true

        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: Self.videoSettings(for: sourceSize))
        videoInput.expectsMediaDataInRealTime = true
        videoInput.transform = CGAffineTransform(rotationAngle: rotationAngle * .pi / 180)
        guard writer.canAdd(videoInput) else { throw CameraFailure.video("The video track could not be created.") }
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

    static func videoSettings(for source: CGSize) -> [String: Any] {
        let scale = min(1, maxLongSide / max(source.width, source.height, 1))
        // Encoders want even dimensions.
        let width = Int((source.width * scale / 2).rounded()) * 2
        let height = Int((source.height * scale / 2).rounded()) * 2
        return [
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
    }

    static let fallbackAudioSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 1, AVSampleRateKey: 44_100, AVEncoderBitRateKey: 96_000,
    ]

    func append(_ buffer: CMSampleBuffer, isVideo: Bool) {
        guard !done else { return }
        if !started {
            // The file starts at the first video frame, so it never opens on silence.
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
            completion(.failure(.video(writer.error?.localizedDescription ?? "No video frames were recorded.")))
            return
        }
        videoInput.markAsFinished()
        audioInput?.markAsFinished()
        writer.finishWriting { [writer, url] in
            if writer.status == .completed {
                completion(.success(url))
            } else {
                completion(.failure(.video(writer.error?.localizedDescription)))
            }
        }
    }

    func cancel() {
        done = true
        if started { writer.cancelWriting() }
        try? FileManager.default.removeItem(at: url)
    }
}

enum CameraPoster {
    /// A JPEG still from near the start of a video, oriented upright. It's
    /// shown in the drawer and uploaded as the video's grid thumbnail.
    static func make(from url: URL) async -> URL? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 1280, height: 1280)
        guard let image = try? await generator.image(at: CMTime(seconds: 0.1, preferredTimescale: 600)).image,
              let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.8) else { return nil }
        let posterURL = url.deletingPathExtension().appendingPathExtension("poster.jpg")
        return (try? data.write(to: posterURL, options: .atomic)) == nil ? nil : posterURL
    }
}
