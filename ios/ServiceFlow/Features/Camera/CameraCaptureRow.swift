import ServiceFlowCore
import SwiftUI

private let ink = Color(hex: 0x11201d)
private let fieldBorder = Color(hex: 0xe1e4e3)

/// One drawer row: thumbnail, note field with dictation, and the markup
/// button. The note is the photo's description; the photo editor edits the
/// same value.
struct CameraCaptureRow: View {
    let entry: CameraDrawerEntry
    let dictation: CameraDictation
    /// The person may change this photo (their own, or they're a manager).
    let canEdit: Bool
    let onEdit: () -> Void
    let onView: () -> Void
    /// Stores a changed note.
    let onNote: (String) -> Void
    let onDictationBegin: () -> Void
    let onDictationEnd: () -> Void

    @State private var note = ""
    @State private var saveTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var isPhoto: Bool { entry.kind == .image }
    private var isDictating: Bool { dictation.activeId == entry.id }

    /// A shot still on the device saves as you type; a photo already on the
    /// job saves once you're done, so each edit is a single server save.
    private var savesWhileTyping: Bool {
        if case .capture = entry { return true }
        return false
    }

    var body: some View {
        HStack(spacing: 12) {
            Button(action: isPhoto && canEdit ? edit : onView) {
                CameraDrawerThumbnail(entry: entry)
            }
            .buttonStyle(.pressable(opacity: 0.8))
            .accessibilityLabel(isPhoto ? (canEdit ? "Edit photo" : "View photo") : "Play video")

            noteField
                .disabled(!canEdit)

            if isPhoto, canEdit {
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
        .onAppear { note = entry.note }
        // The editor may have changed the description; follow it unless the
        // person is typing or dictating here.
        .onChange(of: entry.note) { _, value in
            if !focused, !isDictating, value != note { note = value }
        }
        .onChange(of: focused) { _, isFocused in
            if !isFocused { saveNow() }
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
                .onChange(of: note) { _, value in if savesWhileTyping { saveSoon(value) } }
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
            onNote(value)
        }
    }

    private func saveNow() {
        saveTask?.cancel()
        if note != entry.note { onNote(note) }
    }

    private func toggleDictation() {
        if isDictating { return dictation.stop() }
        focused = false
        dictation.start(id: entry.id, prefix: note, onText: { note = $0 }, onBegin: onDictationBegin, onEnd: {
            saveNow()
            onDictationEnd()
        })
    }
}
