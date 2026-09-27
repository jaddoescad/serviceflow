import ServiceFlowCore
import SwiftUI

/// Marks up a photo, CompanyCam style: drawing tools down the right edge,
/// undo/redo and Clear All at the top, a description and Save at the bottom.
///
/// `onSave` receives a new full-resolution image only when rotate, crop or
/// adjust changed the pixels; drawings are returned separately so they stay
/// editable (same format as the web admin).
struct PhotoEditorScreen: View {
    let onSave: (_ editedImage: UIImage?, _ annotations: AnnotationDocument, _ description: String) -> Void
    let onCancel: () -> Void

    @State private var model: PhotoEditorModel
    @State private var panel: Panel?
    @State private var mode: Mode = .markup
    @State private var confirmDiscard = false
    @State private var saving = false
    @State private var textEdit: TextEdit?
    @State private var moveOrigin: AnnotationShape?
    @State private var dragStart: CGPoint?
    @FocusState private var textFocused: Bool
    @FocusState private var descriptionFocused: Bool

    private enum Panel { case size, color }
    private enum Mode { case markup, crop, adjust }

    /// Text being typed on the photo.
    private struct TextEdit: Equatable {
        var id: String?
        var point: AnnotationPoint
        var text: String
    }

    init(image: UIImage, annotations: AnnotationDocument, description: String,
         onSave: @escaping (_ editedImage: UIImage?, _ annotations: AnnotationDocument, _ description: String) -> Void,
         onCancel: @escaping () -> Void) {
        self.onSave = onSave
        self.onCancel = onCancel
        _model = State(initialValue: PhotoEditorModel(image: image, annotations: annotations, description: description))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch mode {
            case .markup:
                markup
            case .crop:
                PhotoEditorCropView(image: model.display) { rect in
                    if let rect { model.crop(to: rect) }
                    mode = .markup
                }
            case .adjust:
                PhotoEditorAdjustView(model: model) { mode = .markup }
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
        .confirmationDialog("Discard your changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard Changes", role: .destructive) { onCancel() }
            Button("Keep Editing", role: .cancel) {}
        }
    }

    // MARK: Markup mode

    private var markup: some View {
        VStack(spacing: 0) {
            topBar
            canvas
                .overlay(alignment: .topTrailing) { toolbar.padding(.trailing, 8).padding(.top, 4) }
                .overlay(alignment: .top) { selectionBar }
            bottomBar
        }
    }

    private var topBar: some View {
        HStack(spacing: 22) {
            Button {
                commitText()
                if model.hasChanges { confirmDiscard = true } else { onCancel() }
            } label: {
                Image(systemName: "chevron.left").font(.system(size: 22, weight: .semibold)).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Back")
            Spacer()
            topButton("Undo", icon: "arrow.uturn.backward", enabled: model.canUndo) { commitText(); model.undo() }
            topButton("Redo", icon: "arrow.uturn.forward", enabled: model.canRedo) { commitText(); model.redo() }
            topButton("Clear All", icon: "arrow.counterclockwise", enabled: !model.shapes.isEmpty) {
                textEdit = nil
                model.clearAll()
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }

    private func topButton(_ title: String, icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 20, weight: .semibold))
                Text(title).font(.caption)
            }
            .frame(minWidth: 44)
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    // MARK: Canvas

    private var canvas: some View {
        GeometryReader { geometry in
            let bounds = CGRect(origin: .zero, size: geometry.size).insetBy(dx: 0, dy: 8)
            let rect = AnnotationRenderer.fittedRect(imageSize: model.display.size, in: bounds)
            ZStack(alignment: .topLeading) {
                Image(uiImage: model.display)
                    .resizable()
                    .frame(width: rect.width, height: rect.height)
                    .offset(x: rect.minX, y: rect.minY)
                AnnotationOverlay(document: AnnotationDocument(shapes: visibleShapes), highlight: model.selectedId)
                    .frame(width: rect.width, height: rect.height)
                    .offset(x: rect.minX, y: rect.minY)
                if let textEdit {
                    textField(textEdit, rect: rect)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
            .contentShape(Rectangle())
            .gesture(drawingGesture(rect: rect))
        }
        .clipped()
    }

    /// Shapes with the one being drawn, and without the text being edited.
    private var visibleShapes: [AnnotationShape] {
        var shapes = model.shapes.filter { $0.id != textEdit?.id }
        if let draft = model.draft { shapes.append(draft) }
        return shapes
    }

    private func normalized(_ location: CGPoint, in rect: CGRect) -> AnnotationPoint {
        AnnotationPoint(x: Double((location.x - rect.minX) / max(1, rect.width)),
                        y: Double((location.y - rect.minY) / max(1, rect.height)))
    }

    private func drawingGesture(rect: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                panel = nil
                descriptionFocused = false
                let point = normalized(value.location, in: rect)
                switch model.tool {
                case nil:
                    moveSelection(value, rect: rect)
                case .text?:
                    break
                case let tool?:
                    if model.draft == nil {
                        commitText()
                        let start = normalized(value.startLocation, in: rect)
                        model.draft = AnnotationShape(type: tool.kind, points: [start, start], color: model.color,
                                                      width: model.brush.width)
                    }
                    guard var draft = model.draft else { return }
                    if tool == .draw {
                        if let last = draft.points.last, hypot(last.x - point.x, last.y - point.y) > 0.002 {
                            draft.points.append(point)
                        }
                    } else {
                        draft.points[1] = point
                    }
                    model.draft = draft
                }
            }
            .onEnded { value in
                let point = normalized(value.location, in: rect)
                switch model.tool {
                case nil:
                    if moveOrigin == nil, hypot(value.translation.width, value.translation.height) < 6 {
                        model.selectedId = model.shape(at: CGPoint(x: point.x, y: point.y), imageSize: rect.size)?.id
                    }
                    moveOrigin = nil
                    dragStart = nil
                case .text?:
                    tapText(at: point, rect: rect)
                case .some:
                    finishDraft(rect: rect)
                }
            }
    }

    private func moveSelection(_ value: DragGesture.Value, rect: CGRect) {
        if dragStart == nil {
            dragStart = value.startLocation
            let start = normalized(value.startLocation, in: rect)
            if let hit = model.shape(at: CGPoint(x: start.x, y: start.y), imageSize: rect.size) {
                model.selectedId = hit.id
                model.checkpoint()
                moveOrigin = hit
            } else {
                moveOrigin = nil
            }
        }
        guard let origin = moveOrigin, hypot(value.translation.width, value.translation.height) > 3 else { return }
        model.move(origin.id, from: origin, by: CGSize(width: value.translation.width / max(1, rect.width),
                                                       height: value.translation.height / max(1, rect.height)))
    }

    private func finishDraft(rect: CGRect) {
        guard var draft = model.draft else { return }
        model.draft = nil
        if draft.type == .draw {
            if draft.points.count < 2, let only = draft.points.first {
                draft.points.append(AnnotationPoint(x: only.x + 0.001, y: only.y + 0.001))
            }
            draft.points = PhotoEditorModel.simplify(draft.points)
        } else {
            let a = draft.points[0], b = draft.points[1]
            let length = hypot((b.x - a.x) * rect.width, (b.y - a.y) * rect.height)
            guard length > 8 else { return }
        }
        model.add(draft)
    }

    // MARK: Text

    private func tapText(at point: AnnotationPoint, rect: CGRect) {
        commitText()
        if let hit = model.shape(at: CGPoint(x: point.x, y: point.y), imageSize: rect.size), hit.type == .text {
            textEdit = TextEdit(id: hit.id, point: hit.points[0], text: hit.text ?? "")
        } else {
            textEdit = TextEdit(id: nil, point: point, text: "")
        }
        textFocused = true
    }

    private func textField(_ edit: TextEdit, rect: CGRect) -> some View {
        let unit = min(rect.width, rect.height)
        let shape = edit.id.flatMap { id in model.shapes.first { $0.id == id } }
        let fontSize = CGFloat(shape?.fontSize ?? model.brush.fontSize) * unit
        let color = Color(uiColor: UIColor(annotationHex: shape?.color ?? model.color))
        return TextField("Type here", text: Binding(get: { textEdit?.text ?? "" }, set: { textEdit?.text = $0 }), axis: .vertical)
            .font(.custom("ArialMT", size: max(12, fontSize)))
            .foregroundStyle(color)
            .shadow(color: .black.opacity(0.9), radius: 1)
            .focused($textFocused)
            .frame(maxWidth: max(120, rect.maxX - (rect.minX + CGFloat(edit.point.x) * rect.width) - 8), alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .offset(x: rect.minX + CGFloat(edit.point.x) * rect.width, y: rect.minY + CGFloat(edit.point.y) * rect.height)
            .onSubmit(commitText)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { commitText() }
                }
            }
    }

    /// Saves (or removes, when empty) the text being typed.
    private func commitText() {
        guard let edit = textEdit else { return }
        textEdit = nil
        textFocused = false
        let text = edit.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = edit.id, var shape = model.shapes.first(where: { $0.id == id }) {
            if text.isEmpty {
                model.deleteShape(id)
            } else if text != shape.text {
                shape.text = text
                model.replace(shape)
            }
        } else if !text.isEmpty {
            model.add(AnnotationShape(type: .text, points: [edit.point], color: model.color, width: model.brush.width,
                                      text: text, fontSize: model.brush.fontSize))
        }
    }

    // MARK: Selection

    @ViewBuilder
    private var selectionBar: some View {
        if model.tool == nil, let id = model.selectedId {
            Button(role: .destructive) {
                model.deleteShape(id)
            } label: {
                Label("Delete", systemImage: "trash")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: Capsule())
            }
            .tint(.red)
            .padding(.top, 12)
        }
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(alignment: .top, spacing: 8) {
            if let panel { panelView(panel) }
            VStack(spacing: 10) {
                Button { panel = panel == .size ? nil : .size } label: {
                    Circle().fill(.white).frame(width: model.brush.dot, height: model.brush.dot)
                        .frame(width: 44, height: 40)
                }
                .accessibilityLabel("Brush size")
                Button { panel = panel == .color ? nil : .color } label: {
                    RoundedRectangle(cornerRadius: 7).fill(Color(uiColor: UIColor(annotationHex: model.color)))
                        .frame(width: 32, height: 32)
                        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(.white.opacity(0.6), lineWidth: 1))
                        .frame(width: 44, height: 40)
                }
                .accessibilityLabel("Colour")

                VStack(spacing: 2) {
                    ForEach(PhotoEditorTool.allCases) { tool in toolButton(tool) }
                    iconButton("clock", label: "Add date and time") {
                        commitText()
                        model.addTimestamp()
                    }
                }
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 14))

                VStack(spacing: 2) {
                    iconButton("rotate.left", label: "Rotate") {
                        commitText()
                        model.rotateLeft()
                    }
                    iconButton("crop", label: "Crop") {
                        commitText()
                        model.selectedId = nil
                        mode = .crop
                    }
                    iconButton("slider.horizontal.3", label: "Adjust") {
                        commitText()
                        model.selectedId = nil
                        mode = .adjust
                    }
                }
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .foregroundStyle(.white)
    }

    private func toolButton(_ tool: PhotoEditorTool) -> some View {
        let active = model.tool == tool
        return Button {
            commitText()
            panel = nil
            model.selectedId = nil
            // Tapping the active tool again switches to selecting and moving.
            model.tool = active ? nil : tool
        } label: {
            Image(systemName: tool.icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(active ? Color.black : Color.white)
                .frame(width: 40, height: 40)
                .background(active ? Color.white : Color.clear, in: Circle())
                .frame(width: 48, height: 46)
        }
        .accessibilityLabel(tool.label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func iconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 20, weight: .medium)).frame(width: 48, height: 46)
        }
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private func panelView(_ panel: Panel) -> some View {
        switch panel {
        case .size:
            HStack(spacing: 4) {
                ForEach(PhotoEditorBrush.allCases) { brush in
                    Button {
                        model.brush = brush
                        self.panel = nil
                    } label: {
                        VStack(spacing: 4) {
                            Circle().fill(.white).frame(width: brush.dot, height: brush.dot).frame(height: 22)
                            Text(brush.label).font(.caption2.weight(.semibold))
                        }
                        .frame(width: 40, height: 48)
                        .background(model.brush == brush ? Color.white.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .accessibilityLabel("Size \(brush.label)")
                }
            }
            .padding(6)
            .background(Color.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 14))
        case .color:
            HStack(spacing: 8) {
                ForEach(PhotoEditorModel.palette, id: \.self) { hex in
                    Button {
                        model.color = hex
                        if let id = model.selectedId, var shape = model.shapes.first(where: { $0.id == id }) {
                            shape.color = hex
                            model.replace(shape)
                        }
                        self.panel = nil
                    } label: {
                        Circle().fill(Color(uiColor: UIColor(annotationHex: hex)))
                            .frame(width: 28, height: 28)
                            .overlay(Circle().strokeBorder(model.color == hex ? Color.white : Color.white.opacity(0.3),
                                                           lineWidth: model.color == hex ? 3 : 1))
                    }
                    .accessibilityLabel(PhotoEditorScreen.colorName(hex))
                }
            }
            .padding(10)
            .background(Color.black.opacity(0.7), in: Capsule())
        }
    }

    static func colorName(_ hex: String) -> String {
        switch hex {
        case "#E5FF00": return "Yellow"
        case "#FF3B30": return "Red"
        case "#FF9500": return "Orange"
        case "#34C759": return "Green"
        case "#0A84FF": return "Blue"
        case "#FFFFFF": return "White"
        default: return "Black"
        }
    }

    // MARK: Bottom bar

    private var bottomBar: some View {
        VStack(spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Image(systemName: "text.alignleft").foregroundStyle(.white.opacity(0.8))
                TextField("Add a description…", text: $model.description, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($descriptionFocused)
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)

            HStack {
                Spacer()
                Button(action: save) {
                    ZStack {
                        Text("Save").opacity(saving ? 0 : 1)
                        if saving { ProgressView().tint(.white) }
                    }
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 124, height: 50)
                    .background(Color(hex: 0x0a66d6), in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(saving)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .background(Color.black)
    }

    private func save() {
        commitText()
        descriptionFocused = false
        saving = true
        let model = model
        Task { @MainActor in
            // Let the spinner show before the full-size render.
            try? await Task.sleep(nanoseconds: 30_000_000)
            let edited = model.finalImage()
            onSave(edited, model.document.sanitized(), model.description.trimmingCharacters(in: .whitespacesAndNewlines))
            saving = false
        }
    }
}
