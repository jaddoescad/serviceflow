import ServiceFlowCore
import SwiftUI

/// One day's clock-ins with on-site / off-site totals.
struct TimesheetDayDetailView: View {
    var day: TimesheetDay
    var now: Date

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                summaryCard
                HStack(spacing: 8) {
                    TimesheetSectionLabel(text: "Clock-ins")
                    Text("\(day.entries.count)").text(12, .bold, TimesheetColors.muted)
                }
                .padding(.top, 22)
                .padding(.bottom, 10)

                LazyVStack(spacing: 10) {
                    ForEach(day.entries) { entry in
                        NavigationLink(value: TimesheetRoute.edit(dayId: day.id, entryId: entry.localId)) {
                            TimesheetEntryCard(info: TimesheetEntryInfo(entry, now: now))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 40)
        }
        .background(TimesheetColors.bg)
        .navigationTitle("\(day.weekday), \(day.fullDate())")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("TOTAL TIME").text(11, .black, TimesheetColors.teal, tracking: 0.8)
            Text(day.total).text(28, .black, TimesheetColors.ink, tracking: -0.8).padding(.top, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("mappin", TimesheetColors.teal, "\(DurationFormat.hoursMinutes(minutes: day.onSiteMinutes)) on site",
                         TimesheetColors.tealSoft, TimesheetColors.tealInk)
                    chip("car.fill", TimesheetColors.inkSoft, "\(DurationFormat.hoursMinutes(minutes: day.offSiteMinutes)) off site",
                         TimesheetColors.greySoft, TimesheetColors.inkSoft)
                    if day.unknownMinutes > 0 {
                        chip("questionmark.circle", TimesheetColors.inkSoft,
                             "\(DurationFormat.hoursMinutes(minutes: day.unknownMinutes)) not recorded",
                             TimesheetColors.greySoft, TimesheetColors.inkSoft)
                    }
                }
            }
            .padding(.top, 12)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .bordered(16, border: TimesheetColors.border, background: TimesheetColors.surface)
    }

    private func chip(_ icon: String, _ iconColor: Color, _ text: String, _ background: Color, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(iconColor)
            Text(text).text(12.5, .heavy, color).lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(background, in: Capsule())
    }
}

/// A clock-in card on the day screen.
struct TimesheetEntryCard: View {
    var info: TimesheetEntryInfo

    var body: some View {
        let style = TimesheetStatusStyle(info.summary.status)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: style.icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(style.circle, in: Circle())
                VStack(alignment: .leading, spacing: 1) {
                    Text(info.job).text(14.5, .black, TimesheetColors.ink, tracking: -0.2).lineLimit(1)
                    Text(info.address).text(12, .semibold, TimesheetColors.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(info.duration).text(14.5, .black, TimesheetColors.ink)
            }

            Rectangle().fill(TimesheetColors.divider).frame(height: 1).padding(.vertical, 11)

            HStack(spacing: 0) {
                time("IN", info.start, info.startSource)
                Image(systemName: "arrow.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(TimesheetColors.muted)
                    .padding(.horizontal, 8)
                time("OUT", info.end, info.endSource)
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(.tertiary)
                    .padding(.leading, 8)
            }

            HStack(spacing: 6) {
                Circle().fill(style.dot).frame(width: 6, height: 6)
                Text(info.statusLine).text(11.5, .heavy, style.text).lineLimit(1)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(style.pill, in: Capsule())
            .padding(.top, 11)

            if info.summary.status == .mixed {
                HStack(spacing: 6) {
                    Text("On site \(DurationFormat.hoursMinutes(info.summary.onSite))").text(11.5, .bold, TimesheetColors.muted)
                    Text("·").text(12, .black, TimesheetColors.border)
                    Text("Off site \(DurationFormat.hoursMinutes(info.summary.offSite))").text(11.5, .bold, TimesheetColors.muted)
                }
                .padding(.top, 10)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .bordered(14, border: TimesheetColors.border, background: TimesheetColors.surface)
        .contentShape(Rectangle())
    }

    private func time(_ label: String, _ value: String, _ source: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).text(10.5, .heavy, TimesheetColors.muted, tracking: 0.6)
            Text(value).text(14.5, .black, TimesheetColors.ink, tracking: -0.2).padding(.top, 2).lineLimit(1)
            Text(source).text(11, .bold, TimesheetColors.muted).padding(.top, 1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
