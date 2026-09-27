import ServiceFlowCore
import SwiftUI

extension View {
    /// Asks "What slowed it down?" after a clock-out on a job that went over budget.
    func overBudgetPrompt(item: Binding<OverBudgetPromptItem?>) -> some View {
        sheet(item: item) { prompt in
            OverBudgetSheet(item: prompt) { item.wrappedValue = nil }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

/// The reasons sheet. Dragging it away counts as Skip.
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
    @State private var answered = false
    @FocusState private var noteFocused: Bool

    private let warning = Color(hex: 0xb56025)

    private var canSend: Bool {
        guard let selected, !saving else { return false }
        return selected != "other" || !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(item.hoursOver > 0 ? "\(HoursFormat.task(item.hoursOver)) over budget" : "Over budget",
                              systemImage: "exclamationmark.circle.fill")
                            .font(.app(13, .semibold))
                            .foregroundStyle(warning)
                        Text("\(item.projectName) took longer than planned")
                            .font(.app(17, .semibold))
                        Text("What slowed it down? This helps us quote the next job better — it is not a performance review.")
                            .font(.app(14))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section("Reason") {
                    ForEach(Self.reasons) { reason in
                        Button {
                            selected = selected == reason.id ? nil : reason.id
                            if selected == "other" { noteFocused = true }
                        } label: {
                            HStack {
                                Label(reason.label, systemImage: reason.icon).foregroundStyle(.primary)
                                Spacer()
                                if selected == reason.id {
                                    Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(Palette.teal)
                                }
                            }
                        }
                        .disabled(saving)
                    }
                }

                if selected == "other" {
                    Section("What happened") {
                        TextField("Tell us what happened…", text: $note, axis: .vertical)
                            .lineLimit(3...6)
                            .focused($noteFocused)
                            .disabled(saving)
                            .onChange(of: note) { _, value in if value.count > 280 { note = String(value.prefix(280)) } }
                    }
                }
            }
            .navigationTitle("Over budget")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Skip") { finish(reason: nil) }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Send") { finish(reason: selected) }
                            .disabled(!canSend)
                            .accessibilityLabel("Send reason")
                    }
                }
            }
        }
        .tint(Palette.teal)
        .interactiveDismissDisabled(saving)
        .onDisappear {
            // Swiped away without answering: remember it was asked, like Skip.
            guard !answered else { return }
            answered = true
            Task { await session.answerOverBudget(jobId: item.jobId, reason: nil, note: nil, hoursOver: item.hoursOver) }
        }
    }

    private func finish(reason: String?) {
        guard !answered else { return }
        answered = true
        saving = reason != nil
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            await session.answerOverBudget(jobId: item.jobId, reason: reason,
                                           note: trimmed.isEmpty ? nil : String(trimmed.prefix(280)),
                                           hoursOver: item.hoursOver)
            saving = false
            onClose()
        }
    }
}
