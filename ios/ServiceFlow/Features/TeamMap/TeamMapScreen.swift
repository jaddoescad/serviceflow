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
    @State private var refreshing = false

    init(enabled: Bool) {
        self.enabled = enabled
    }

    private struct PointsKey: Hashable {
        var enabled: Bool
        var selectedId: String?
    }

    var body: some View {
        map
            .safeAreaInset(edge: .bottom, spacing: 0) {
                TeamMapPanel(model: model) { select($0) }
            }
            .navigationTitle(model.selected?.displayName ?? "Team Map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                if model.selected != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            select(nil)
                        } label: {
                            Label("All crew", systemImage: "chevron.left")
                                .labelStyle(.titleAndIcon)
                        }
                        .accessibilityLabel("Back to team map")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if refreshing {
                        ProgressView()
                    } else {
                        Button {
                            Task { await manualRefresh() }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .accessibilityLabel("Refresh team locations")
                    }
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
                if model.selectedId == nil, model.statuses.contains(where: { $0.employeeId == id }) {
                    select(id)
                }
                mapSelection = nil
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
                        Marker(status.displayName, monogram: Text(status.initials), coordinate: teamMapCoordinate(coordinate))
                            .tint(TeamMapModel.color(for: status))
                            .tag(status.employeeId)
                    }
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
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
            pointMarker(point, number: index + 1)
        }
        if let coordinate = status.coordinate {
            MapCircle(center: teamMapCoordinate(coordinate), radius: max(20, status.accuracyMeters ?? 20))
                .foregroundStyle(Color(rgba: 47, 141, 127, 0.14))
                .stroke(Color(rgba: 47, 141, 127, 0.5), lineWidth: 1)
            Marker("\(status.displayName) · last seen", monogram: Text(status.initials), coordinate: teamMapCoordinate(coordinate))
                .tint(TeamMapModel.color(for: status))
        }
    }

    /// A numbered point of the selected person's day; lifecycle events get a glyph.
    @MapContentBuilder
    private func pointMarker(_ point: TeamLocationPoint, number: Int) -> some MapContent {
        let title = DateText.time(point.capturedAt)
        let coordinate = teamMapCoordinate(point.coordinate)
        switch point.eventType {
        case LocationEventType.clockIn.rawValue:
            Marker(title, systemImage: "play.fill", coordinate: coordinate).tint(Palette.teal)
        case LocationEventType.clockOut.rawValue:
            Marker(title, systemImage: "stop.fill", coordinate: coordinate).tint(Palette.navy)
        case LocationEventType.projectSwitch.rawValue:
            Marker(title, systemImage: "arrow.left.arrow.right", coordinate: coordinate).tint(Palette.teal)
        default:
            Marker(title, monogram: Text("\(number)"), coordinate: coordinate).tint(Palette.teal)
        }
    }

    private func jobSites(for status: TeamMemberStatus) -> [Project] {
        let ids = Set(model.points.compactMap(\.jobId) + [status.jobId].compactMap { $0 })
        return session.mappedProjects.filter { ids.contains($0.id) && $0.coordinate != nil }
    }

    // MARK: Actions

    private func manualRefresh() async {
        refreshing = true
        await refreshStatuses()
        if model.selectedId != nil { await model.loadPoints(api: session.api) }
        refreshing = false
    }

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
