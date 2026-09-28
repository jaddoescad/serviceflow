import ServiceFlowCore
import SwiftUI

private let ink = Color(hex: 0x11201d)
private let fieldBorder = Color(hex: 0xe1e4e3)

/// One capture in the drawer: thumbnail, note field with dictation, and the
/// markup button. The note is the capture's description; the photo editor
/// edits the same value.
struct CameraCaptureRow: View {
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

    private var isPhoto: Bool { item.kind == .image }
    private var isDictating: Bool { dictation.activeId == item.localId }

    var body: some View {
        HStack(spacing: 12) {
            Button(action: isPhoto ? edit : onView) {
                CameraCaptureThumbnail(item: item)
            }
            .buttonStyle(.pressable(opacity: 0.8))
            .accessibilityLabel(isPhoto ? "Edit photo" : "Play video")

            noteField

            if isPhoto {
                Button(action: edit) {
                    Image(systemName: "scribble")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(ink)
                        .frame(width: 54, height: 54)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(fieldBorder, lineWidth: 1))
                }
                .buttonStyle(.pressable(opacity: 0.8))
                .accessibilityLabel("Mark up photo")
            }
        }
        .onAppear { note = item.note ?? "" }
        // The editor may have changed the description; follow it unless the
        // person is typing or dictating here.
        .onChange(of: item.note) { _, value in
            if !focused, !isDictating, let value, value != note { note = value }
        }
        .onDisappear(perform: saveNow)
    }

    private var noteField: some View {
        HStack(alignment: .center, spacing: 6) {
            TextField("Add notes…", text: $note, axis: .vertical)
                .font(.body)
                .foregroundStyle(ink)
                .lineLimit(1...4)
                .focused($focused)
                .submitLabel(.done)
                .onChange(of: note) { _, value in saveSoon(value) }
            Button(action: toggleDictation) {
                Image(systemName: isDictating ? "mic.fill" : "mic")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(isDictating ? Color(hex: 0xd92d20) : ink)
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
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(fieldBorder, lineWidth: 1))
    }

    /// Saves what's typed first, so the editor opens with the latest note.
    private func edit() {
        focused = false
        saveNow()
        onEdit()
    }

    /// Typing saves after a short pause rather than on every keystroke.
    private func saveSoon(_ value: String) {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            session.uploads?.setNote(item.localId, value)
        }
    }

    private func saveNow() {
        saveTask?.cancel()
        if note != (item.note ?? "") { session.uploads?.setNote(item.localId, note) }
    }

    private func toggleDictation() {
        if isDictating { return dictation.stop() }
        focused = false
        dictation.start(id: item.localId, prefix: note, onText: { note = $0 }, onBegin: onDictationBegin, onEnd: {
            saveNow()
            onDictationEnd()
        })
    }
}

/// A square thumbnail of a capture with its drawings on top.
struct CameraCaptureThumbnail: View {
    let item: PendingUpload

    @Environment(SessionContext.self) private var session
    private static let side: CGFloat = 64

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(hex: 0xdfe6e4))
            if let url = imageURL {
                MediaAsyncImage(url: url, downsampleTo: Self.side)
                    .frame(width: Self.side, height: Self.side)
            }
            if let document = item.annotations, !document.isEmpty {
                drawings(document)
            }
            if item.kind == .video {
                Image(systemName: "play.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 20, height: 20)
                    .background(Color(rgba: 8, 15, 18, 0.7), in: Circle())
                    .padding(5)
            }
        }
        .frame(width: Self.side, height: Self.side)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var imageURL: URL? {
        guard let uploads = session.uploads else { return nil }
        return item.kind == .video ? uploads.posterURL(for: item) : uploads.fileURL(for: item)
    }

    /// Drawings are stored relative to the whole photo, so they're drawn over
    /// the photo's aspect-filled frame (larger than the square) and clipped.
    private func drawings(_ document: AnnotationDocument) -> some View {
        let aspect = CGFloat(item.width ?? 3) / CGFloat(max(item.height ?? 4, 1))
        let filled = aspect >= 1
            ? CGSize(width: Self.side * aspect, height: Self.side)
            : CGSize(width: Self.side, height: Self.side / max(aspect, 0.01))
        return AnnotationOverlay(document: document)
            .frame(width: filled.width, height: filled.height)
            .frame(width: Self.side, height: Self.side)
    }
}
