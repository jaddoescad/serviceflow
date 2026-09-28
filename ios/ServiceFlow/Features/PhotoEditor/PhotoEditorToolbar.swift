import SwiftUI

/// The column down the right edge: brush size, colour, drawing tools and the
/// timestamp. Size and colour open a small picker beside the column.
struct PhotoEditorToolbar: View {
    @Bindable var model: PhotoEditorModel
    @State private var picker: Picker?

    private enum Picker { case size, color }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if let picker { pickerView(picker) }
            VStack(spacing: 10) {
                Button { toggle(.size) } label: {
                    Circle().fill(.white).frame(width: model.brush.dot, height: model.brush.dot)
                        .frame(width: 44, height: 40)
                }
                .accessibilityLabel("Brush size")

                Button { toggle(.color) } label: {
                    RoundedRectangle(cornerRadius: 7)
                        .fill(Color(uiColor: UIColor(annotationHex: model.color)))
                        .frame(width: 32, height: 32)
                        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(.white.opacity(0.6), lineWidth: 1))
                        .frame(width: 44, height: 40)
                }
                .accessibilityLabel("Colour")

                VStack(spacing: 2) {
                    ForEach(PhotoEditorTool.allCases) { tool in toolButton(tool) }
                    Button { model.addTimestamp() } label: {
                        Image(systemName: "clock").font(.system(size: 20, weight: .medium)).frame(width: 48, height: 46)
                    }
                    .accessibilityLabel("Add date and time")
                }
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .foregroundStyle(.white)
        .onChange(of: model.tool) { _, _ in picker = nil }
        .onChange(of: model.draft != nil) { _, drawing in if drawing { picker = nil } }
    }

    private func toggle(_ value: Picker) {
        picker = picker == value ? nil : value
    }

    private func toolButton(_ tool: PhotoEditorTool) -> some View {
        let active = model.tool == tool
        return Button { model.select(tool: tool) } label: {
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

    @ViewBuilder
    private func pickerView(_ picker: Picker) -> some View {
        switch picker {
        case .size:
            HStack(spacing: 4) {
                ForEach(PhotoEditorBrush.allCases) { brush in
                    Button {
                        model.brush = brush
                        self.picker = nil
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
                ForEach(PhotoEditorPalette.colors, id: \.hex) { color in
                    let chosen = model.color == color.hex
                    Button {
                        model.setColor(color.hex)
                        self.picker = nil
                    } label: {
                        Circle().fill(Color(uiColor: UIColor(annotationHex: color.hex)))
                            .frame(width: 28, height: 28)
                            .overlay(Circle().strokeBorder(chosen ? Color.white : Color.white.opacity(0.3), lineWidth: chosen ? 3 : 1))
                    }
                    .accessibilityLabel(color.name)
                }
            }
            .padding(10)
            .background(Color.black.opacity(0.7), in: Capsule())
        }
    }
}
