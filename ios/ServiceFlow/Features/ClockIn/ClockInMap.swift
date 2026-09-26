import MapKit
import ServiceFlowCore
import SwiftUI

/// Apple Maps with the company's jobs. The selected job gets a 150 m circle
/// and a line from the person's location.
struct ClockInMap: View {
    var projects: [Project]
    var selected: Project?
    @Binding var userPoint: LocationPoint?
    var onSelect: (Project) -> Void

    @Environment(SessionContext.self) private var session
    @State private var position: MapCameraPosition = .automatic
    @State private var span: Double = 0.035
    @State private var moving = false
    @State private var centredId: String?
    @State private var didInitialFit = false
    @State private var locating = false

    private var markers: [Project] {
        var seen = Set<String>()
        var list = projects.filter { !$0.isArchived && $0.coordinate != nil && seen.insert($0.id).inserted }
        if let selected, selected.coordinate != nil, !seen.contains(selected.id) { list.append(selected) }
        return list
    }

    private var authorized: Bool { session.locationAuthorization.isAuthorized }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Map(position: $position, interactionModes: [.pan, .zoom]) {
                if authorized { UserAnnotation() }
                if let selected, let coordinate = selected.coordinate?.location {
                    MapCircle(center: coordinate, radius: TrackingConstants.siteRadius)
                        .foregroundStyle(Color(rgba: 47, 141, 127, 0.18))
                        .stroke(Color(rgba: 47, 141, 127, 0.55), lineWidth: 2)
                    if authorized, let user = userPoint?.coordinate.location {
                        MapPolyline(coordinates: [user, coordinate])
                            .stroke(Color(rgba: 17, 32, 29, 0.16), style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
                        MapPolyline(coordinates: [user, coordinate])
                            .stroke(Color(rgba: 255, 255, 255, 0.92), style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
                        MapPolyline(coordinates: [user, coordinate])
                            .stroke(Palette.teal, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                    }
                }
                ForEach(markers) { project in
                    let isSelected = project.id == selected?.id
                    Annotation(project.name, coordinate: project.coordinate!.location, anchor: .bottom) {
                        ClockInPin(name: project.name, selected: isSelected,
                                   showsLabel: !moving && (isSelected || span <= 0.12))
                            .onTapGesture { onSelect(project) }
                    }
                    .annotationTitles(.hidden)
                }
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll, showsTraffic: false))
            .mapControls {}
            .onMapCameraChange(frequency: .continuous) { _ in moving = true }
            .onMapCameraChange(frequency: .onEnd) { context in
                span = context.region.span.latitudeDelta
                moving = false
            }
            .onTapGesture { hideKeyboard() }

            recenterButton
                .padding(.trailing, 14)
                .padding(.bottom, 110)
        }
        .task { await refreshUserPoint() }
        .onChange(of: session.locationAuthorization) { _, _ in Task { await refreshUserPoint() } }
        .onChange(of: selected?.id) { _, _ in centreOnSelection() }
        .onAppear { fitInitially() }
        .onChange(of: projects.count) { _, _ in fitInitially() }
    }

    private var recenterButton: some View {
        Button(action: recenter) {
            ZStack {
                Circle().fill(Color.white)
                if locating { Spinner(color: Palette.teal) } else { Icon("scope", 21, Palette.teal) }
            }
            .frame(width: 42, height: 42)
            .cardShadow(opacity: 0.14, radius: 7, y: 3)
        }
        .disabled(locating)
        .opacity(locating ? 0.6 : 1)
        .accessibilityLabel("Recenter map on your location")
    }

    // MARK: Camera

    private func fitInitially() {
        guard !didInitialFit else { return }
        let job = selected?.coordinate
        let user = userPoint?.coordinate
        guard job != nil || user != nil || !projects.isEmpty else { return }
        didInitialFit = true
        withAnimation(.easeInOut(duration: 0.25)) { position = .region(Self.region(job: job, user: user, fallback: projects)) }
        centredId = selected?.id
    }

    private func centreOnSelection() {
        guard let selected, selected.id != centredId, let coordinate = selected.coordinate else { return }
        centredId = selected.id
        didInitialFit = true
        withAnimation(.easeInOut(duration: 0.35)) {
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
            let coordinates = fallback.compactMap(\.coordinate)
            guard let first = coordinates.first else {
                return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 45, longitude: -95),
                                          span: MKCoordinateSpan(latitudeDelta: 40, longitudeDelta: 60))
            }
            return MKCoordinateRegion(center: first.location, span: MKCoordinateSpan(latitudeDelta: 0.2, longitudeDelta: 0.2))
        }
    }

    // MARK: Location

    /// A one-shot fix, only when location is already allowed. Never prompts.
    private func refreshUserPoint() async {
        guard authorized else { return }
        if let point = await session.location.currentPoint(timeout: TrackingConstants.clockInLocationTimeout) {
            userPoint = point
            if !didInitialFit || (selected == nil && centredId == nil) {
                didInitialFit = false
                fitInitially()
            }
        }
    }

    /// Centres on the person when location is allowed, else on the selected job.
    private func recenter() {
        guard authorized else {
            if let coordinate = selected?.coordinate {
                withAnimation(.easeInOut(duration: 0.35)) {
                    position = .region(MKCoordinateRegion(center: coordinate.location, span: MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.012)))
                }
            }
            return
        }
        locating = true
        Task {
            if let point = await session.location.currentPoint(timeout: TrackingConstants.clockInLocationTimeout) {
                userPoint = point
            }
            if let target = userPoint?.coordinate ?? selected?.coordinate {
                withAnimation(.easeInOut(duration: 0.35)) {
                    position = .region(MKCoordinateRegion(center: target.location, span: MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.012)))
                }
            }
            locating = false
        }
    }
}

/// Navy map pin with a name pill above it.
struct ClockInPin: View {
    var name: String
    var selected: Bool
    var showsLabel: Bool

    var body: some View {
        VStack(spacing: 4) {
            Text(name)
                .text(11.5, .heavy, selected ? .white : Palette.ink)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .frame(maxWidth: 168)
                .background(selected ? Palette.navy : Color.white.opacity(0.96), in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? Color.white.opacity(0.92) : Color(rgba: 224, 227, 225, 0.95), lineWidth: 1))
                .cardShadow(opacity: 0.14, radius: 8, y: 3)
                .opacity(showsLabel ? 1 : 0)
                .fixedSize()
            Image(systemName: "mappin.circle.fill")
                .font(.system(size: 30))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, Palette.navy)
                .background(Circle().fill(Color.white).padding(4))
            Image(systemName: "triangle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Palette.navy)
                .rotationEffect(.degrees(180))
                .offset(y: -8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityAddTraits(.isButton)
    }
}

extension Coordinate {
    var location: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}
