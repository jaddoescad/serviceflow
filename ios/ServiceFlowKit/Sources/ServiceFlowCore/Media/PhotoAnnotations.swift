import Foundation

/// Drawings on a photo, stored separately from the image so they can be edited
/// later. Same format as the web admin's annotation editor
/// (`web/src/lib/photo-annotations.ts`): coordinates are fractions (0…1) of the
/// image size; widths and font sizes are fractions of the image's shorter side.
public struct AnnotationDocument: Codable, Hashable, Sendable {
    public var version: Int
    public var shapes: [AnnotationShape]

    public init(shapes: [AnnotationShape] = []) {
        version = 1
        self.shapes = shapes
    }

    public var isEmpty: Bool { shapes.isEmpty }

    public static let maxShapes = 200

    /// Drops shapes the server would reject.
    public func sanitized() -> AnnotationDocument {
        AnnotationDocument(shapes: shapes.compactMap { $0.sanitized() }.prefix(Self.maxShapes).map { $0 })
    }
}

public struct AnnotationPoint: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = min(1, max(0, x))
        self.y = min(1, max(0, y))
    }
}

public struct AnnotationShape: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case arrow, line, rectangle, ellipse, draw, text
    }

    /// Lowercase UUID.
    public var id: String
    public var type: Kind
    public var points: [AnnotationPoint]
    /// `#rrggbb`.
    public var color: String
    /// Stroke width as a fraction of the image's shorter side (0.001…0.05).
    public var width: Double
    public var text: String?
    /// Font size as a fraction of the image's shorter side (0.01…0.2).
    public var fontSize: Double?

    public init(id: String = UUID().uuidString.lowercased(), type: Kind, points: [AnnotationPoint], color: String,
                width: Double, text: String? = nil, fontSize: Double? = nil) {
        self.id = id
        self.type = type
        self.points = points
        self.color = color
        self.width = width
        self.text = text
        self.fontSize = fontSize
    }

    /// The shape clamped to the server's rules, or nil when it can't be saved.
    public func sanitized() -> AnnotationShape? {
        var shape = self
        shape.id = id.lowercased()
        shape.width = min(0.05, max(0.001, width))
        guard shape.color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else { return nil }
        switch type {
        case .text:
            guard points.count == 1, let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
            shape.text = String(text.prefix(1000))
            shape.fontSize = min(0.2, max(0.01, fontSize ?? 0.05))
        case .draw:
            guard points.count >= 2 else { return nil }
            shape.points = Array(points.prefix(2000))
            shape.text = nil
            shape.fontSize = nil
        default:
            guard points.count == 2 else { return nil }
            shape.text = nil
            shape.fontSize = nil
        }
        return shape
    }
}
