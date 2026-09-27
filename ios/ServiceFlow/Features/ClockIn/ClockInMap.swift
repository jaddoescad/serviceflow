import MapKit
import ServiceFlowCore
import SwiftUI

/// Apple Maps with the company's jobs as markers. The selected job gets a
/// 150 m circle and a line from the person's location.
struct ClockInMap: View {
    var projects: [Project]
    var selected: Project?
    @Binding var userPoint: LocationPoint?
    var onSelect: (Project) -> Void

    @Environment(SessionContext.self) private var session
    @State private var position: MapCameraPosition = .automatic
    @State private var selection: String?
    @State private var centredId: String?
    @State private var didInitialFit = false

    private var markers: [Project] {
        var seen = Set<String>()
        var list = projects.filter { !$0.isArchived && $0.coordinate != nil && seen.insert($0.id).inserted }
        if let selected, selected.coordinate != nil, !seen.contains(selected.id) { list.append(selected) }
        return list
    }

    private var authorized: Bool { session.locationAuthorization.isAuthorized }

    var body: some View {
        Map(position: $position, selection: $selection) {
            if authorized { UserAnnotation() }
            if let selected, let coordinate = selected.coordinate?.location {
                MapCircle(center: coordinate, radius: TrackingConstants.siteRadius)
                    .foregroundStyle(Palette.teal.opacity(0.18))
                    .stroke(Palette.teal.opacity(0.55), lineWidth: 2)
                if authorized, let user = userPoint?.coordinate.location {
                    MapPolyline(coordinates: [user, coordinate])
                        .stroke(Palette.teal, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                }
            }
            ForEach(markers) { project in
                Marker(project.name, systemImage: project.isLead ? "person.fill" : "briefcase.fill",
                       coordinate: project.coordinate!.location)
                    .tint(project.id == selected?.id ? Palette.teal : Palette.navy)
                    .tag(project.id)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls {
            if authorized { MapUserLocationButton() }
            MapCompass()
            MapScaleView()
        }
        .onChange(of: selection) { _, id in
            guard let id, let project = markers.first(where: { $0.id == id }) else { return }
            onSelect(project)
        }
        .onChange(of: selected?.id) { _, id in
            selection = id
            centreOnSelection()
        }
        .task { await refreshUserPoint() }
        .onChange(of: session.locationAuthorization) { _, _ in Task { await refreshUserPoint() } }
        .onAppear {
            selection = selected?.id
            fitInitially()
        }
        .onChange(of: projects.count) { _, _ in fitInitially() }
    }

    // MARK: Camera

    private func fitInitially() {
        guard !didInitialFit else { return }
        let job = selected?.coordinate
        let user = userPoint?.coordinate
        guard job != nil || user != nil || !projects.isEmpty else { return }
        didInitialFit = true
        withAnimation { position = .region(Self.region(job: job, user: user, fallback: projects)) }
        centredId = selected?.id
    }

    private func centreOnSelection() {
        guard let selected, selected.id != centredId, let coordinate = selected.coordinate else { return }
        centredId = selected.id
        didInitialFit = true
        withAnimation {
            position = .region(MKCoordinateRegion(center: coordinate.location, span: MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.012)))
        }
    }

    /// Both points: their midpoint with some padding. One: that point close up.
    static func region(job: Coordinate?, user: Coordinate?, fallback: [Project]) -> MKCoordinateRegion {
        switch (job, user) {
        case let (job?, user?):
            let center = CLLocationCoordinate2D(latitude: (job.latitude + user.latitude) / 2, longitude: (job.longitude + user.longitude) / 2)
            let span = MKCoordinateSpan(latitudeDelta: max(abs(job.latitude - user.latitude) * 1.35, 0.035),
                                        longitudeDelta: max(abs(job.longitude - user.longitude) * 1.35, 0.035))
            return MKCoordinateRegion(center: center, span: span)
        case let (single?, nil), let (nil, single?):
            return MKCoordinateRegion(center: single.location, span: MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.012))
        case (nil, nil):
            guard let first = fallback.compactMap(\.coordinate).first else {
                return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 45, longitude: -95),
                                          span: MKCoordinateSpan(latitudeDelta: 40, longitudeDelta: 60))
            }
            return MKCoordinateRegion(center: first.location, span: MKCoordinateSpan(latitudeDelta: 0.2, longitudeDelta: 0.2))
        }
    }

    // MARK: Location

    /// A one-shot fix, only when location is already allowed. Never prompts.
    private func refreshUserPoint() async {
        guard authorized, let point = await session.location.currentPoint(timeout: TrackingConstants.clockInLocationTimeout) else { return }
        userPoint = point
        if selected == nil {
            didInitialFit = false
            fitInitially()
        }
    }
}

extension Coordinate {
    var location: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}
