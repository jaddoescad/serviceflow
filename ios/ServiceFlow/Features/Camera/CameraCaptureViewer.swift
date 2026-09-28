import AVFoundation
import AVKit
import ServiceFlowCore
import SwiftUI

/// A capture opened full screen inside the camera. Its status is a
/// snapshot taken when it opened.
struct CameraViewerItem: Identifiable, Equatable {
    var id: String { upload.localId }
    var upload: PendingUpload
    var fileURL: URL?

    var statusText: String {
        switch upload.status {
        case .uploading: return "Uploading"
        case .uploaded: return "Uploaded"
        case .failed: return "Upload failed, tap to retry"
        case .queued:
            if upload.isHeld { return "Uploads when you tap Done" }
            return upload.attempts > 0 ? "Retrying upload" : "Waiting to upload"
        }
    }
}

struct CameraCaptureViewer: View {
    let item: CameraViewerItem
    let safeTop: CGFloat
    let safeBottom: CGFloat
    let onRetry: (String) -> Void
    let onClose: () -> Void

    var body: some View {
        ZStack {
            Color(hex: 0x05080a)

            Group {
                if item.upload.kind == .video, let url = item.fileURL {
                    CameraLoopingVideo(url: url)
                } else if let url = item.fileURL {
                    MediaAsyncImage(url: url, downsampleTo: 1400, contentMode: .fit)
                }
            }
            .padding(.top, max(safeTop, 14))
            .mediaSwipeToDismiss(onDismiss: onClose)

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 21, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color(rgba: 18, 26, 30, 0.72), in: Circle())
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
                    }
                    .buttonStyle(.pressable(opacity: 0.7))
                    .accessibilityLabel("Close preview")
                    Text(item.statusText)
                        .text(13, .bold, .white.opacity(0.82))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.top, max(safeTop, 14))
                .padding(.bottom, 12)
                .background(Color(rgba: 4, 8, 10, 0.5))

                Spacer(minLength: 0)

                if item.upload.status == .failed {
                    Button {
                        onRetry(item.upload.localId)
                        onClose()
                    } label: {
                        HStack(spacing: 7) {
                            Icon("arrow.clockwise", 18, Color(hex: 0x0b2025))
                            Text("Retry upload").text(14, .black, Color(hex: 0x0b2025))
                        }
                        .padding(.horizontal, 18)
                        .frame(minHeight: 44)
                        .background(Color(hex: 0x58c7d6), in: Capsule())
                    }
                    .buttonStyle(.pressable(opacity: 0.8))
                    .padding(.bottom, max(safeBottom, 16) + 16)
                    .accessibilityLabel("Retry upload")
                }
            }
        }
        .ignoresSafeArea()
    }
}

/// A local video that autoplays and loops, with native controls.
private struct CameraLoopingVideo: View {
    let url: URL
    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?

    var body: some View {
        ZStack {
            if let player { MediaVideoPlayer(player: player) }
        }
        .onAppear {
            let queue = AVQueuePlayer()
            looper = AVPlayerLooper(player: queue, templateItem: AVPlayerItem(url: url))
            player = queue
            queue.play()
        }
        .onDisappear {
            player?.pause()
            looper = nil
            player = nil
        }
    }
}
