import CoreGraphics
import ServiceFlowCore

/// A drawing tool in the right-hand toolbar.
enum PhotoEditorTool: CaseIterable, Identifiable {
    case draw, line, arrow, ellipse, rectangle, text

    var id: Self { self }

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

/// Stroke and text size. Values are fractions of the image's shorter side, the
/// unit the web annotation format uses.
enum PhotoEditorBrush: CaseIterable, Identifiable {
    case small, medium, large, extraLarge

    var id: Self { self }

    var label: String {
        switch self {
        case .small: return "S"
        case .medium: return "M"
        case .large: return "L"
        case .extraLarge: return "XL"
        }
    }

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

    /// Diameter of the dot that previews the size in the toolbar.
    var dot: CGFloat {
        switch self {
        case .small: return 8
        case .medium: return 12
        case .large: return 16
        case .extraLarge: return 21
        }
    }
}

/// The colour choices, as `#rrggbb` (the web format).
enum PhotoEditorPalette {
    static let colors: [(hex: String, name: String)] = [
        ("#E5FF00", "Yellow"), ("#FF3B30", "Red"), ("#FF9500", "Orange"), ("#34C759", "Green"),
        ("#0A84FF", "Blue"), ("#FFFFFF", "White"), ("#000000", "Black"),
    ]

    static var defaultColor: String { colors[0].hex }
}

/// Geometry helpers for drawing and hit-testing, in image coordinates.
enum PhotoEditorGeometry {
    /// Shortest distance from `point` to the segment `a`–`b`.
    static func distance(from point: CGPoint, toSegment a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return hypot(point.x - a.x, point.y - a.y) }
        let t = max(0, min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
        return hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
    }

    /// Ramer–Douglas–Peucker simplification of a freehand stroke, so strokes
    /// stay small (the server accepts at most 2,000 points per shape).
    static func simplify(_ points: [AnnotationPoint], tolerance: Double = 0.0015) -> [AnnotationPoint] {
        guard points.count > 2 else { return points }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true
        var ranges = [(0, points.count - 1)]
        while let (start, end) = ranges.popLast() {
            guard end > start + 1 else { continue }
            var furthestIndex = start
            var furthest = 0.0
            for index in (start + 1)..<end {
                let distance = perpendicularDistance(points[index], points[start], points[end])
                if distance > furthest {
                    furthest = distance
                    furthestIndex = index
                }
            }
            if furthest > tolerance {
                keep[furthestIndex] = true
                ranges.append((start, furthestIndex))
                ranges.append((furthestIndex, end))
            }
        }
        return Array(zip(points, keep).filter(\.1).map(\.0).prefix(2000))
    }

    private static func perpendicularDistance(_ p: AnnotationPoint, _ a: AnnotationPoint, _ b: AnnotationPoint) -> Double {
        let dx = b.x - a.x, dy = b.y - a.y
        let length = (dx * dx + dy * dy).squareRoot()
        guard length > 0 else { return ((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y)).squareRoot() }
        return abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length
    }
}
