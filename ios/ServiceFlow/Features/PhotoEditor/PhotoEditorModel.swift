import CoreImage
import Observation
import ServiceFlowCore
import UIKit

enum PhotoEditorTool: String, CaseIterable, Identifiable {
    case draw, line, arrow, ellipse, rectangle, text
    var id: String { rawValue }

    var icon: String {
        switch self {
        case .draw: return "scribble"
        case .line: return "point.topleft.down.to.point.bottomright.curvepath"
        case .arrow: return "arrow.up.left"
        case .ellipse: return "circle"
        case .rectangle: return "square"
        case .text: return "textformat"
        }
    }

    var label: String {
        switch self {
        case .draw: return "Draw"
        case .line: return "Line"
        case .arrow: return "Arrow"
        case .ellipse: return "Circle"
        case .rectangle: return "Rectangle"
        case .text: return "Text"
        }
    }

    var kind: AnnotationShape.Kind {
        switch self {
        case .draw: return .draw
        case .line: return .line
        case .arrow: return .arrow
        case .ellipse: return .ellipse
        case .rectangle: return .rectangle
        case .text: return .text
        }
    }
}

enum PhotoEditorBrush: String, CaseIterable, Identifiable {
    case small, medium, large, extraLarge
    var id: String { rawValue }

    var label: String {
        switch self {
        case .small: return "S"
        case .medium: return "M"
        case .large: return "L"
        case .extraLarge: return "XL"
        }
    }

    /// Stroke width as a fraction of the image's shorter side.
    var width: Double {
        switch self {
        case .small: return 0.004
        case .medium: return 0.008
        case .large: return 0.014
        case .extraLarge: return 0.022
        }
    }

    var fontSize: Double {
        switch self {
        case .small: return 0.035
        case .medium: return 0.05
        case .large: return 0.07
        case .extraLarge: return 0.1
        }
    }

    /// Dot size in the toolbar.
    var dot: CGFloat {
        switch self {
        case .small: return 8
        case .medium: return 12
        case .large: return 16
        case .extraLarge: return 21
        }
    }
}

struct PhotoEditorAdjustments: Equatable {
    var brightness: Double = 0
    var contrast: Double = 1
    var saturation: Double = 1

    var isIdentity: Bool { self == PhotoEditorAdjustments() }
}

/// State of one editing session. Rotate and crop change the working image
/// right away (and move the drawings with it); colour adjustments are kept as
/// numbers and applied when saving.
@MainActor
@Observable
final class PhotoEditorModel {
    struct Snapshot {
        var image: UIImage
        var preview: UIImage
        var shapes: [AnnotationShape]
        var adjustments: PhotoEditorAdjustments
        var pixelsChanged: Bool
    }

    static let palette = ["#E5FF00", "#FF3B30", "#FF9500", "#34C759", "#0A84FF", "#FFFFFF", "#000000"]
    static let previewMaxSide: CGFloat = 2048

    private(set) var image: UIImage
    private(set) var preview: UIImage
    /// The preview with the saved adjustments, as shown on screen.
    private(set) var display: UIImage
    private(set) var shapes: [AnnotationShape]
    private(set) var adjustments = PhotoEditorAdjustments()
    private(set) var pixelsChanged = false
    var description: String

    var tool: PhotoEditorTool? = .draw
    var brush: PhotoEditorBrush = .medium
    var color = palette[0]
    var selectedId: String?
    /// The shape being drawn right now.
    var draft: AnnotationShape?

    private var undoStack: [Snapshot] = []
    private var redoStack: [Snapshot] = []
    private let initialDescription: String
    private let initialShapes: [AnnotationShape]
    private let context = CIContext(options: [.useSoftwareRenderer: false])

    init(image: UIImage, annotations: AnnotationDocument, description: String) {
        let upright = Self.upright(image)
        self.image = upright
        let preview = Self.downsample(upright, maxSide: Self.previewMaxSide)
        self.preview = preview
        display = preview
        shapes = annotations.shapes
        self.description = description
        initialDescription = description
        initialShapes = annotations.shapes
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var hasChanges: Bool {
        pixelsChanged || !adjustments.isIdentity || shapes != initialShapes || description != initialDescription
    }

    var document: AnnotationDocument {
        AnnotationDocument(shapes: shapes)
    }

    // MARK: History

    private var snapshot: Snapshot {
        Snapshot(image: image, preview: preview, shapes: shapes, adjustments: adjustments, pixelsChanged: pixelsChanged)
    }

    private func restore(_ snapshot: Snapshot) {
        image = snapshot.image
        preview = snapshot.preview
        shapes = snapshot.shapes
        adjustments = snapshot.adjustments
        pixelsChanged = snapshot.pixelsChanged
        selectedId = nil
        refreshDisplay()
    }

    private func refreshDisplay() {
        display = adjustedPreview()
    }

    /// Call before every change that should be undoable.
    func checkpoint() {
        undoStack.append(snapshot)
        if undoStack.count > 40 { undoStack.removeFirst(undoStack.count - 40) }
        redoStack.removeAll()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(snapshot)
        restore(previous)
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(snapshot)
        restore(next)
    }

    func clearAll() {
        guard !shapes.isEmpty else { return }
        checkpoint()
        shapes.removeAll()
        selectedId = nil
    }

    // MARK: Shapes

    func add(_ shape: AnnotationShape) {
        guard let clean = shape.sanitized(), shapes.count < AnnotationDocument.maxShapes else { return }
        checkpoint()
        shapes.append(clean)
    }

    func replace(_ shape: AnnotationShape, recordUndo: Bool = true) {
        guard let index = shapes.firstIndex(where: { $0.id == shape.id }) else { return }
        guard let clean = shape.sanitized() else {
            deleteShape(shape.id)
            return
        }
        if recordUndo { checkpoint() }
        shapes[index] = clean
    }

    func deleteShape(_ id: String) {
        guard let index = shapes.firstIndex(where: { $0.id == id }) else { return }
        checkpoint()
        shapes.remove(at: index)
        if selectedId == id { selectedId = nil }
    }

    /// Moves a shape by a normalized offset (no undo step; call `checkpoint` at drag start).
    func move(_ id: String, from original: AnnotationShape, by delta: CGSize) {
        guard let index = shapes.firstIndex(where: { $0.id == id }) else { return }
        var moved = original
        moved.points = original.points.map { AnnotationPoint(x: $0.x + delta.width, y: $0.y + delta.height) }
        shapes[index] = moved
    }

    /// Adds the photo's date and time as text near the bottom left.
    func addTimestamp(_ date: Date = Date()) {
        let text = date.formatted(.dateTime.month(.abbreviated).day().year().hour().minute())
        add(AnnotationShape(type: .text, points: [AnnotationPoint(x: 0.04, y: 0.9)], color: color,
                            width: brush.width, text: text, fontSize: brush.fontSize))
    }

    // MARK: Hit testing

    /// The topmost shape near a normalized point.
    func shape(at point: CGPoint, imageSize: CGSize) -> AnnotationShape? {
        let unit = min(imageSize.width, imageSize.height)
        let tolerance = max(18, unit * 0.03)
        let target = CGPoint(x: point.x * imageSize.width, y: point.y * imageSize.height)
        for shape in shapes.reversed() {
            let points = shape.points.map { CGPoint(x: CGFloat($0.x) * imageSize.width, y: CGFloat($0.y) * imageSize.height) }
            switch shape.type {
            case .text:
                let size = AnnotationRenderer.textSize(shape, unit: unit)
                let box = CGRect(origin: points[0], size: size).insetBy(dx: -tolerance / 2, dy: -tolerance / 2)
                if box.contains(target) { return shape }
            case .rectangle, .ellipse:
                guard points.count == 2 else { continue }
                let box = CGRect(x: min(points[0].x, points[1].x), y: min(points[0].y, points[1].y),
                                 width: abs(points[1].x - points[0].x), height: abs(points[1].y - points[0].y))
                let outer = box.insetBy(dx: -tolerance, dy: -tolerance)
                let inner = box.insetBy(dx: tolerance, dy: tolerance)
                if outer.contains(target) && (inner.isNull || !inner.contains(target) || shape.type == .ellipse) { return shape }
            default:
                for (a, b) in zip(points, points.dropFirst()) where Self.distance(from: target, toSegment: a, b) <= tolerance {
                    return shape
                }
            }
        }
        return nil
    }

    private static func distance(from p: CGPoint, toSegment a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let length = dx * dx + dy * dy
        guard length > 0 else { return hypot(p.x - a.x, p.y - a.y) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }

    // MARK: Rotate and crop

    /// Rotates 90° counterclockwise; drawings turn with the photo.
    func rotateLeft() {
        checkpoint()
        image = Self.rotatedLeft(image)
        preview = Self.downsample(image, maxSide: Self.previewMaxSide)
        // (x, y) → (y, 1 − x). Widths and font sizes are relative to the
        // shorter side, which a quarter turn doesn't change.
        shapes = shapes.map { shape in
            var turned = shape
            turned.points = shape.points.map { AnnotationPoint(x: $0.y, y: 1 - $0.x) }
            return turned
        }
        pixelsChanged = true
        selectedId = nil
        refreshDisplay()
    }

    /// Crops to a normalized rect; drawings outside it are removed.
    func crop(to rect: CGRect) {
        let bounds = CGRect(x: 0, y: 0, width: 1, height: 1)
        let crop = rect.intersection(bounds)
        guard crop.width > 0.02, crop.height > 0.02, crop != bounds else { return }
        checkpoint()
        let oldSize = image.size
        let pixelRect = CGRect(x: crop.minX * oldSize.width, y: crop.minY * oldSize.height,
                               width: crop.width * oldSize.width, height: crop.height * oldSize.height).integral
        guard let cgImage = image.cgImage?.cropping(to: CGRect(x: pixelRect.minX * image.scale, y: pixelRect.minY * image.scale,
                                                             width: pixelRect.width * image.scale, height: pixelRect.height * image.scale))
        else { return }
        image = UIImage(cgImage: cgImage, scale: image.scale, orientation: .up)
        preview = Self.downsample(image, maxSide: Self.previewMaxSide)

        let oldUnit = min(oldSize.width, oldSize.height)
        let newUnit = min(pixelRect.width, pixelRect.height)
        let ratio = Double(oldUnit / max(1, newUnit))
        shapes = shapes.compactMap { shape in
            let mapped = shape.points.map { (x: ($0.x - Double(crop.minX)) / Double(crop.width), y: ($0.y - Double(crop.minY)) / Double(crop.height)) }
            let inside = mapped.contains { (0...1).contains($0.x) && (0...1).contains($0.y) }
            guard inside else { return nil }
            var cropped = shape
            cropped.points = mapped.map { AnnotationPoint(x: $0.x, y: $0.y) }
            // Keep strokes and text the same size on screen.
            cropped.width = shape.width * ratio
            cropped.fontSize = shape.fontSize.map { $0 * ratio }
            return cropped.sanitized()
        }
        pixelsChanged = true
        selectedId = nil
        refreshDisplay()
    }

    // MARK: Adjust

    func setAdjustments(_ value: PhotoEditorAdjustments, recordUndo: Bool) {
        guard value != adjustments else { return }
        if recordUndo { checkpoint() }
        adjustments = value
        refreshDisplay()
    }

    /// The preview with colour adjustments applied.
    func adjustedPreview(_ value: PhotoEditorAdjustments? = nil) -> UIImage {
        let settings = value ?? adjustments
        guard !settings.isIdentity else { return preview }
        return apply(settings, to: preview) ?? preview
    }

    private func apply(_ settings: PhotoEditorAdjustments, to source: UIImage) -> UIImage? {
        guard let input = CIImage(image: source) else { return nil }
        let filter = CIFilter(name: "CIColorControls")
        filter?.setValue(input, forKey: kCIInputImageKey)
        filter?.setValue(settings.brightness, forKey: kCIInputBrightnessKey)
        filter?.setValue(settings.contrast, forKey: kCIInputContrastKey)
        filter?.setValue(settings.saturation, forKey: kCIInputSaturationKey)
        guard let output = filter?.outputImage, let cgImage = context.createCGImage(output, from: input.extent) else { return nil }
        return UIImage(cgImage: cgImage, scale: source.scale, orientation: .up)
    }

    // MARK: Save

    /// The full-resolution image when its pixels changed, else nil.
    func finalImage() -> UIImage? {
        guard pixelsChanged || !adjustments.isIdentity else { return nil }
        guard !adjustments.isIdentity else { return image }
        return apply(adjustments, to: image) ?? image
    }

    // MARK: Image helpers

    static func upright(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }

    static func rotatedLeft(_ image: UIImage) -> UIImage {
        let size = CGSize(width: image.size.height, height: image.size.width)
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            let context = renderer.cgContext
            context.translateBy(x: 0, y: size.height)
            context.rotate(by: -.pi / 2)
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }

    static func downsample(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let longest = max(pixels.width, pixels.height)
        guard longest > maxSide else { return image }
        let factor = maxSide / longest
        let size = CGSize(width: (pixels.width * factor).rounded(), height: (pixels.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    /// Ramer–Douglas–Peucker on normalized points, to keep freehand strokes light.
    static func simplify(_ points: [AnnotationPoint], tolerance: Double = 0.0015) -> [AnnotationPoint] {
        guard points.count > 2 else { return points }
        func perpendicular(_ p: AnnotationPoint, _ a: AnnotationPoint, _ b: AnnotationPoint) -> Double {
            let dx = b.x - a.x, dy = b.y - a.y
            let length = (dx * dx + dy * dy).squareRoot()
            guard length > 0 else { return ((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y)).squareRoot() }
            return abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length
        }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true
        var stack = [(0, points.count - 1)]
        while let (start, end) = stack.popLast() {
            guard end > start + 1 else { continue }
            var index = start
            var furthest = 0.0
            for i in (start + 1)..<end {
                let distance = perpendicular(points[i], points[start], points[end])
                if distance > furthest { furthest = distance; index = i }
            }
            if furthest > tolerance {
                keep[index] = true
                stack.append((start, index))
                stack.append((index, end))
            }
        }
        let result = points.enumerated().filter { keep[$0.offset] }.map(\.element)
        return Array(result.prefix(2000))
    }
}
