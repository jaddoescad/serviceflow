import AVFoundation
import SwiftUI
import UIKit

/// The live camera image, aspect-filled and full bleed. Pinch zooms and a tap
/// focuses; the rotation coordinator keeps the preview upright and tells the
/// model which way to rotate captures.
struct CameraPreview: UIViewRepresentable {
    let model: CameraModel

    func makeUIView(context: Context) -> CameraPreviewView {
        let view = CameraPreviewView()
        view.previewLayer.session = model.engine.session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.onPinchBegan = { [weak model] in model?.pinchBegan() }
        view.onPinchChanged = { [weak model] scale in model?.pinchChanged(scale) }
        view.onTap = { [weak model] point in model?.focus(at: point) }
        model.captureRotationAngle = { [weak view] in view?.captureRotationAngle ?? 90 }
        return view
    }

    func updateUIView(_ view: CameraPreviewView, context: Context) {
        view.attach(device: model.device)
    }
}

final class CameraPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

    var onPinchBegan: (@MainActor () -> Void)?
    var onPinchChanged: (@MainActor (CGFloat) -> Void)?
    var onTap: (@MainActor (CGPoint) -> Void)?

    private var coordinator: AVCaptureDevice.RotationCoordinator?
    private var rotationObservation: NSKeyValueObservation?
    private weak var device: AVCaptureDevice?
    private let focusRing = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:))))
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
        focusRing.frame = CGRect(x: 0, y: 0, width: 72, height: 72)
        focusRing.layer.borderColor = UIColor(red: 1, green: 0.84, blue: 0.2, alpha: 1).cgColor
        focusRing.layer.borderWidth = 1.5
        focusRing.alpha = 0
        focusRing.isUserInteractionEnabled = false
        addSubview(focusRing)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// Capture angle for a level horizon in the current device orientation.
    var captureRotationAngle: CGFloat { coordinator?.videoRotationAngleForHorizonLevelCapture ?? 90 }

    func attach(device newDevice: AVCaptureDevice?) {
        guard let newDevice, newDevice !== device else { return }
        device = newDevice
        let coordinator = AVCaptureDevice.RotationCoordinator(device: newDevice, previewLayer: previewLayer)
        self.coordinator = coordinator
        rotationObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.initial, .new]) {
            [weak self] coordinator, _ in
            let angle = coordinator.videoRotationAngleForHorizonLevelPreview
            DispatchQueue.main.async {
                guard let connection = self?.previewLayer.connection, connection.isVideoRotationAngleSupported(angle) else { return }
                connection.videoRotationAngle = angle
            }
        }
    }

    @objc private func pinched(_ recognizer: UIPinchGestureRecognizer) {
        switch recognizer.state {
        case .began:
            onPinchBegan?()
            onPinchChanged?(recognizer.scale)
        case .changed:
            onPinchChanged?(recognizer.scale)
        default:
            break
        }
    }

    @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
        let point = recognizer.location(in: self)
        onTap?(previewLayer.captureDevicePointConverted(fromLayerPoint: point))
        focusRing.center = point
        focusRing.alpha = 1
        focusRing.transform = CGAffineTransform(scaleX: 1.3, y: 1.3)
        UIView.animate(withDuration: 0.2) {
            self.focusRing.transform = .identity
        } completion: { _ in
            UIView.animate(withDuration: 0.3, delay: 0.6) { self.focusRing.alpha = 0 }
        }
    }
}
