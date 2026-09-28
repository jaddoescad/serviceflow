import ServiceFlowCore
import SwiftUI

/// Marks up a photo, CompanyCam style: drawing tools down the right edge,
/// undo, redo and Clear All at the top, a description and Save at the bottom.
///
/// The photo is never changed. Save returns the drawings (the web admin's
/// annotation format) and the description, so both stay editable anywhere.
struct PhotoEditorScreen: View {
    private let onSave: (_ annotations: AnnotationDocument, _ description: String) -> Void
    private let onCancel: () -> Void

    @State private var model: PhotoEditorModel
    @State private var confirmDiscard = false
    @FocusState private var textFocused: Bool
    @FocusState private var descriptionFocused: Bool

    init(image: UIImage, annotations: AnnotationDocument, description: String,
         onSave: @escaping (_ annotations: AnnotationDocument, _ description: String) -> Void,
         onCancel: @escaping () -> Void) {
        self.onSave = onSave
        self.onCancel = onCancel
        _model = State(initialValue: PhotoEditorModel(image: image, annotations: annotations, description: description))
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            PhotoEditorCanvas(model: model, textFocused: $textFocused)
                .overlay(alignment: .topTrailing) {
                    PhotoEditorToolbar(model: model).padding(.trailing, 8).padding(.top, 4)
                }
                .overlay(alignment: .top) { deleteSelectionButton }
                .simultaneousGesture(TapGesture().onEnded { descriptionFocused = false })
            bottomBar
        }
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .confirmationDialog("Discard your changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard Changes", role: .destructive, action: onCancel)
            Button("Keep Editing", role: .cancel) {}
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 22) {
            Button(action: back) {
                Image(systemName: "chevron.left").font(.system(size: 22, weight: .semibold)).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Back")
            Spacer()
            topButton("Undo", icon: "arrow.uturn.backward", enabled: model.canUndo, action: model.undo)
            topButton("Redo", icon: "arrow.uturn.forward", enabled: model.canRedo, action: model.redo)
            topButton("Clear All", icon: "arrow.counterclockwise", enabled: !model.shapes.isEmpty, action: model.clearAll)
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

    /// In select mode, a Delete button for the selected shape.
    @ViewBuilder
    private var deleteSelectionButton: some View {
        if model.tool == nil, let id = model.selectedId {
            Button(role: .destructive) { model.delete(id) } label: {
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
                    Text("Save")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(width: 124, height: 50)
                        .background(Color(hex: 0x0a66d6), in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .background(Color.black)
    }

    // MARK: Actions

    private func back() {
        textFocused = false
        model.commitText()
        if model.hasChanges { confirmDiscard = true } else { onCancel() }
    }

    private func save() {
        textFocused = false
        descriptionFocused = false
        model.commitText()
        let result = model.result
        onSave(result.annotations, result.description)
    }
}
