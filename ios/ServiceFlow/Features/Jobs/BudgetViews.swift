import ServiceFlowCore
import SwiftUI

/// Hours left (or over) on list rows and the current-job card. Shows nothing
/// until the job has a budget and some hours.
struct BudgetProgressBadge: View {
    var progress: BudgetProgress?
    var dark: Bool

    init(progress: BudgetProgress?, dark: Bool) {
        self.progress = progress
        self.dark = dark
    }

    var body: some View {
        let breakdown = BudgetHoursBreakdown(progress)
        if breakdown.derivable, let left = breakdown.leftLabel {
            let presentation = BudgetPresentation(progress)
            let color: Color = dark
                ? (breakdown.isOver ? Color(hex: 0xffb3a1) : Color.white.opacity(0.9))
                : Color(hex: presentation.colorHex)
            let fill: Color = dark
                ? (breakdown.isOver ? Color(hex: 0xffb3a1) : Color(hex: 0xa9f1c4))
                : Color(hex: presentation.colorHex)
            HStack(spacing: 7) {
                Capsule()
                    .fill(dark ? Color.white.opacity(0.25) : Color(hex: 0xe5e9e8))
                    .frame(width: 40, height: 5)
                    .overlay(alignment: .leading) {
                        Capsule().fill(fill).frame(width: 40 * min(1, max(0, presentation.fillPercent / 100)), height: 5)
                    }
                Text(breakdown.isOver ? "\(left) over budget" : "\(left) left")
                    .text(12, .heavy, color)
                    .lineLimit(1)
            }
            .padding(.top, 8)
        }
    }
}

/// The "Job hours" card on Project Detail.
struct BudgetHoursPanel: View {
    var progress: BudgetProgress?
    var loading: Bool
    var yourHours: String
    var secondaryLabel: String
    var secondaryValue: String

    init(progress: BudgetProgress?, loading: Bool, yourHours: String, secondaryLabel: String, secondaryValue: String) {
        self.progress = progress
        self.loading = loading
        self.yourHours = yourHours
        self.secondaryLabel = secondaryLabel
        self.secondaryValue = secondaryValue
    }

    var body: some View {
        let breakdown = BudgetHoursBreakdown(progress)
        let presentation = BudgetPresentation(progress)
        let burn = Color(hex: presentation.burnHex)
        let showsLoading = progress == nil && loading
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text("Job hours").text(13, .black, Palette.ink)
                Spacer(minLength: 0)
                if breakdown.tracked {
                    Text(presentation.statusLabel)
                        .text(11, .black, burn)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(Color(hex: presentation.backgroundHex), in: Capsule())
                }
            }
            HStack(alignment: .top, spacing: 0) {
                column("Your hours", yourHours, caption: "you")
                divider
                if breakdown.derivable {
                    column("Hours used", breakdown.usedLabel ?? "0h", caption: "whole team")
                    divider
                    column(breakdown.isOver ? "Hours over" : "Hours left", breakdown.leftLabel ?? "—",
                           valueColor: burn,
                           caption: breakdown.isOver ? "over budget" : "in the budget",
                           captionColor: breakdown.isOver ? burn : Color(hex: 0xaeb7b3),
                           captionWeight: breakdown.isOver ? .heavy : .bold)
                } else {
                    column(secondaryLabel, breakdown.usedLabel ?? secondaryValue,
                           caption: breakdown.usedLabel == nil ? nil : "whole team")
                }
            }
            .padding(.top, 11)
            .padding(.bottom, 2)
            if breakdown.tracked || showsLoading {
                BudgetTank(percent: breakdown.percentUsed, color: burn)
                Text(breakdown.footnote(loading: showsLoading))
                    .text(11.5, .bold, Palette.muted)
                    .padding(.top, 8)
            }
        }
    }

    private var divider: some View {
        Rectangle().fill(Color(hex: 0xe2e7e8)).frame(width: 1).padding(.horizontal, 12)
    }

    private func column(_ label: String, _ value: String, valueColor: Color = Palette.ink, caption: String?,
                        captionColor: Color = Color(hex: 0xaeb7b3), captionWeight: Font.Weight = .bold) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).text(11, .heavy, Palette.muted).lineLimit(1)
            Text(value).text(20, .black, valueColor, tracking: -0.4).lineLimit(1).minimumScaleFactor(0.7)
            if let caption {
                Text(caption).text(10.5, captionWeight, captionColor).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Hours used against the budget, above the Clock In screen's task list.
struct BudgetBurnMeter: View {
    var progress: BudgetProgress?

    init(progress: BudgetProgress?) {
        self.progress = progress
    }

    var body: some View {
        let breakdown = BudgetHoursBreakdown(progress)
        let burn = Color(hex: BudgetPresentation(progress).burnHex)
        if progress == nil {
            VStack(alignment: .leading, spacing: 0) {
                (Text("–").font(.app(20, .black)).foregroundColor(Palette.ink)
                    + Text(" used").font(.app(12.5, .bold)).foregroundColor(Palette.muted))
                    .padding(.bottom, 8)
                BudgetTank(percent: nil, color: burn)
                Text("Loading budget…").text(11.5, .bold, Palette.muted).padding(.top, 8)
            }
        } else if breakdown.tracked {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    (Text(breakdown.usedLabel ?? "0h").font(.app(20, .black)).foregroundColor(Palette.ink).monospacedDigit()
                        + Text(" used").font(.app(12.5, .bold)).foregroundColor(Palette.muted))
                    Spacer(minLength: 8)
                    if breakdown.derivable, let left = breakdown.leftLabel {
                        Text(breakdown.isOver ? "\(left) over budget" : "\(left) left")
                            .text(12.5, .black, burn)
                            .lineLimit(1)
                    }
                }
                .padding(.bottom, 8)
                BudgetTank(percent: breakdown.percentUsed, color: burn)
                Text(breakdown.footnote(loading: false)).text(11.5, .bold, Palette.muted).padding(.top, 8)
            }
        }
    }
}
