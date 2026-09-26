import MapKit
import ServiceFlowCore
import SwiftUI

/// Where the crew was last recorded today (managers only). Not live: points
/// come from clock-in, clock-out and while ServiceFlow is open.
struct TeamMapScreen: View {
    var enabled: Bool

    @Environment(SessionContext.self) private var session
    @State private var model = TeamMapModel()
    @State private var position: MapCameraPosition = .region(TeamMapModel.northAmerica)
    @State private var mapSelection: String?
    @State private var didInitialFit = false
    @State private var fittedSelection: String?

    init(enabled: Bool) {
        self.enabled = enabled
    }

    private struct PointsKey: Hashable {
        var enabled: Bool
        var selectedId: String?
    }

    var body: some View {
        ZStack {
            Palette.surface.ignoresSafeArea(edges: .top)
            map
            VStack(spacing: 0) {
                header.padding(.horizontal, 12).padding(.top, 12)
                Spacer(minLength: 0)
                bottomPanel
            }
        }
        .task(id: enabled) {
            guard enabled else {
                model.clearPoints()
                return
            }
            while !Task.isCancelled {
                await refreshStatuses()
                try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
            }
        }
        .task(id: PointsKey(enabled: enabled, selectedId: model.selectedId)) {
            guard enabled, model.selectedId != nil else { return }
            while !Task.isCancelled {
                await model.loadPoints(api: session.api)
                fitSelectionIfNeeded()
                try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            guard enabled else { return }
            Task { await refreshStatuses() }
        }
        .onChange(of: mapSelection) { _, id in
            guard let id else { return }
            mapSelection = nil
            if model.selectedId == nil { select(id) }
        }
    }

    // MARK: Map

    private var map: some View {
        Map(position: $position, interactionModes: [.pan, .zoom], selection: $mapSelection) {
            if let selected = model.selected {
                selectedContent(selected)
            } else {
                ForEach(model.pinned) { status in
                    if let coordinate = status.coordinate {
                        Marker(status.displayName, coordinate: teamMapCoordinate(coordinate))
                            .tint(TeamMapModel.color(for: status))
                            .tag(status.employeeId)
                    }
                }
            }
        }
        .mapStyle(.standard)
        .mapControls {}
        .ignoresSafeArea(edges: .bottom)
    }

    @MapContentBuilder
    private func selectedContent(_ status: TeamMemberStatus) -> some MapContent {
        ForEach(jobSites(for: status)) { project in
            if let coordinate = project.coordinate {
                Marker(project.name, systemImage: "briefcase.fill", coordinate: teamMapCoordinate(coordinate))
                    .tint(Palette.brown)
            }
        }
        ForEach(Array(model.points.enumerated()), id: \.element.id) { index, point in
            Annotation(DateText.time(point.capturedAt), coordinate: teamMapCoordinate(point.coordinate), anchor: .center) {
                TeamMapPointBadge(number: index + 1, eventType: point.eventType)
            }
        }
        if let coordinate = status.coordinate {
            MapCircle(center: teamMapCoordinate(coordinate), radius: max(20, status.accuracyMeters ?? 20))
                .foregroundStyle(Color(rgba: 47, 141, 127, 0.14))
                .stroke(Color(rgba: 47, 141, 127, 0.5), lineWidth: 1)
            Marker("\(status.displayName) · last seen", coordinate: teamMapCoordinate(coordinate))
                .tint(TeamMapModel.color(for: status))
        }
    }

    private func jobSites(for status: TeamMemberStatus) -> [Project] {
        let ids = Set(model.points.compactMap(\.jobId) + [status.jobId].compactMap { $0 })
        return session.mappedProjects.filter { ids.contains($0.id) && $0.coordinate != nil }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                if model.selected != nil {
                    Button { select(nil) } label: {
                        Image(systemName: "chevron.left").font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.ink)
                            .frame(width: 38, height: 38)
                            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.pressable(opacity: 0.7))
                    .accessibilityLabel("Back to team map")
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text("TEAM LOCATIONS").text(10.5, .black, Palette.teal, tracking: 1.2)
                    Text(model.selected?.displayName ?? "Today’s field map").text(22, .black, Palette.ink, tracking: -0.4).lineLimit(1)
                }
                Spacer(minLength: 0)
                Button {
                    Task {
                        await refreshStatuses()
                        if model.selectedId != nil { await model.loadPoints(api: session.api) }
                    }
                } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.teal)
                        .frame(width: 40, height: 40)
                        .background(Color(hex: 0xedf6f3), in: RoundedRectangle(cornerRadius: 13))
                }
                .buttonStyle(.pressable(opacity: 0.7))
                .accessibilityLabel("Refresh team locations")
            }
            if let selected = model.selected {
                HStack(spacing: 7) {
                    TeamMapStateDot(status: selected)
                    Text("\(model.activity(for: selected)) · \(model.lastSeen(for: selected))")
                        .text(11.5, .bold, Palette.muted).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(TeamMapText.recordCount(model.points.count)).text(11.5, .bold, Palette.muted).lineLimit(1)
                }
                .padding(.top, 7)
            } else {
                Text("Tap a crew member to see where they were recorded today.")
                    .text(12.5, .semibold, Palette.muted)
                    .padding(.top, 5)
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.96), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
        .cardShadow(opacity: 0.12, radius: 12, y: 4)
    }

    // MARK: Bottom panel

    private var bottomPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let error = model.error {
                HStack(alignment: .top, spacing: 7) {
                    Image(systemName: "exclamationmark.triangle").font(.system(size: 15)).foregroundStyle(Color(hex: 0xa45623))
                    Text(error).text(11.5, .bold, Color(hex: 0x87491e)).lineLimit(2)
                    Spacer(minLength: 0)
                }
                .padding(10)
                .background(Color(hex: 0xfff5e9), in: RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 14)
                .padding(.bottom, 10)
            }

            if model.loading && model.statuses.isEmpty {
                VStack(spacing: 10) {
                    ProgressView().tint(Palette.teal)
                    Text("Loading team locations…").text(12.5, .bold, Palette.muted)
                }
                .frame(maxWidth: .infinity, minHeight: 160)
            } else if let selected = model.selected {
                summaryGrid(selected)
            } else if model.statuses.isEmpty {
                emptyCard.frame(maxWidth: .infinity)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(model.cards) { status in
                            Button { select(status.employeeId) } label: { card(status) }
                                .buttonStyle(.pressable(opacity: 0.72))
                        }
                    }
                    .padding(.horizontal, 14)
                }
            }

            Text(TeamMapText.notLiveNote)
                .text(11, .semibold, Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.top, 12)
        }
        .padding(.top, 14)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity, minHeight: 218, alignment: .top)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous)
                .fill(Color.white.opacity(0.97))
                .overlay(
                    UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous)
                        .stroke(Palette.border, lineWidth: 1)
                        .padding(.bottom, -2)
                )
        )
    }

    private func summaryGrid(_ status: TeamMemberStatus) -> some View {
        let clockedIn = model.points.first { $0.eventType == LocationEventType.clockIn.rawValue }
        let lastSeen = model.points.last?.capturedAt ?? status.lastLocationAt
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            if model.pointsLoading && model.points.isEmpty {
                ProgressView().tint(Palette.teal).frame(maxWidth: .infinity, minHeight: 58)
            }
            cell("Clocked in", clockedIn.map { DateText.time($0.capturedAt) } ?? "—")
            cell("Last seen", lastSeen.map { DateText.time($0) } ?? "—")
            cell("Points recorded", "\(model.points.count)")
            cell("Job", status.jobName ?? "Not assigned")
        }
        .padding(.horizontal, 16)
    }

    private func cell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).text(10.5, .heavy, Palette.muted, tracking: 0.7).lineLimit(1)
            Text(value).text(13, .black, Palette.ink).lineLimit(1)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .bordered(14, border: Palette.border, background: Palette.surface)
    }

    private func card(_ status: TeamMemberStatus) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                Text(status.initials).text(12, .black, .white)
                    .frame(width: 38, height: 38)
                    .background(Palette.green, in: Circle())
                Spacer()
                TeamMapStateDot(status: status)
            }
            .padding(.bottom, 10)
            Text(status.displayName).text(14.5, .black, Palette.ink).lineLimit(1)
            Text(status.isClockedIn ? (status.jobName ?? "No active job") : "No active job")
                .text(12, .bold, Palette.muted).lineLimit(1).padding(.top, 3)
            Text(model.lastSeen(for: status))
                .text(11.5, .heavy, status.isClockedIn ? Palette.teal : Palette.muted)
                .lineLimit(1).padding(.top, 13)
            Text(model.activity(for: status)).text(11, .bold, Palette.ink).lineLimit(2).padding(.top, 4)
        }
        .padding(14)
        .frame(width: 168, alignment: .leading)
        .frame(minHeight: 174, alignment: .top)
        .bordered(18, border: Palette.border, background: Palette.surface)
    }

    private var emptyCard: some View {
        VStack(spacing: 0) {
            Image(systemName: "mappin.and.ellipse").font(.system(size: 22)).foregroundStyle(Palette.muted)
            Text("No tracking records yet").text(14, .black, Palette.ink).padding(.top, 8)
            Text("Records appear after your crew clock in with this version.")
                .text(12, .regular, Palette.muted).multilineTextAlignment(.center).padding(.top, 3)
        }
        .padding(.horizontal, 18)
        .frame(width: 290, height: 165)
        .bordered(18, border: Palette.border, background: Palette.surface)
    }

    // MARK: Actions

    private func refreshStatuses() async {
        await model.refresh(api: session.api)
        if !didInitialFit {
            didInitialFit = true
            fitOverview()
        }
    }

    private func select(_ id: String?) {
        model.select(id)
        fittedSelection = nil
        if let status = model.selected, let coordinate = status.coordinate {
            withAnimation(.easeInOut(duration: 0.3)) {
                position = .region(MKCoordinateRegion(center: teamMapCoordinate(coordinate),
                                                      span: MKCoordinateSpan(latitudeDelta: 0.025, longitudeDelta: 0.025)))
            }
        } else if id == nil {
            fitOverview()
        }
    }

    /// Fits the selected person's points once, when they first load.
    private func fitSelectionIfNeeded() {
        guard let status = model.selected, fittedSelection != status.employeeId, !model.points.isEmpty else { return }
        fittedSelection = status.employeeId
        let coordinates = model.points.map { teamMapCoordinate($0.coordinate) } + [status.coordinate].compactMap { $0.map(teamMapCoordinate) }
        if let region = TeamMapModel.region(fitting: coordinates) {
            withAnimation(.easeInOut(duration: 0.3)) { position = .region(region) }
        }
    }

    private func fitOverview() {
        let coordinates = model.pinned.compactMap(\.coordinate).map(teamMapCoordinate)
        let region: MKCoordinateRegion
        if let fitted = TeamMapModel.region(fitting: coordinates) {
            region = fitted
        } else if let coordinate = session.mappedProjects.first?.coordinate {
            region = MKCoordinateRegion(center: teamMapCoordinate(coordinate), span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18))
        } else {
            region = TeamMapModel.northAmerica
        }
        withAnimation(.easeInOut(duration: 0.3)) { position = .region(region) }
    }
}

/// Clocked in: teal. Clocked out: grey. Clocked in with no location: grey ring.
struct TeamMapStateDot: View {
    var status: TeamMemberStatus

    var body: some View {
        switch status.state {
        case .clockedIn:
            Circle().fill(Palette.teal).frame(width: 10, height: 10)
        case .clockedOut:
            Circle().fill(Palette.muted).frame(width: 10, height: 10)
        case .noLocation:
            Circle().strokeBorder(Palette.muted, lineWidth: 2).frame(width: 10, height: 10)
        }
    }
}

/// A numbered point on the selected person's day; lifecycle events get a glyph.
struct TeamMapPointBadge: View {
    var number: Int
    var eventType: String

    private var glyph: String? {
        switch eventType {
        case LocationEventType.clockIn.rawValue: return "play.fill"
        case LocationEventType.clockOut.rawValue: return "stop.fill"
        case LocationEventType.projectSwitch.rawValue: return "arrow.left.arrow.right"
        default: return nil
        }
    }

    var body: some View {
        ZStack {
            Circle().fill(eventType == LocationEventType.clockOut.rawValue ? Palette.navy : Palette.teal)
            if let glyph {
                Image(systemName: glyph).font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
            } else {
                Text("\(number)").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white).monospacedDigit()
            }
        }
        .frame(width: 24, height: 24)
        .overlay(Circle().strokeBorder(.white, lineWidth: 2))
        .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
        .accessibilityLabel("Location \(number)")
    }
}
