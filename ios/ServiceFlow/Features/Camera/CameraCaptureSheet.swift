import ServiceFlowCore
import SwiftUI

/// The white drawer at the bottom of the camera: this session's captures,
/// newest first, each with a note field, dictation and the photo editor.
/// It follows the finger and settles all the way down (grabber only), at one
/// row, or all the way up.
struct CameraCaptureSheet: View {
    let items: [PendingUpload]
    let collapsedHeight: CGFloat
    let expandedHeight: CGFloat
    @Binding var expanded: Bool
    let dictation: CameraDictation
    let onEdit: (PendingUpload) -> Void
    let onView: (PendingUpload) -> Void
    let onDictationBegin: () -> Void
    let onDictationEnd: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var stop: Stop = .minimized
    @GestureState private var drag: CGFloat = 0

    enum Stop { case minimized, peek, full }

    private static let minimizedHeight: CGFloat = 34

    private func height(of stop: Stop) -> CGFloat {
        switch stop {
        case .minimized: return Self.minimizedHeight
        case .peek: return collapsedHeight
        case .full: return expandedHeight
        }
    }

    private var height: CGFloat {
        min(expandedHeight, max(Self.minimizedHeight, height(of: stop) - drag))
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color(hex: 0xc8cccb))
                .frame(width: 40, height: 5)
                .frame(maxWidth: .infinity, minHeight: Self.minimizedHeight)
                .contentShape(Rectangle())
                .gesture(dragGesture)
                .onTapGesture { settle(stop == .full ? .peek : .full) }
                .accessibilityLabel(stop == .full ? "Collapse captures" : "Show all captures")
                .accessibilityAddTraits(.isButton)

            if items.isEmpty {
                Text("No shots yet")
                    .font(.subheadline)
                    .foregroundStyle(Color(hex: 0x6d7f7b))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                Spacer(minLength: 0)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 14) {
                        ForEach(items) { item in
                            CameraCaptureRow(item: item, dictation: dictation, onEdit: { onEdit(item) }, onView: { onView(item) },
                                             onDictationBegin: onDictationBegin, onDictationEnd: onDictationEnd)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .scrollDisabled(stop != .full)
                .scrollDismissesKeyboard(.interactively)
            }

            if let error = dictation.error {
                Text(error).font(.footnote).foregroundStyle(Color(hex: 0xa5321f))
                    .padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height, alignment: .top)
        .clipped()
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 26, topTrailingRadius: 26, style: .continuous)
                .fill(Color(hex: 0xf6f7f6))
                .ignoresSafeArea(edges: .bottom)
        )
        // Anywhere on the drawer drags it, except while its list is scrollable.
        .gesture(stop == .full ? nil : dragGesture)
        .animation(.interactiveSpring(response: 0.28, dampingFraction: 0.86), value: drag)
        .onAppear { stop = items.isEmpty ? .minimized : .peek }
        .onChange(of: items.count) { old, new in
            if new > old, stop == .minimized { settle(.peek) }
        }
        .onChange(of: expanded) { _, value in
            if value != (stop == .full) { settle(value ? .full : .peek) }
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .updating($drag) { value, state, _ in state = value.translation.height }
            .onEnded { value in
                let projected = height(of: stop) - value.predictedEndTranslation.height
                let target = [Stop.minimized, .peek, .full].min { abs(height(of: $0) - projected) < abs(height(of: $1) - projected) } ?? stop
                settle(target)
            }
    }

    private func settle(_ target: Stop) {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { stop = target }
        if expanded != (target == .full) { expanded = target == .full }
    }
}

/// One capture: thumbnail, note field with dictation, and the edit button.
private struct CameraCaptureRow: View {
    let item: PendingUpload
    let dictation: CameraDictation
    let onEdit: () -> Void
    let onView: () -> Void
    let onDictationBegin: () -> Void
    let onDictationEnd: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var note = ""
    @State private var saveTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var isDictating: Bool { dictation.activeId == item.localId }

    var body: some View {
        HStack(spacing: 12) {
            Button(action: item.kind == .image ? onEdit : onView) { thumbnail }
                .buttonStyle(.pressable(opacity: 0.8))
                .accessibilityLabel(item.kind == .image ? "Edit photo" : "Play video")

            HStack(alignment: .center, spacing: 6) {
                TextField("Add notes…", text: $note, axis: .vertical)
                    .font(.body)
                    .foregroundStyle(Color(hex: 0x11201d))
                    .lineLimit(1...4)
                    .focused($focused)
                    .submitLabel(.done)
                    .onChange(of: note) { _, value in scheduleSave(value) }
                Button(action: toggleDictation) {
                    Image(systemName: isDictating ? "mic.fill" : "mic")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(isDictating ? Color(hex: 0xd92d20) : Color(hex: 0x11201d))
                        .symbolEffect(.pulse, isActive: isDictating)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel(isDictating ? "Stop dictation" : "Dictate a note")
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .frame(minHeight: 54)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color(hex: 0xe1e4e3), lineWidth: 1))

            if item.kind == .image {
                Button(action: onEdit) {
                    Image(systemName: "scribble")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(Color(hex: 0x11201d))
                        .frame(width: 54, height: 54)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color(hex: 0xe1e4e3), lineWidth: 1))
                }
                .buttonStyle(.pressable(opacity: 0.8))
                .accessibilityLabel("Mark up photo")
            }
        }
        .onAppear { note = item.note ?? "" }
        .onChange(of: item.note) { _, value in
            if !focused, !isDictating, let value, value != note { note = value }
        }
        .onDisappear { flush() }
    }

    private var thumbnail: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(hex: 0xdfe6e4))
            if let url = thumbnailURL {
                MediaAsyncImage(url: url, downsampleTo: 64)
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            if item.kind == .video {
                Image(systemName: "play.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 20, height: 20)
                    .background(Color(rgba: 8, 15, 18, 0.7), in: Circle())
                    .padding(5)
            }
            if !(item.annotations?.isEmpty ?? true) {
                Image(systemName: "scribble")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 20, height: 20)
                    .background(Color(rgba: 8, 15, 18, 0.7), in: Circle())
                    .padding(5)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(width: 64, height: 64)
    }

    private var thumbnailURL: URL? {
        guard let uploads = session.uploads else { return nil }
        if item.kind == .video { return uploads.posterURL(for: item) }
        return uploads.fileURL(for: item)
    }

    private func scheduleSave(_ value: String) {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            session.uploads?.setNote(item.localId, value)
        }
    }

    private func flush() {
        saveTask?.cancel()
        if note != (item.note ?? "") { session.uploads?.setNote(item.localId, note) }
    }

    private func toggleDictation() {
        if isDictating {
            dictation.stop()
            return
        }
        focused = false
        dictation.start(id: item.localId, prefix: note, onText: { note = $0 }, onBegin: onDictationBegin, onEnd: {
            flush()
            onDictationEnd()
        })
    }
}
