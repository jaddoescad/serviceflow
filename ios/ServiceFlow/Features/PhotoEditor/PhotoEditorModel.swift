import Observation
import ServiceFlowCore
import UIKit

/// One markup session. The photo itself is never changed: the result is a set
/// of shapes (the web admin's annotation format) and a description.
@MainActor
@Observable
final class PhotoEditorModel {
    /// Text being typed on the photo; `id` is set when editing an existing shape.
    struct TextDraft: Equatable {
        var id: String?
        var point: AnnotationPoint
        var text: String
    }

    /// Longest side of the image kept for display; enough for any screen.
    private static let displayMaxSide: CGFloat = 2048
    private static let historyLimit = 40

    let image: UIImage
    private(set) var shapes: [AnnotationShape]
    var description: String

    var tool: PhotoEditorTool? = .draw
    var brush: PhotoEditorBrush = .medium
    var color = PhotoEditorPalette.defaultColor
    var selectedId: String?
    /// The shape being drawn right now (not yet in `shapes`).
    var draft: AnnotationShape?
    var textDraft: TextDraft?

    private var undoStack: [[AnnotationShape]] = []
    private var redoStack: [[AnnotationShape]] = []
    private let initialShapes: [AnnotationShape]
    private let initialDescription: String

    init(image: UIImage, annotations: AnnotationDocument, description: String) {
        self.image = Self.displayImage(image)
        shapes = annotations.shapes
        self.description = description
        initialShapes = annotations.shapes
        initialDescription = description
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var hasChanges: Bool { shapes != initialShapes || description != initialDescription }

    /// What Save hands back.
    var result: (annotations: AnnotationDocument, description: String) {
        (AnnotationDocument(shapes: shapes).sanitized(), description.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // MARK: History

    /// Records the current shapes so the next change can be undone.
    func checkpoint() {
        undoStack.append(shapes)
        if undoStack.count > Self.historyLimit { undoStack.removeFirst() }
        redoStack.removeAll()
    }

    func undo() {
        commitText()
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(shapes)
        shapes = previous
        selectedId = nil
    }

    func redo() {
        commitText()
        guard let next = redoStack.popLast() else { return }
        undoStack.append(shapes)
        shapes = next
        selectedId = nil
    }

    func clearAll() {
        textDraft = nil
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

    func replace(_ shape: AnnotationShape) {
        guard let index = shapes.firstIndex(where: { $0.id == shape.id }) else { return }
        guard let clean = shape.sanitized() else {
            delete(shape.id)
            return
        }
        checkpoint()
        shapes[index] = clean
    }

    func delete(_ id: String) {
        guard let index = shapes.firstIndex(where: { $0.id == id }) else { return }
        checkpoint()
        shapes.remove(at: index)
        if selectedId == id { selectedId = nil }
    }

    /// Moves `original` by a normalized offset. Call `checkpoint()` once when
    /// the drag starts, so the whole move is one undo step.
    func move(_ original: AnnotationShape, by offset: CGSize) {
        guard let index = shapes.firstIndex(where: { $0.id == original.id }) else { return }
        var moved = original
        moved.points = original.points.map { AnnotationPoint(x: $0.x + offset.width, y: $0.y + offset.height) }
        shapes[index] = moved
    }

    func setColor(_ hex: String) {
        color = hex
        if let id = selectedId, var shape = shapes.first(where: { $0.id == id }) {
            shape.color = hex
            replace(shape)
        }
    }

    /// Adds the current date and time as text near the bottom left.
    func addTimestamp(_ date: Date = Date()) {
        commitText()
        let text = date.formatted(.dateTime.month(.abbreviated).day().year().hour().minute())
        add(AnnotationShape(type: .text, points: [AnnotationPoint(x: 0.04, y: 0.9)], color: color,
                            width: brush.width, text: text, fontSize: brush.fontSize))
    }

    func select(tool newTool: PhotoEditorTool) {
        commitText()
        selectedId = nil
        // Tapping the active tool again switches to selecting and moving.
        tool = tool == newTool ? nil : newTool
    }

    // MARK: Drawing

    /// Starts or extends the shape under the finger.
    func continueDraft(from start: AnnotationPoint, to point: AnnotationPoint, tool: PhotoEditorTool) {
        if draft == nil {
            commitText()
            draft = AnnotationShape(type: tool.kind, points: [start, start], color: color, width: brush.width)
        }
        guard var shape = draft else { return }
        if tool == .draw {
            // Skip points that are too close to add detail.
            if let last = shape.points.last, hypot(last.x - point.x, last.y - point.y) > 0.002 { shape.points.append(point) }
        } else {
            shape.points[1] = point
        }
        draft = shape
    }

    /// Commits the shape being drawn; taps and tiny shapes are dropped.
    func finishDraft(imageSize: CGSize) {
        guard var shape = draft else { return }
        draft = nil
        if shape.type == .draw {
            shape.points = PhotoEditorGeometry.simplify(shape.points)
            guard shape.points.count >= 2 else { return }
        } else {
            let a = shape.points[0], b = shape.points[1]
            guard hypot((b.x - a.x) * imageSize.width, (b.y - a.y) * imageSize.height) > 8 else { return }
        }
        add(shape)
    }

    // MARK: Text

    /// Starts typing at `point`, or edits the text shape found there.
    func beginText(at point: AnnotationPoint, imageSize: CGSize) {
        commitText()
        if let hit = shape(at: point, imageSize: imageSize), hit.type == .text, let origin = hit.points.first {
            textDraft = TextDraft(id: hit.id, point: origin, text: hit.text ?? "")
        } else {
            textDraft = TextDraft(id: nil, point: point, text: "")
        }
    }

    /// Saves the text being typed; clearing an existing text removes it.
    func commitText() {
        guard let edit = textDraft else { return }
        textDraft = nil
        let text = edit.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = edit.id, var shape = shapes.first(where: { $0.id == id }) {
            if text.isEmpty {
                delete(id)
            } else if text != shape.text {
                shape.text = text
                replace(shape)
            }
        } else if !text.isEmpty {
            add(AnnotationShape(type: .text, points: [edit.point], color: color, width: brush.width,
                                text: text, fontSize: brush.fontSize))
        }
    }

    // MARK: Hit testing

    /// The topmost shape near a normalized point.
    func shape(at point: AnnotationPoint, imageSize: CGSize) -> AnnotationShape? {
        let unit = min(imageSize.width, imageSize.height)
        let tolerance = max(18, unit * 0.03)
        let target = CGPoint(x: point.x * imageSize.width, y: point.y * imageSize.height)
        return shapes.last { shape in
            let points = shape.points.map { CGPoint(x: $0.x * imageSize.width, y: $0.y * imageSize.height) }
            guard let first = points.first else { return false }
            switch shape.type {
            case .text:
                let size = AnnotationRenderer.textSize(shape, unit: unit)
                return CGRect(origin: first, size: size).insetBy(dx: -tolerance / 2, dy: -tolerance / 2).contains(target)
            case .rectangle, .ellipse:
                guard points.count == 2 else { return false }
                let box = CGRect(x: min(points[0].x, points[1].x), y: min(points[0].y, points[1].y),
                                 width: abs(points[1].x - points[0].x), height: abs(points[1].y - points[0].y))
                guard box.insetBy(dx: -tolerance, dy: -tolerance).contains(target) else { return false }
                // Rectangles are picked by their outline, circles anywhere inside.
                let inner = box.insetBy(dx: tolerance, dy: tolerance)
                return shape.type == .ellipse || inner.isNull || !inner.contains(target)
            case .draw, .line, .arrow:
                return zip(points, points.dropFirst()).contains {
                    PhotoEditorGeometry.distance(from: target, toSegment: $0, $1) <= tolerance
                }
            }
        }
    }

    // MARK: Image

    /// An upright, screen-sized copy of the photo (drawings are stored in
    /// fractions of the image, so resolution doesn't matter).
    private static func displayImage(_ image: UIImage) -> UIImage {
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let factor = min(1, displayMaxSide / max(pixels.width, pixels.height, 1))
        guard factor < 1 || image.imageOrientation != .up else { return image }
        let size = CGSize(width: (pixels.width * factor).rounded(), height: (pixels.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
