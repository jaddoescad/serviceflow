import Combine
import ServiceFlowCore
import SwiftUI

/// Pushed screens of the Timesheet tab.
enum TimesheetRoute: Hashable {
    case day(String)
    case edit(dayId: String, entryId: String)
}

/// The signed-in person's own time: three Monday–Sunday weeks, each day of
/// the week since account creation shown (missing days in red). Days and edits are pushed on the
/// tab's navigation stack.
struct TimesheetScreen: View {
    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker

    @State private var now = Date()
    @State private var periodId: String?

    init() {}

    private var periods: [PayPeriod] { PayPeriod.recent(now: now) }

    private var selectedIndex: Int {
        periods.firstIndex { $0.id == periodId } ?? 0
    }

    private static let sectionTitles = ["This Week", "Last Week", "2 Weeks Ago"]

    var body: some View {
        // Built once per render; the summary and the timeline share it.
        let periods = self.periods
        let index = selectedIndex
        let period = periods.indices.contains(index) ? periods[index] : nil
        let days = period.map { TimesheetBuilder.days(for: $0, entries: tracker.allEntries, now: now, accountCreatedAt: session.accountCreatedAt) } ?? []
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                summaryCard(days)
                    .padding(.top, 4)

                HStack(alignment: .firstTextBaseline) {
                    TimesheetSectionLabel(text: Self.sectionTitles[min(index, Self.sectionTitles.count - 1)])
                    Spacer()
                    Text(period?.label ?? "").text(12, .semibold, TimesheetColors.muted)
                }
                .padding(.top, 22)
                .padding(.bottom, 10)

                timeline(days)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 36)
        }
        .background(TimesheetColors.bg)
        .refreshable { await tracker.refresh() }
        .navigationTitle("Timesheet")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { periodMenu(periods, selected: period) }
        }
        .navigationDestination(for: TimesheetRoute.self) { route in
            switch route {
            case .day(let dayId):
                if let day = day(dayId, in: periods) {
                    TimesheetDayDetailView(day: day, now: now)
                } else {
                    ContentUnavailableView("No clock-ins", systemImage: "clock", description: Text("This day has no time logged."))
                }
            case let .edit(dayId, entryId):
                if let day = day(dayId, in: periods), let entry = day.entries.first(where: { $0.localId == entryId }) {
                    TimesheetEditTimeView(entry: entry, day: day, painterName: session.displayName) {
                        session.paths[.timesheet] = NavigationPath()
                    }
                } else {
                    ContentUnavailableView("Clock-in not found", systemImage: "clock.badge.questionmark",
                                           description: Text("It may have been changed or deleted."))
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged).receive(on: RunLoop.main)) { _ in
            now = Date()
            if let periodId, !periods.contains(where: { $0.id == periodId }) { self.periodId = nil }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            now = Date()
        }
        .task(id: tracker.activeShift?.localId) {
            // Keep the running shift's duration moving while it is on screen.
            now = Date()
            guard tracker.activeShift != nil else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
                now = Date()
            }
        }
    }

    /// Pay period picker in the navigation bar.
    private func periodMenu(_ periods: [PayPeriod], selected period: PayPeriod?) -> some View {
        Menu {
            Picker("Pay period", selection: Binding(get: { period?.id ?? "" }, set: { periodId = $0 })) {
                ForEach(periods) { option in
                    Text(option.label).tag(option.id)
                }
            }
            .pickerStyle(.inline)
        } label: {
            Label("Pay period", systemImage: "calendar")
        }
        .accessibilityLabel("Select pay period, currently \(period?.label ?? "")")
    }

    /// A pushed day by id, from whichever of the recent periods holds it.
    private func day(_ id: String, in periods: [PayPeriod]) -> TimesheetDay? {
        guard let period = periods.first(where: { $0.contains(dayKey: id) }) else { return nil }
        return TimesheetBuilder.days(for: period, entries: tracker.allEntries, now: now, accountCreatedAt: session.accountCreatedAt).first { $0.id == id }
    }

    // MARK: Summary

    private func summaryCard(_ days: [TimesheetDay]) -> some View {
        let total = TimesheetBuilder.weekTotalMinutes(days)
        let jobs = Set(days.flatMap(\.entries).map(\.project.id)).count
        let daysWorked = TimesheetBuilder.daysWorked(days)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(Initials.of(session.displayName, fallback: "C"))
                    .text(15, .heavy, .white, tracking: 0.4)
                    .frame(width: 44, height: 44)
                    .background(TimesheetColors.teal, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.displayName).text(16, .heavy, .white).lineLimit(1)
                    Text("Weekly Summary").text(12, .semibold, TimesheetColors.summaryLabel)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 0) {
                stat(DurationFormat.hoursMinutes(minutes: total), "Logged")
                divider
                stat("\(daysWorked)", daysWorked == 1 ? "Day" : "Days")
                divider
                stat("\(jobs)", jobs == 1 ? "Job" : "Jobs")
            }
            .padding(.vertical, 12)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
            .padding(.top, 16)
        }
        .padding(16)
        .background(TimesheetColors.green, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var divider: some View {
        Rectangle().fill(Color.white.opacity(0.18)).frame(width: 1, height: 26)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 3) {
            Text(value).text(16, .black, .white, tracking: -0.3).lineLimit(1).minimumScaleFactor(0.8)
            Text(label.uppercased()).text(11.5, .bold, TimesheetColors.summaryLabel, tracking: 0.4)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Timeline

    private func timeline(_ days: [TimesheetDay]) -> some View {
        VStack(spacing: 12) {
            ForEach(days) { day in
                TimesheetDayRow(day: day)
            }
        }
        .background(alignment: .topLeading) {
            // The vertical line behind the day markers.
            GeometryReader { proxy in
                RoundedRectangle(cornerRadius: 1)
                    .fill(TimesheetColors.border)
                    .frame(width: 2, height: max(0, proxy.size.height - 56))
                    .offset(x: 56 + 12 - 1, y: 26)
            }
        }
    }
}

/// One day on the timeline: date, marker and card. Worked days open the day.
struct TimesheetDayRow: View {
    var day: TimesheetDay

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 2) {
                Text(day.weekday).text(13.5, .heavy, TimesheetColors.ink)
                Text(day.date).text(12, .semibold, TimesheetColors.muted)
            }
            .frame(width: 56)
            .frame(maxHeight: .infinity)

            ZStack {
                Circle()
                    .fill(day.isWorked ? TimesheetColors.teal : TimesheetColors.red)
                    .overlay(Circle().strokeBorder(TimesheetColors.bg, lineWidth: 3))
                Image(systemName: day.isWorked ? "checkmark" : "exclamationmark")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(.white)
            }
            .frame(width: 22, height: 22)
            .frame(width: 24)
            .padding(.top, 18)

            Group {
                if day.isWorked {
                    NavigationLink(value: TimesheetRoute.day(day.id)) { workedCard }
                        .buttonStyle(.plain)
                } else {
                    missingCard
                }
            }
            .padding(.leading, 8)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var workedCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(day.total).text(17, .black, TimesheetColors.ink, tracking: -0.4)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(.tertiary)
            }
            WrapLayout(spacing: 6) {
                ForEach(day.jobs, id: \.self) { job in
                    HStack(spacing: 4) {
                        Image(systemName: "briefcase.fill").font(.system(size: 9)).foregroundStyle(TimesheetColors.tealInk)
                        Text(job).text(11.5, .heavy, TimesheetColors.tealInk).lineLimit(1)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(TimesheetColors.tealSoft, in: Capsule())
                }
            }
            .padding(.top, 8)

            WrapLayout(spacing: 16) {
                meta("mappin", TimesheetColors.teal, "On site ", DurationFormat.hoursMinutes(minutes: day.onSiteMinutes))
                meta("car.fill", TimesheetColors.muted, "Off site ", DurationFormat.hoursMinutes(minutes: day.offSiteMinutes))
                if day.unknownMinutes > 0 {
                    meta("questionmark.circle", TimesheetColors.muted, "Not recorded ", DurationFormat.hoursMinutes(minutes: day.unknownMinutes))
                }
            }
            .padding(.top, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { Rectangle().fill(TimesheetColors.divider).frame(height: 1) }
            .padding(.top, 10)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .bordered(12, border: TimesheetColors.border, background: TimesheetColors.surface)
        .contentShape(Rectangle())
    }

    private func meta(_ icon: String, _ color: Color, _ label: String, _ value: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(color)
            (Text(label).font(.app(12, .semibold)).foregroundColor(TimesheetColors.muted)
                + Text(value).font(.app(12, .heavy)).foregroundColor(TimesheetColors.ink))
                .lineLimit(1)
        }
    }

    private var missingCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundStyle(TimesheetColors.red)
                Text("No clock-in").text(14, .heavy, TimesheetColors.redInk)
            }
            Text("No time logged").text(12.5, .semibold, TimesheetColors.red)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .bordered(12, border: TimesheetColors.redBorder, background: TimesheetColors.redBg)
    }
}
