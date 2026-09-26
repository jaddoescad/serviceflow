import Combine
import ServiceFlowCore
import SwiftUI

/// The signed-in person's own time: three Monday–Sunday weeks, each day of
/// the week shown (missing days in red), with a day detail and an editor.
/// Navigation (list → day → edit) is local state, so it survives tab switches.
struct TimesheetScreen: View {
    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker

    @State private var now = Date()
    @State private var periodId: String?
    @State private var openDayId: String?
    @State private var editingEntryId: String?
    @State private var showingPeriods = false

    init() {}

    private var periods: [PayPeriod] { PayPeriod.recent(now: now) }

    private var selectedIndex: Int {
        periods.firstIndex { $0.id == periodId } ?? 0
    }

    private var period: PayPeriod? { periods.indices.contains(selectedIndex) ? periods[selectedIndex] : nil }

    private var days: [TimesheetDay] {
        guard let period else { return [] }
        return TimesheetBuilder.days(for: period, entries: tracker.allEntries, now: now)
    }

    var body: some View {
        ZStack {
            TimesheetColors.bg.ignoresSafeArea(edges: .top)
            content
        }
        .overlay {
            if showingPeriods {
                TimesheetPeriodSheet(periods: periods, selectedId: period?.id) { chosen in
                    if let chosen { periodId = chosen }
                    withAnimation(.easeIn(duration: 0.18)) { showingPeriods = false }
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

    @ViewBuilder
    private var content: some View {
        if let dayId = openDayId, let day = days.first(where: { $0.id == dayId }) ?? outOfPeriodDay(dayId) {
            if let entryId = editingEntryId, let entry = day.entries.first(where: { $0.localId == entryId }) {
                TimesheetEditTimeView(
                    entry: entry,
                    day: day,
                    painterName: session.displayName,
                    onBack: { navigate { editingEntryId = nil } },
                    onFinished: { navigate { editingEntryId = nil; openDayId = nil } }
                )
                .transition(.move(edge: .trailing))
            } else {
                TimesheetDayDetailView(
                    day: day,
                    now: now,
                    onBack: { navigate { openDayId = nil } },
                    onSelect: { entry in navigate { editingEntryId = entry.localId } }
                )
                .transition(.move(edge: .trailing))
            }
        } else {
            list.transition(.move(edge: .leading))
        }
    }

    /// A day that fell out of the selected period (e.g. after a week rollover).
    private func outOfPeriodDay(_ id: String) -> TimesheetDay? {
        for candidate in periods {
            if let found = TimesheetBuilder.days(for: candidate, entries: tracker.allEntries, now: now).first(where: { $0.id == id }),
               found.isWorked {
                return found
            }
        }
        return nil
    }

    private func navigate(_ change: () -> Void) {
        withAnimation(.easeInOut(duration: 0.25)) { change() }
    }

    // MARK: List

    private var list: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.22)) { showingPeriods = true }
            } label: {
                HStack(spacing: 6) {
                    Text(period?.label ?? "").text(15.5, .bold, TimesheetColors.ink)
                    Image(systemName: "chevron.down").font(.system(size: 14, weight: .bold)).foregroundStyle(TimesheetColors.ink)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 18)
                .padding(.top, 14)
                .padding(.bottom, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Select pay period, currently \(period?.label ?? "")")

            summaryCard
                .padding(.horizontal, 16)
                .padding(.top, 2)

            HStack {
                TimesheetSectionLabel(text: ["This Week", "Last Week", "2 Weeks Ago"][min(selectedIndex, 2)])
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 10)

            ScrollView(showsIndicators: false) {
                timeline
                    .padding(.horizontal, 16)
                    .padding(.bottom, 36)
            }
            .refreshable { await tracker.refresh() }
        }
    }

    private var summaryCard: some View {
        let total = TimesheetBuilder.weekTotalMinutes(days)
        let jobs = Set(days.flatMap(\.entries).map(\.project.id)).count
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
                stat("\(TimesheetBuilder.daysWorked(days))", "Days")
                divider
                stat("\(jobs)", "Jobs")
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

    private var timeline: some View {
        VStack(spacing: 12) {
            ForEach(days) { day in
                TimesheetDayRow(day: day) {
                    navigate { openDayId = day.id }
                }
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

/// One day on the timeline: date, marker and card.
struct TimesheetDayRow: View {
    var day: TimesheetDay
    var onOpen: () -> Void

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
                    Button(action: onOpen) { workedCard }.buttonStyle(.pressable(opacity: 0.85))
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
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .semibold)).foregroundStyle(TimesheetColors.muted)
            }
            TimesheetFlowLayout(spacing: 6) {
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

            TimesheetFlowLayout(spacing: 16) {
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

/// Wraps children onto new lines (job pills, meta items).
struct TimesheetFlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + size.width > width {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: proposal.width ?? maxX, height: subviews.isEmpty ? 0 : y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}

/// "Select Pay Period" bottom sheet: tap the backdrop to close, no drag.
struct TimesheetPeriodSheet: View {
    var periods: [PayPeriod]
    var selectedId: String?
    /// Called with the chosen period id, or nil when dismissed.
    var onClose: (String?) -> Void

    @State private var shown = false

    var body: some View {
        ZStack(alignment: .bottom) {
            TimesheetColors.backdrop
                .ignoresSafeArea()
                .opacity(shown ? 1 : 0)
                .onTapGesture { close(nil) }

            VStack(alignment: .leading, spacing: 0) {
                Capsule().fill(TimesheetColors.grabber).frame(width: 40, height: 4)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 12)
                Text("Select Pay Period").text(16, .black, TimesheetColors.ink)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 10)
                ForEach(periods) { period in
                    let selected = period.id == selectedId
                    Button { close(period.id) } label: {
                        HStack {
                            Text(period.label).text(14.5, selected ? .heavy : .bold, selected ? TimesheetColors.tealInk : TimesheetColors.ink)
                            Spacer()
                            if selected {
                                Image(systemName: "checkmark.circle.fill").font(.system(size: 20)).foregroundStyle(TimesheetColors.teal)
                            } else {
                                Circle().strokeBorder(TimesheetColors.border, lineWidth: 1.5).frame(width: 22, height: 22)
                            }
                        }
                        .padding(14)
                        .background(selected ? TimesheetColors.tealSoft : .clear, in: RoundedRectangle(cornerRadius: 12))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 6)
                    .accessibilityLabel(period.label)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
                Color.clear.frame(height: 28)
            }
            .padding(.top, 8)
            .padding(.horizontal, 16)
            .background(
                UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20)
                    .fill(TimesheetColors.surface)
                    .ignoresSafeArea(edges: .bottom)
            )
            .offset(y: shown ? 0 : 400)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.22)) { shown = true }
        }
    }

    private func close(_ id: String?) {
        withAnimation(.easeIn(duration: 0.18)) { shown = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { onClose(id) }
    }
}
