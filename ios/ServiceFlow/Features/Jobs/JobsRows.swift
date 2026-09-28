import ServiceFlowCore
import SwiftUI

/// The job you're clocked into (shown on a teal row).
struct JobsCurrentCard: View {
    var project: Project
    var onSite: Bool?
    var myTime: TimeInterval?

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "mappin")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(Palette.green, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Label(onSite == false ? "Off site" : "Clocked in", systemImage: "circle.fill")
                    .labelStyle(JobsDotLabelStyle())
                    .font(.app(12, .semibold))
                    .foregroundStyle(Color.white.opacity(0.85))
                Text(project.name).font(.app(17, .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(project.cardAddress ?? "No address on file")
                    .font(.app(13)).foregroundStyle(Color.white.opacity(0.82)).lineLimit(1)
                BudgetProgressBadge(progress: project.budget, dark: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let myTime {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(DurationFormat.hoursMinutes(myTime)).font(.app(20, .bold)).foregroundStyle(.white).monospacedDigit()
                    Text("Your hours").font(.app(11, .medium)).foregroundStyle(Color.white.opacity(0.82))
                }
            }
        }
        .padding(.vertical, 6)
    }
}

/// A small coloured dot before the label text.
private struct JobsDotLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 7)).foregroundStyle(Color(hex: 0xa9f1c4))
            configuration.title
        }
    }
}

/// One job or lead in the list.
struct JobsRow: View {
    var project: Project
    var myTime: TimeInterval?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mappin")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Palette.teal)
                .frame(width: 42, height: 42)
                .background(Palette.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(.app(16, .semibold)).foregroundStyle(.primary).lineLimit(1)
                Text(project.cardAddress ?? "No address on file")
                    .font(.app(13)).foregroundStyle(.secondary).lineLimit(1)
                if project.isLead {
                    Text("Lead · \(project.leadStageLabel)")
                        .font(.app(11, .semibold))
                        .foregroundStyle(Palette.teal)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Palette.teal.opacity(0.12), in: Capsule())
                        .padding(.top, 4)
                } else {
                    BudgetProgressBadge(progress: project.budget, dark: false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let myTime {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(DurationFormat.hoursMinutes(myTime)).font(.app(15, .semibold)).foregroundStyle(Palette.green).monospacedDigit()
                    Text("Your hours").font(.app(11)).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
