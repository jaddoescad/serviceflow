import ServiceFlowCore
import SwiftUI
import UIKit

/// Draws photo annotations exactly as the web admin does
/// (`web/src/components/photo-annotation-surface.tsx`): points are fractions of
/// the image, stroke widths and font sizes are fractions of the image's
/// shorter side, arrows get a two-stroke head, and text is Arial with a dark
/// outline painted under the fill.
enum AnnotationRenderer {
    /// Draws `document` into `rect` (the image's frame) of `context`, which
    /// must use UIKit's top-left origin.
    static func draw(_ document: AnnotationDocument, in rect: CGRect, context: CGContext, highlight: String? = nil) {
        for shape in document.shapes {
            draw(shape, in: rect, context: context, highlighted: shape.id == highlight)
        }
    }

    static func draw(_ shape: AnnotationShape, in rect: CGRect, context: CGContext, highlighted: Bool = false) {
        guard rect.width > 0, rect.height > 0 else { return }
        let unit = min(rect.width, rect.height)
        let lineWidth = CGFloat(shape.width) * unit
        let color = UIColor(annotationHex: shape.color)
        let points = shape.points.map { point(for: $0, in: rect) }
        guard let first = points.first else { return }

        context.saveGState()
        defer { context.restoreGState() }
        if highlighted {
            context.setShadow(offset: .zero, blur: 6, color: UIColor.white.cgColor)
        }

        if shape.type == .text {
            drawText(shape, at: first, unit: unit, lineWidth: lineWidth, color: color, scale: rect.width / 1000, context: context)
            return
        }

        context.setStrokeColor(color.cgColor)
        context.setLineWidth(lineWidth)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        context.addPath(path(for: shape, points: points, lineWidth: lineWidth, scale: rect.width / 1000))
        context.strokePath()
    }

    /// The stroked outline of a non-text shape.
    static func path(for shape: AnnotationShape, points: [CGPoint], lineWidth: CGFloat, scale: CGFloat) -> CGPath {
        let path = CGMutablePath()
        guard let a = points.first else { return path }
        let b = points.count > 1 ? points[1] : a
        switch shape.type {
        case .rectangle:
            path.addRect(CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y)))
        case .ellipse:
            path.addEllipse(in: CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y)))
        case .draw, .line, .arrow:
            path.move(to: a)
            for point in points.dropFirst() { path.addLine(to: point) }
            if shape.type == .arrow {
                let angle = atan2(b.y - a.y, b.x - a.x)
                let size = max(12 * scale, lineWidth * 5)
                path.move(to: CGPoint(x: b.x - size * cos(angle - 0.5), y: b.y - size * sin(angle - 0.5)))
                path.addLine(to: b)
                path.addLine(to: CGPoint(x: b.x - size * cos(angle + 0.5), y: b.y - size * sin(angle + 0.5)))
            }
        case .text:
            break
        }
        return path
    }

    static func point(for point: AnnotationPoint, in rect: CGRect) -> CGPoint {
        CGPoint(x: rect.minX + CGFloat(point.x) * rect.width, y: rect.minY + CGFloat(point.y) * rect.height)
    }

    // MARK: Text

    static func textFont(_ shape: AnnotationShape, unit: CGFloat) -> UIFont {
        let size = max(1, CGFloat(shape.fontSize ?? 0.035) * unit)
        return UIFont(name: "ArialMT", size: size) ?? .systemFont(ofSize: size)
    }

    /// Size of a text shape's box, top-left anchored.
    static func textSize(_ shape: AnnotationShape, unit: CGFloat) -> CGSize {
        let font = textFont(shape, unit: unit)
        let lines = (shape.text ?? "").components(separatedBy: "\n")
        let width = lines.map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
        let height = font.pointSize * (1 + 1.2 * CGFloat(max(0, lines.count - 1))) + font.descender.magnitude
        return CGSize(width: width, height: height)
    }

    private static func drawText(_ shape: AnnotationShape, at origin: CGPoint, unit: CGFloat, lineWidth: CGFloat,
                                 color: UIColor, scale: CGFloat, context: CGContext) {
        let font = textFont(shape, unit: unit)
        let outline = max(1 * scale, lineWidth / 3)
        // Stroke percentage of the font size; positive draws the outline only.
        let strokePercent = outline / font.pointSize * 100
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext() }
        for (index, line) in (shape.text ?? "").components(separatedBy: "\n").enumerated() {
            // SVG `dominant-baseline: hanging` puts the top of the capitals at y.
            let top = CGPoint(x: origin.x, y: origin.y + CGFloat(index) * font.pointSize * 1.2 - (font.ascender - font.capHeight))
            let text = line as NSString
            text.draw(at: top, withAttributes: [
                .font: font, .strokeColor: UIColor(annotationHex: "#111827"), .strokeWidth: strokePercent,
            ])
            text.draw(at: top, withAttributes: [.font: font, .foregroundColor: color])
        }
    }

    // MARK: Compositing

    /// The image with its drawings burned in (for viewing, not uploading).
    static func composite(_ image: UIImage, document: AnnotationDocument) -> UIImage {
        guard !document.isEmpty else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).image { renderer in
            image.draw(in: CGRect(origin: .zero, size: image.size))
            draw(document, in: CGRect(origin: .zero, size: image.size), context: renderer.cgContext)
        }
    }

    /// Where an image of `imageSize` sits when aspect-fitted into `bounds`.
    static func fittedRect(imageSize: CGSize, in bounds: CGRect) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, bounds.width > 0, bounds.height > 0 else { return .zero }
        let scale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width, height: size.height)
    }
}

/// Renders an annotation document over an image-sized frame. Place it exactly
/// over the image (same frame).
struct AnnotationOverlay: View {
    var document: AnnotationDocument
    var highlight: String?

    init(document: AnnotationDocument, highlight: String? = nil) {
        self.document = document
        self.highlight = highlight
    }

    var body: some View {
        Canvas { context, size in
            context.withCGContext { cg in
                AnnotationRenderer.draw(document, in: CGRect(origin: .zero, size: size), context: cg, highlight: highlight)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension UIColor {
    /// `#rrggbb`; anything else is yellow.
    convenience init(annotationHex hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self.init(red: 0.9, green: 1, blue: 0, alpha: 1)
            return
        }
        self.init(red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255,
                  blue: CGFloat(value & 0xff) / 255, alpha: 1)
    }
}
