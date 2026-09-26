import ServiceFlowCore
import SwiftUI

/// An SF Symbol at an RN point size (Ionicons sizes are glyph heights).
struct Icon: View {
    var name: String
    var size: CGFloat
    var color: Color

    init(_ name: String, _ size: CGFloat, _ color: Color) {
        self.name = name
        self.size = size
        self.color = color
    }

    var body: some View {
        Image(systemName: name)
            .font(.system(size: size * 0.82, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
    }
}

/// A small spinner in a given colour.
struct Spinner: View {
    var color: Color
    var body: some View {
        ProgressView().controlSize(.small).tint(color)
    }
}

extension View {
    /// White card with a 1pt border.
    func bordered(_ radius: CGFloat, border: Color = Palette.border, background: Color = .white, width: CGFloat = 1) -> some View {
        self
            .background(background, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(border, lineWidth: width))
    }

    /// Hides the keyboard.
    func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

/// Debounces a search string: `committed` follows `text` 250 ms after typing stops.
@MainActor
@Observable
final class Debouncer {
    var text = "" {
        didSet { schedule() }
    }
    private(set) var committed = ""
    @ObservationIgnored private var task: Task<Void, Never>?
    let delay: TimeInterval

    init(delay: TimeInterval = 0.25) {
        self.delay = delay
    }

    var isPending: Bool { text.trimmingCharacters(in: .whitespaces) != committed }

    func clear() {
        task?.cancel()
        text = ""
        committed = ""
    }

    private func schedule() {
        task?.cancel()
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            committed = ""
            return
        }
        task = Task { [weak self, delay] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.committed = value
        }
    }
}

/// The job over-budget question, shown after clocking out.
struct OverBudgetPromptItem: Identifiable, Equatable {
    var id: String { jobId }
    var jobId: String
    var projectName: String
    var hoursOver: Double
}

/// `Uploading 2 items…` / `1 upload failed: reason. Tap to retry.`
enum UploadCopy {
    static func uploading(_ count: Int) -> String {
        "Uploading \(count) \(count == 1 ? "item" : "items")…"
    }

    static func failed(_ count: Int, reason: String?) -> String {
        let noun = count == 1 ? "upload" : "uploads"
        if let reason, !reason.isEmpty { return "\(count) \(noun) failed: \(reason). Tap to retry." }
        return "\(count) \(noun) failed. Tap to retry."
    }
}

/// A 12-segment budget bar.
struct BudgetTank: View {
    var percent: Double?
    var color: Color

    var body: some View {
        let lit = BudgetHoursBreakdown.litSegments(percent: percent)
        HStack(spacing: 3) {
            ForEach(0..<12, id: \.self) { index in
                RoundedRectangle(cornerRadius: 3)
                    .fill(index < lit ? color : Color(hex: 0xe6eae9))
                    .frame(height: 12)
            }
        }
        .padding(.top, 8)
    }
}
