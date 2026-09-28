import ServiceFlowCore
import SwiftUI

/// The photo with its drawings, and the gestures that draw, place text and
/// move shapes.
struct PhotoEditorCanvas: View {
    @Bindable var model: PhotoEditorModel
    @FocusState.Binding var textFocused: Bool

    /// The shape being moved and where the drag started.
    @State private var moving: AnnotationShape?
    @State private var dragBegan = false

    var body: some View {
        GeometryReader { geometry in
            let bounds = CGRect(origin: .zero, size: geometry.size).insetBy(dx: 0, dy: 8)
            let rect = AnnotationRenderer.fittedRect(imageSize: model.image.size, in: bounds)
            ZStack(alignment: .topLeading) {
                Image(uiImage: model.image)
                    .resizable()
                    .frame(width: rect.width, height: rect.height)
                // Saved shapes and the shape being drawn are separate layers,
                // so a stroke in progress doesn't redraw everything else.
                AnnotationOverlay(document: AnnotationDocument(shapes: savedShapes), highlight: model.selectedId)
                    .frame(width: rect.width, height: rect.height)
                if let draft = model.draft {
                    AnnotationOverlay(document: AnnotationDocument(shapes: [draft]))
                        .frame(width: rect.width, height: rect.height)
                }
                if let edit = model.textDraft {
                    textField(edit, imageSize: rect.size)
                }
            }
            .offset(x: rect.minX, y: rect.minY)
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
            .contentShape(Rectangle())
            .gesture(gesture(in: rect))
        }
        .clipped()
    }

    /// Saved shapes, minus the text being edited (the text field shows it).
    private var savedShapes: [AnnotationShape] {
        guard let editing = model.textDraft?.id else { return model.shapes }
        return model.shapes.filter { $0.id != editing }
    }

    // MARK: Gestures

    private func gesture(in rect: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let start = normalized(value.startLocation, in: rect)
                let point = normalized(value.location, in: rect)
                switch model.tool {
                case nil: dragSelection(from: start, translation: value.translation, imageSize: rect.size)
                case .text?: break
                case let tool?: model.continueDraft(from: start, to: point, tool: tool)
                }
            }
            .onEnded { value in
                let point = normalized(value.location, in: rect)
                switch model.tool {
                case nil:
                    if moving == nil, hypot(value.translation.width, value.translation.height) < 6 {
                        model.selectedId = model.shape(at: point, imageSize: rect.size)?.id
                    }
                    moving = nil
                    dragBegan = false
                case .text?:
                    model.beginText(at: point, imageSize: rect.size)
                    textFocused = true
                case .some:
                    model.finishDraft(imageSize: rect.size)
                }
            }
    }

    /// In select mode, a drag that starts on a shape moves it.
    private func dragSelection(from start: AnnotationPoint, translation: CGSize, imageSize: CGSize) {
        if !dragBegan {
            dragBegan = true
            moving = model.shape(at: start, imageSize: imageSize)
            if let moving {
                model.selectedId = moving.id
                model.checkpoint()
            }
        }
        guard let moving, hypot(translation.width, translation.height) > 3 else { return }
        model.move(moving, by: CGSize(width: translation.width / max(1, imageSize.width),
                                      height: translation.height / max(1, imageSize.height)))
    }

    private func normalized(_ location: CGPoint, in rect: CGRect) -> AnnotationPoint {
        AnnotationPoint(x: Double((location.x - rect.minX) / max(1, rect.width)),
                        y: Double((location.y - rect.minY) / max(1, rect.height)))
    }

    // MARK: Text field

    /// An in-place field styled like the finished text.
    private func textField(_ edit: PhotoEditorModel.TextDraft, imageSize: CGSize) -> some View {
        let existing = edit.id.flatMap { id in model.shapes.first { $0.id == id } }
        let fontSize = CGFloat(existing?.fontSize ?? model.brush.fontSize) * min(imageSize.width, imageSize.height)
        let origin = CGPoint(x: CGFloat(edit.point.x) * imageSize.width, y: CGFloat(edit.point.y) * imageSize.height)
        return TextField("Type here", text: textBinding, axis: .vertical)
            .font(.custom("ArialMT", size: max(12, fontSize)))
            .foregroundStyle(Color(uiColor: UIColor(annotationHex: existing?.color ?? model.color)))
            .shadow(color: .black.opacity(0.9), radius: 1)
            .focused($textFocused)
            .frame(maxWidth: max(120, imageSize.width - origin.x - 8), alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .offset(x: origin.x, y: origin.y)
            .onSubmit(commitText)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done", action: commitText)
                }
            }
    }

    private var textBinding: Binding<String> {
        Binding(get: { model.textDraft?.text ?? "" }, set: { model.textDraft?.text = $0 })
    }

    private func commitText() {
        textFocused = false
        model.commitText()
    }
}
