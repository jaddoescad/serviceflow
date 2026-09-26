import ServiceFlowCore
import SwiftUI

extension View {
    /// Asks "What slowed it down?" after a clock-out on a job that went over budget.
    func overBudgetPrompt(item: Binding<OverBudgetPromptItem?>) -> some View {
        modifier(OverBudgetPromptModifier(item: item))
    }
}

private struct OverBudgetPromptModifier: ViewModifier {
    @Binding var item: OverBudgetPromptItem?

    func body(content: Content) -> some View {
        content.fullScreenCover(item: $item) { prompt in
            OverBudgetSheet(item: prompt) { item = nil }
                .presentationBackground(.clear)
        }
        .transaction { transaction in
            // The sheet fades in itself instead of sliding up.
            if item != nil { transaction.disablesAnimations = true }
        }
    }
}

/// The reason card shown over a dimmed backdrop.
struct OverBudgetSheet: View {
    struct Reason: Identifiable {
        var id: String
        var label: String
        var icon: String
    }

    static let reasons: [Reason] = [
        Reason(id: "budget_unrealistic", label: "The budget was too tight", icon: "hourglass"),
        Reason(id: "extra_prep", label: "Extra prep or repairs", icon: "wrench.and.screwdriver"),
        Reason(id: "moving_furniture", label: "Moving furniture or covering", icon: "shippingbox"),
        Reason(id: "waiting", label: "Waiting on materials or client", icon: "pause.circle"),
        Reason(id: "other", label: "Something else", icon: "ellipsis.bubble"),
    ]

    let item: OverBudgetPromptItem
    let onClose: () -> Void

    @Environment(SessionContext.self) private var session
    @State private var selected: String?
    @State private var note = ""
    @State private var saving = false
    @State private var visible = false
    @FocusState private var noteFocused: Bool

    private let teal = Palette.teal
    private let warning = Color(hex: 0xb56025)

    private var canSend: Bool {
        guard let selected, !saving else { return false }
        return selected != "other" || !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ZStack {
            Color(rgba: 17, 32, 29, 0.45).ignoresSafeArea()
            card
                .padding(.horizontal, 24)
                .padding(.top, 10)
                .padding(.bottom, 10)
        }
        .opacity(visible ? 1 : 0)
        .onAppear { withAnimation(.easeOut(duration: 0.2)) { visible = true } }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 5) {
                        Image(systemName: "exclamationmark.circle.fill").font(.system(size: 15)).foregroundStyle(warning)
                        Text(item.hoursOver > 0 ? "\(HoursFormat.task(item.hoursOver)) over budget" : "Over budget")
                            .text(11.5, .black, warning).monospacedDigit()
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color(hex: 0xfbf1e8), in: Capsule())

                    Text("\(item.projectName) took longer than planned")
                        .text(16, .black, Palette.ink, tracking: -0.2)
                        .lineSpacing(5)
                        .lineLimit(2)
                        .padding(.top, 10)
                    Text("What slowed it down? This helps us quote the next job better — it is not a performance review.")
                        .text(12.5, .regular, Palette.muted)
                        .lineSpacing(4)
                        .padding(.top, 5)

                    VStack(spacing: 8) {
                        ForEach(Self.reasons) { reason in option(reason) }
                    }
                    .padding(.top, 13)

                    if selected == "other" {
                        TextField("", text: $note, prompt: Text("Tell us what happened…").foregroundColor(Palette.muted), axis: .vertical)
                            .font(.app(13.5))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(3...6)
                            .focused($noteFocused)
                            .frame(minHeight: 68, alignment: .topLeading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.border, lineWidth: 1.5))
                            .disabled(saving)
                            .onChange(of: note) { _, value in if value.count > 280 { note = String(value.prefix(280)) } }
                            .onAppear { noteFocused = true }
                            .padding(.top, 8)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)

            HStack(spacing: 10) {
                Spacer()
                Button { finish(reason: nil) } label: {
                    Text("Skip").text(13.5, .heavy, Palette.muted).padding(.horizontal, 14).padding(.vertical, 10)
                }
                .buttonStyle(.plain)
                .disabled(saving)
                Button { finish(reason: selected) } label: {
                    ZStack {
                        if saving { Spinner(color: .white) } else { Text("Send").text(13.5, .black, .white) }
                    }
                    .frame(minWidth: 84)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(teal, in: RoundedRectangle(cornerRadius: 10))
                    .opacity(canSend || saving ? 1 : 0.45)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel("Send reason")
            }
            .padding(.top, 14)
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 14)
        .frame(maxWidth: 380)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func option(_ reason: Reason) -> some View {
        let isSelected = selected == reason.id
        return Button {
            selected = isSelected ? nil : reason.id
        } label: {
            HStack(spacing: 10) {
                Image(systemName: reason.icon).font(.system(size: 15)).foregroundStyle(isSelected ? teal : Palette.muted)
                    .frame(width: 18)
                Text(reason.label).text(13.5, .bold, isSelected ? teal : Palette.ink).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 17)).foregroundStyle(isSelected ? teal : Palette.border)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(isSelected ? Color(hex: 0xf2f9f7) : .clear, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(isSelected ? Color(hex: 0xb9d6cd) : Palette.border, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .disabled(saving)
    }

    private func finish(reason: String?) {
        saving = reason != nil
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            await session.answerOverBudget(jobId: item.jobId, reason: reason,
                                           note: trimmed.isEmpty ? nil : String(trimmed.prefix(280)),
                                           hoursOver: item.hoursOver)
            saving = false
            withAnimation(.easeIn(duration: 0.15)) { visible = false }
            try? await Task.sleep(nanoseconds: 150_000_000)
            onClose()
        }
    }
}
