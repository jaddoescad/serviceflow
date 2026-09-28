import ServiceFlowCore
import SwiftUI

/// A job or lead in a list: name, address and a lead badge.
struct ProjectListRow: View {
    var project: Project

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: project.isLead ? "person.crop.circle.badge.plus" : "briefcase.fill")
                .foregroundStyle(Palette.teal)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(project.name).font(.body.weight(.semibold)).lineLimit(1)
                    if project.isLead {
                        Text("LEAD").font(.caption2.weight(.bold)).foregroundStyle(Color(hex: 0x245c9c))
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color(hex: 0xe8f1ff), in: Capsule())
                    }
                }
                Text(project.cardAddress ?? "No address on file").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}
