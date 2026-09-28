import CoreGraphics
import ServiceFlowCore

/// A drag handle on the selected shape: an end of a line or arrow, or a
/// corner of the box around any other shape.
enum PhotoEditorHandle: Hashable {
    case end(Int)
    case corner(Corner)

    enum Corner: CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight

        /// The corner that stays put while this one is dragged.
        var opposite: Corner {
            switch self {
            case .topLeft: return .bottomRight
            case .topRight: return .bottomLeft
            case .bottomLeft: return .topRight
            case .bottomRight: return .topLeft
            }
        }

        func point(in box: CGRect) -> CGPoint {
            switch self {
            case .topLeft: return CGPoint(x: box.minX, y: box.minY)
            case .topRight: return CGPoint(x: box.maxX, y: box.minY)
            case .bottomLeft: return CGPoint(x: box.minX, y: box.maxY)
            case .bottomRight: return CGPoint(x: box.maxX, y: box.maxY)
            }
        }
    }
}

/// Selection geometry in view points, for a photo drawn at `imageSize`.
/// Shapes are stored as fractions of the photo, so every function converts
/// between the two.
struct PhotoEditorSelection {
    let imageSize: CGSize

    private var unit: CGFloat { min(imageSize.width, imageSize.height) }
    /// Shapes smaller than this can't be resized any further.
    private static let minimumSide: CGFloat = 12

    func viewPoint(_ point: AnnotationPoint) -> CGPoint {
        CGPoint(x: CGFloat(point.x) * imageSize.width, y: CGFloat(point.y) * imageSize.height)
    }

    func normalized(_ point: CGPoint) -> AnnotationPoint {
        AnnotationPoint(x: Double(point.x / max(1, imageSize.width)), y: Double(point.y / max(1, imageSize.height)))
    }

    /// The box around a shape.
    func bounds(of shape: AnnotationShape) -> CGRect {
        let points = shape.points.map(viewPoint)
        guard let first = points.first else { return .null }
        if shape.type == .text {
            return CGRect(origin: first, size: AnnotationRenderer.textSize(shape, unit: unit))
        }
        let xs = points.map(\.x), ys = points.map(\.y)
        return CGRect(x: xs.min() ?? 0, y: ys.min() ?? 0,
                      width: (xs.max() ?? 0) - (xs.min() ?? 0), height: (ys.max() ?? 0) - (ys.min() ?? 0))
    }

    /// The handles to show on a selected shape.
    func handles(for shape: AnnotationShape) -> [(handle: PhotoEditorHandle, point: CGPoint)] {
        switch shape.type {
        case .line, .arrow:
            return shape.points.prefix(2).enumerated().map { (.end($0.offset), viewPoint($0.element)) }
        default:
            let box = bounds(of: shape)
            return PhotoEditorHandle.Corner.allCases.map { (.corner($0), $0.point(in: box)) }
        }
    }

    /// The handle within reach of `location`, if any.
    func handle(of shape: AnnotationShape, near location: CGPoint, reach: CGFloat = 26) -> PhotoEditorHandle? {
        handles(for: shape)
            .map { ($0.handle, hypot($0.point.x - location.x, $0.point.y - location.y)) }
            .filter { $0.1 <= reach }
            .min { $0.1 < $1.1 }?.0
    }

    /// `original` with `handle` dragged to `location`.
    func resized(_ original: AnnotationShape, dragging handle: PhotoEditorHandle, to location: CGPoint) -> AnnotationShape {
        var shape = original
        switch (shape.type, handle) {
        case (_, .end(let index)) where shape.points.indices.contains(index):
            shape.points[index] = normalized(location)
        case (.rectangle, .corner(let corner)), (.ellipse, .corner(let corner)):
            // Stored as two opposite corners: keep the fixed one, move the other.
            let fixed = corner.opposite.point(in: bounds(of: original))
            shape.points = [normalized(fixed), normalized(location)]
        case (.draw, .corner(let corner)):
            shape.points = scaled(original, corner: corner, to: location)
        case (.text, .corner(let corner)):
            shape = resizedText(original, corner: corner, to: location)
        default:
            break
        }
        return shape
    }

    /// Scales a freehand stroke inside its box, keeping the opposite corner fixed.
    private func scaled(_ shape: AnnotationShape, corner: PhotoEditorHandle.Corner, to location: CGPoint) -> [AnnotationPoint] {
        let box = bounds(of: shape)
        let anchor = corner.opposite.point(in: box)
        let from = corner.point(in: box)
        let sx = Self.factor(moved: location.x - anchor.x, original: from.x - anchor.x)
        let sy = Self.factor(moved: location.y - anchor.y, original: from.y - anchor.y)
        return shape.points.map { point in
            let p = viewPoint(point)
            return normalized(CGPoint(x: anchor.x + (p.x - anchor.x) * sx, y: anchor.y + (p.y - anchor.y) * sy))
        }
    }

    /// Resizes text by its font size, keeping the opposite corner of its box in place.
    private func resizedText(_ shape: AnnotationShape, corner: PhotoEditorHandle.Corner, to location: CGPoint) -> AnnotationShape {
        let box = bounds(of: shape)
        guard box.width > 0, let fontSize = shape.fontSize else { return shape }
        let anchor = corner.opposite.point(in: box)
        let scale = max(Self.minimumSide, abs(location.x - anchor.x)) / box.width
        var resized = shape
        resized.fontSize = min(0.2, max(0.01, fontSize * Double(scale)))
        let size = AnnotationRenderer.textSize(resized, unit: unit)
        // The text is anchored at its top-left, so place that corner so the
        // opposite corner doesn't move.
        let origin: CGPoint
        switch corner.opposite {
        case .topLeft: origin = anchor
        case .topRight: origin = CGPoint(x: anchor.x - size.width, y: anchor.y)
        case .bottomLeft: origin = CGPoint(x: anchor.x, y: anchor.y - size.height)
        case .bottomRight: origin = CGPoint(x: anchor.x - size.width, y: anchor.y - size.height)
        }
        resized.points = [normalized(origin)]
        return resized
    }

    /// How much a side stretched, never collapsing to nothing.
    private static func factor(moved: CGFloat, original: CGFloat) -> CGFloat {
        guard abs(original) > 0.5 else { return 1 }
        let factor = moved / original
        let minimum = minimumSide / abs(original)
        return abs(factor) < minimum ? (factor < 0 ? -minimum : minimum) : factor
    }
}
