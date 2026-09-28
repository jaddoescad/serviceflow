import CoreGraphics

/// Zoom as people see it: `.5x`, `1x`, `2x`, where 1× is the wide lens even
/// on cameras whose raw zoom 1.0 is the ultra-wide.
struct CameraZoom {
    static let steps: [CGFloat] = [0.5, 1, 2]

    var info: CameraDeviceInfo?
    /// The device's `videoZoomFactor`.
    var raw: CGFloat = 1

    var rawPerDisplay: CGFloat { info?.rawPerDisplay ?? 1 }
    var display: CGFloat { raw / max(rawPerDisplay, 0.01) }

    /// Steps this lens can reach; 1× is always offered.
    var availableSteps: [CGFloat] {
        guard let info else { return [1] }
        return Self.steps.filter { step in
            let target = step * info.rawPerDisplay
            return step == 1 || (target >= info.minZoom - 0.001 && target <= info.maxZoom + 0.001)
        }
    }

    /// The step closest to the current zoom.
    var activeStep: CGFloat {
        availableSteps.min { abs($0 - display) < abs($1 - display) } ?? 1
    }

    func raw(for step: CGFloat) -> CGFloat { step * rawPerDisplay }

    /// `.5x`, `1x`, `2x`; the active step shows the live value while pinching (`1.4x`).
    func label(for step: CGFloat) -> String {
        if step == activeStep, abs(step - display) > 0.05 {
            let value = String(format: "%.1f", display)
            return (value.hasPrefix("0") ? String(value.dropFirst()) : value) + "x"
        }
        return step == 0.5 ? ".5x" : "\(Int(step))x"
    }
}
