import AVKit
import SwiftUI
import UIKit

/// Swipe down to dismiss, shared by the lightbox and the camera's capture
/// viewer: the content follows the finger, fades to 25 % and shrinks to 88 %
/// over 320 pt, and closes past 140 pt or on a fast flick.
struct MediaSwipeToDismiss: ViewModifier {
    var enabled: Bool
    var onDismiss: () -> Void
    @State private var offset: CGFloat = 0
    @State private var tracking = false

    private var progress: CGFloat { min(1, max(0, offset) / 320) }

    func body(content: Content) -> some View {
        content
            .offset(y: max(0, offset))
            .scaleEffect(1 - 0.12 * progress)
            .opacity(1 - 0.75 * progress)
            .simultaneousGesture(
                DragGesture(minimumDistance: 10)
                    .onChanged { value in
                        guard enabled else { return }
                        let dx = value.translation.width
                        let dy = value.translation.height
                        if !tracking {
                            guard dy > 10, abs(dy) > 1.5 * abs(dx) else { return }
                            tracking = true
                        }
                        offset = max(0, dy)
                    }
                    .onEnded { value in
                        guard tracking else { return }
                        tracking = false
                        // 0.8 pt/ms, as in the RN gesture.
                        if offset > 140 || value.velocity.height > 800 {
                            withAnimation(.easeIn(duration: 0.18)) { offset = 900 }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { onDismiss() }
                        } else {
                            withAnimation(.spring(response: 0.3, dampingFraction: 1)) { offset = 0 }
                        }
                    }
            )
    }
}

extension View {
    func mediaSwipeToDismiss(enabled: Bool = true, onDismiss: @escaping () -> Void) -> some View {
        modifier(MediaSwipeToDismiss(enabled: enabled, onDismiss: onDismiss))
    }
}

/// A native video player (`AVPlayerViewController`) with system controls.
struct MediaVideoPlayer: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.videoGravity = .resizeAspect
        controller.allowsPictureInPicturePlayback = false
        controller.entersFullScreenWhenPlaybackBegins = false
        controller.view.backgroundColor = .clear
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}

/// A photo that pinch-zooms from 1× to 4× in a `UIScrollView`, with correct
/// edge clamping. One-finger panning only works while zoomed, so a swipe at
/// 1× reaches the pager and the swipe-to-dismiss gesture.
struct MediaZoomableImage: UIViewRepresentable {
    let image: UIImage
    /// Pages that scroll away are reset to 1×.
    let isCurrent: Bool
    let onZoomChange: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = UIScrollView()
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 4
        scrollView.bouncesZoom = true
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.backgroundColor = .clear
        scrollView.delegate = context.coordinator
        scrollView.panGestureRecognizer.isEnabled = false

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scrollView.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        imageView.isUserInteractionEnabled = true
        scrollView.addSubview(imageView)
        context.coordinator.imageView = imageView
        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        context.coordinator.onZoomChange = onZoomChange
        if context.coordinator.imageView?.image !== image { context.coordinator.imageView?.image = image }
        if !isCurrent, scrollView.zoomScale != 1 { scrollView.setZoomScale(1, animated: false) }
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        var onZoomChange: (Bool) -> Void = { _ in }
        private var zoomed = false

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            let isZoomed = scrollView.zoomScale > 1.01
            scrollView.panGestureRecognizer.isEnabled = isZoomed
            guard isZoomed != zoomed else { return }
            zoomed = isZoomed
            onZoomChange(isZoomed)
        }
    }
}
