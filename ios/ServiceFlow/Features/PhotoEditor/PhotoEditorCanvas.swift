import ServiceFlowCore
import SwiftUI

/// The photo with its drawings, and the one gesture that draws, selects,
/// moves and resizes.
///
/// A touch is interpreted when it starts: on a handle of the selected
/// drawing it resizes, on the selected drawing it moves it, elsewhere it
/// draws with the current tool. A tap selects the drawing under it (with any
/// tool), places text with the text tool, or clears the selection.
struct PhotoEditorCanvas: View {
    @Bindable var model: PhotoEditorModel

    private enum Interaction {
        case resizing(original: AnnotationShape, handle: PhotoEditorHandle)
        case moving(original: AnnotationShape)
        case drawing
        case none
    }

    @State private var interaction: Interaction?

    var body: some View {
        GeometryReader { geometry in
            let bounds = CGRect(origin: .zero, size: geometry.size).insetBy(dx: 0, dy: 8)
            let rect = AnnotationRenderer.fittedRect(imageSize: model.image.size, in: bounds)
            let selection = PhotoEditorSelection(imageSize: rect.size)
            ZStack(alignment: .topLeading) {
                Image(uiImage: model.image)
                    .resizable()
                    .frame(width: rect.width, height: rect.height)
                // Saved shapes and the shape being drawn are separate layers,
                // so a stroke in progress doesn't redraw everything else.
                AnnotationOverlay(document: AnnotationDocument(shapes: savedShapes))
                    .frame(width: rect.width, height: rect.height)
                if let live = model.draft ?? model.textPreview {
                    AnnotationOverlay(document: AnnotationDocument(shapes: [live]))
                        .frame(width: rect.width, height: rect.height)
                        .opacity(model.textDraft?.text.isEmpty == true ? 0.5 : 1)
                }
                if model.textDraft == nil, let shape = model.selectedShape {
                    PhotoEditorSelectionChrome(shape: shape, selection: selection)
                    actions(for: shape, selection: selection, canvas: rect.size)
                }
            }
            .frame(width: rect.width, height: rect.height, alignment: .topLeading)
            .offset(x: rect.minX, y: rect.minY)
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
            .contentShape(Rectangle())
            .gesture(gesture(in: rect, selection: selection))
        }
        .clipped()
    }

    /// Saved shapes, minus the text being edited (the preview shows it).
    private var savedShapes: [AnnotationShape] {
        guard let editing = model.textDraft?.id else { return model.shapes }
        return model.shapes.filter { $0.id != editing }
    }

    // MARK: Selection actions

    /// Duplicate, Edit (text) and Delete, just above the selected drawing.
    private func actions(for shape: AnnotationShape, selection: PhotoEditorSelection, canvas: CGSize) -> some View {
        let box = selection.bounds(of: shape)
        let y = box.minY - 34 > 20 ? box.minY - 34 : min(canvas.height - 20, box.maxY + 34)
        return HStack(spacing: 2) {
            actionButton("Duplicate", icon: "plus.square.on.square", action: model.duplicateSelection)
            if shape.type == .text {
                actionButton("Edit", icon: "character.cursor.ibeam", action: model.editSelectedText)
            }
            actionButton("Delete", icon: "trash", role: .destructive) { model.delete(shape.id) }
        }
        .padding(4)
        .background(.ultraThinMaterial, in: Capsule())
        .environment(\.colorScheme, .dark)
        .fixedSize()
        .position(x: min(max(box.midX, 90), canvas.width - 90), y: y)
    }

    private func actionButton(_ title: String, icon: String, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Label(title, systemImage: icon)
                .labelStyle(.titleAndIcon)
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
        }
        .foregroundStyle(role == .destructive ? Color(hex: 0xff6b6b) : .white)
    }

    // MARK: Gesture

    private func gesture(in rect: CGRect, selection: PhotoEditorSelection) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let start = local(value.startLocation, in: rect)
                let location = local(value.location, in: rect)
                if interaction == nil { interaction = begin(at: start, selection: selection) }
                switch interaction {
                case .resizing(let original, let handle)?:
                    model.update(selection.resized(original, dragging: handle, to: location))
                case .moving(let original)?:
                    guard hypot(value.translation.width, value.translation.height) > 3 else { return }
                    model.move(original, by: CGSize(width: value.translation.width / max(1, rect.width),
                                                    height: value.translation.height / max(1, rect.height)))
                case .drawing?:
                    if let tool = model.tool, tool != .text {
                        model.continueDraft(from: selection.normalized(start), to: selection.normalized(location), tool: tool)
                    }
                case .none?, nil:
                    break
                }
            }
            .onEnded { value in
                let point = selection.normalized(local(value.location, in: rect))
                let tapped = hypot(value.translation.width, value.translation.height) < 6
                switch interaction {
                case .drawing?:
                    model.finishDraft(imageSize: rect.size)
                    if tapped { tap(at: point, imageSize: rect.size) }
                case .moving?, .resizing?:
                    if tapped { tap(at: point, imageSize: rect.size) }
                case .none?, nil:
                    if tapped { tap(at: point, imageSize: rect.size) }
                }
                interaction = nil
            }
    }

    /// Decides what a touch does from where it starts.
    private func begin(at start: CGPoint, selection: PhotoEditorSelection) -> Interaction {
        if let selected = model.selectedShape, model.textDraft == nil {
            if let handle = selection.handle(of: selected, near: start) {
                model.checkpoint()
                return .resizing(original: selected, handle: handle)
            }
            if model.shape(at: selection.normalized(start), imageSize: selection.imageSize)?.id == selected.id {
                model.checkpoint()
                return .moving(original: selected)
            }
        }
        if model.tool == nil {
            // With no drawing tool, dragging any drawing moves it.
            if let hit = model.shape(at: selection.normalized(start), imageSize: selection.imageSize) {
                model.selectedId = hit.id
                model.checkpoint()
                return .moving(original: hit)
            }
            return .none
        }
        return model.tool == .text ? .none : .drawing
    }

    /// A tap selects the drawing under it, places text, or clears the selection.
    private func tap(at point: AnnotationPoint, imageSize: CGSize) {
        if model.textDraft != nil {
            model.commitText()
        } else if let hit = model.shape(at: point, imageSize: imageSize) {
            model.selectedId = hit.id
        } else if model.tool == .text {
            model.beginText(at: point)
        } else {
            model.selectedId = nil
        }
    }

    private func local(_ location: CGPoint, in rect: CGRect) -> CGPoint {
        CGPoint(x: location.x - rect.minX, y: location.y - rect.minY)
    }
}

/// The dashed box and drag handles around the selected drawing.
struct PhotoEditorSelectionChrome: View {
    let shape: AnnotationShape
    let selection: PhotoEditorSelection

    private static let accent = Color(hex: 0x0a84ff)

    var body: some View {
        let box = selection.bounds(of: shape).insetBy(dx: -6, dy: -6)
        ZStack(alignment: .topLeading) {
            if shape.type != .line, shape.type != .arrow {
                Rectangle()
                    .stroke(Self.accent, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                    .frame(width: max(box.width, 1), height: max(box.height, 1))
                    .offset(x: box.minX, y: box.minY)
            }
            ForEach(Array(selection.handles(for: shape).enumerated()), id: \.offset) { _, handle in
                Circle()
                    .fill(Color.white)
                    .overlay(Circle().strokeBorder(Self.accent, lineWidth: 2.5))
                    .frame(width: 18, height: 18)
                    .shadow(color: .black.opacity(0.35), radius: 2)
                    .position(handle.point)
            }
        }
        .allowsHitTesting(false)
    }
}
