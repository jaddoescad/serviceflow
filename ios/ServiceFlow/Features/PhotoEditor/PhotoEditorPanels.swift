import ServiceFlowCore
import SwiftUI

/// Crop with draggable corners and edges. Returns the chosen rect as fractions
/// of the image, or nil when cancelled.
struct PhotoEditorCropView: View {
    let image: UIImage
    let onFinish: (CGRect?) -> Void

    @State private var crop = CGRect(x: 0, y: 0, width: 1, height: 1)
    @State private var startCrop: CGRect?

    private enum Handle { case topLeft, topRight, bottomLeft, bottomRight, move }
    private static let minimum: CGFloat = 0.08

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") { onFinish(nil) }
                Spacer()
                Text("Crop").font(.headline)
                Spacer()
                Button("Reset") { crop = CGRect(x: 0, y: 0, width: 1, height: 1) }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .frame(height: 50)

            GeometryReader { geometry in
                let bounds = CGRect(origin: .zero, size: geometry.size).insetBy(dx: 24, dy: 24)
                let rect = AnnotationRenderer.fittedRect(imageSize: image.size, in: bounds)
                let box = CGRect(x: rect.minX + crop.minX * rect.width, y: rect.minY + crop.minY * rect.height,
                                 width: crop.width * rect.width, height: crop.height * rect.height)
                ZStack(alignment: .topLeading) {
                    Image(uiImage: image).resizable()
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX, y: rect.minY)
                    // Dim everything outside the crop.
                    Path { path in
                        path.addRect(rect)
                        path.addRect(box)
                    }
                    .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
                    Rectangle()
                        .strokeBorder(Color.white, lineWidth: 2)
                        .frame(width: box.width, height: box.height)
                        .offset(x: box.minX, y: box.minY)
                        .overlay(alignment: .topLeading) { grid(box) }
                        .gesture(drag(.move, rect: rect))
                    handle(at: CGPoint(x: box.minX, y: box.minY), .topLeft, rect: rect)
                    handle(at: CGPoint(x: box.maxX, y: box.minY), .topRight, rect: rect)
                    handle(at: CGPoint(x: box.minX, y: box.maxY), .bottomLeft, rect: rect)
                    handle(at: CGPoint(x: box.maxX, y: box.maxY), .bottomRight, rect: rect)
                }
            }

            Button {
                onFinish(crop)
            } label: {
                Text("Done").font(.headline).foregroundStyle(.white)
                    .frame(width: 124, height: 50)
                    .background(Color(hex: 0x0a66d6), in: RoundedRectangle(cornerRadius: 12))
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(16)
        }
    }

    private func grid(_ box: CGRect) -> some View {
        Path { path in
            for i in 1...2 {
                let x = box.minX + box.width * CGFloat(i) / 3
                let y = box.minY + box.height * CGFloat(i) / 3
                path.move(to: CGPoint(x: x, y: box.minY)); path.addLine(to: CGPoint(x: x, y: box.maxY))
                path.move(to: CGPoint(x: box.minX, y: y)); path.addLine(to: CGPoint(x: box.maxX, y: y))
            }
        }
        .stroke(Color.white.opacity(0.35), lineWidth: 1)
        .allowsHitTesting(false)
    }

    private func handle(at point: CGPoint, _ handle: Handle, rect: CGRect) -> some View {
        Circle().fill(Color.white)
            .frame(width: 22, height: 22)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .offset(x: point.x - 22, y: point.y - 22)
            .gesture(drag(handle, rect: rect))
            .accessibilityHidden(true)
    }

    private func drag(_ handle: Handle, rect: CGRect) -> some Gesture {
        DragGesture()
            .onChanged { value in
                let start = startCrop ?? crop
                if startCrop == nil { startCrop = crop }
                let dx = value.translation.width / max(1, rect.width)
                let dy = value.translation.height / max(1, rect.height)
                var next = start
                switch handle {
                case .move:
                    next.origin.x = min(max(0, start.minX + dx), 1 - start.width)
                    next.origin.y = min(max(0, start.minY + dy), 1 - start.height)
                case .topLeft:
                    let x = min(max(0, start.minX + dx), start.maxX - Self.minimum)
                    let y = min(max(0, start.minY + dy), start.maxY - Self.minimum)
                    next = CGRect(x: x, y: y, width: start.maxX - x, height: start.maxY - y)
                case .topRight:
                    let maxX = max(min(1, start.maxX + dx), start.minX + Self.minimum)
                    let y = min(max(0, start.minY + dy), start.maxY - Self.minimum)
                    next = CGRect(x: start.minX, y: y, width: maxX - start.minX, height: start.maxY - y)
                case .bottomLeft:
                    let x = min(max(0, start.minX + dx), start.maxX - Self.minimum)
                    let maxY = max(min(1, start.maxY + dy), start.minY + Self.minimum)
                    next = CGRect(x: x, y: start.minY, width: start.maxX - x, height: maxY - start.minY)
                case .bottomRight:
                    let maxX = max(min(1, start.maxX + dx), start.minX + Self.minimum)
                    let maxY = max(min(1, start.maxY + dy), start.minY + Self.minimum)
                    next = CGRect(x: start.minX, y: start.minY, width: maxX - start.minX, height: maxY - start.minY)
                }
                crop = next
            }
            .onEnded { _ in startCrop = nil }
    }
}

/// Brightness, contrast and saturation with a live preview.
struct PhotoEditorAdjustView: View {
    let model: PhotoEditorModel
    let onFinish: () -> Void

    @State private var value: PhotoEditorAdjustments
    @State private var preview: UIImage

    init(model: PhotoEditorModel, onFinish: @escaping () -> Void) {
        self.model = model
        self.onFinish = onFinish
        _value = State(initialValue: model.adjustments)
        _preview = State(initialValue: model.display)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") { onFinish() }
                Spacer()
                Text("Adjust").font(.headline)
                Spacer()
                Button("Reset") {
                    value = PhotoEditorAdjustments()
                    refresh()
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .frame(height: 50)

            Image(uiImage: preview)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(16)

            VStack(spacing: 14) {
                slider("Brightness", icon: "sun.max", value: $value.brightness, range: -0.4...0.4)
                slider("Contrast", icon: "circle.lefthalf.filled", value: $value.contrast, range: 0.5...1.5)
                slider("Saturation", icon: "drop", value: $value.saturation, range: 0...2)
                Button {
                    model.setAdjustments(value, recordUndo: true)
                    onFinish()
                } label: {
                    Text("Done").font(.headline).foregroundStyle(.white)
                        .frame(width: 124, height: 50)
                        .background(Color(hex: 0x0a66d6), in: RoundedRectangle(cornerRadius: 12))
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(16)
        }
    }

    private func slider(_ title: String, icon: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).frame(width: 24).foregroundStyle(.white.opacity(0.8))
            Slider(value: value, in: range) { editing in
                if !editing { refresh() }
            }
            .tint(.white)
            .accessibilityLabel(title)
        }
        .onChange(of: value.wrappedValue) { _, _ in refresh() }
    }

    private func refresh() {
        preview = model.adjustedPreview(value)
    }
}
