import MapKit
import Observation
import ServiceFlowCore
import SwiftUI

/// Team locations for managers. Locations are recorded at clock-in,
/// clock-out and while the app is open, so this shows "last seen", not live.
@MainActor
@Observable
final class TeamMapModel {
    private(set) var statuses: [TeamMemberStatus] = []
    /// The latest point recorded today per employee.
    private(set) var latestToday: [String: TeamLocationPoint] = [:]
    /// Today's points for the selected person, oldest first.
    private(set) var points: [TeamLocationPoint] = []
    private(set) var hasLoaded = false
    private(set) var loading = false
    private(set) var pointsLoading = false
    private(set) var error: String?
    var selectedId: String?

    var selected: TeamMemberStatus? { statuses.first { $0.employeeId == selectedId } }

    /// Clocked-in people first, then the rest in fetch order.
    var cards: [TeamMemberStatus] {
        statuses.filter(\.isClockedIn) + statuses.filter { !$0.isClockedIn }
    }

    /// People worth a pin: clocked in now, or recorded somewhere today.
    var pinned: [TeamMemberStatus] {
        statuses.filter { ($0.isClockedIn || latestToday[$0.employeeId] != nil) && $0.coordinate != nil }
    }

    static func today(now: Date = Date(), calendar: Calendar = .current) -> (start: Date, end: Date) {
        let start = calendar.startOfDay(for: now)
        return (start, calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400))
    }

    func refresh(api: ServiceFlowAPI) async {
        if !hasLoaded { loading = true }
        defer {
            loading = false
            hasLoaded = true
        }
        do {
            let day = Self.today()
            async let loadedStatuses = api.trackingStatuses()
            async let recent = api.locationPoints(employeeId: nil, from: day.start, to: day.end, ascending: false, limit: 500)
            statuses = try await loadedStatuses
            var latest: [String: TeamLocationPoint] = [:]
            for point in (try? await recent) ?? [] where latest[point.employeeId] == nil {
                latest[point.employeeId] = point
            }
            latestToday = latest
            error = nil
        } catch {
            let message = error.localizedDescription
            self.error = message.isEmpty ? "Team locations could not be loaded." : message
        }
    }

    func loadPoints(api: ServiceFlowAPI) async {
        guard let id = selectedId else {
            points = []
            return
        }
        pointsLoading = true
        defer { pointsLoading = false }
        do {
            let day = Self.today()
            let loaded = try await api.locationPoints(employeeId: id, from: day.start, to: day.end, ascending: true, limit: 2000)
            guard selectedId == id else { return }
            points = loaded
        } catch {
            let message = error.localizedDescription
            self.error = message.isEmpty ? "Today’s locations could not be loaded." : message
        }
    }

    func select(_ id: String?) {
        guard selectedId != id else { return }
        selectedId = id
        points = []
    }

    func clearPoints() { points = [] }

    // MARK: Presentation

    static func color(for status: TeamMemberStatus) -> Color {
        status.state == .clockedIn ? Color(hex: 0x2f8d7f) : Color(hex: 0x8b9692)
    }

    func activity(for status: TeamMemberStatus) -> String {
        TeamMapText.activity(for: status, latest: latestToday[status.employeeId])
    }

    func lastSeen(for status: TeamMemberStatus, now: Date = Date()) -> String {
        TeamMapText.lastSeen(latestToday[status.employeeId]?.capturedAt ?? status.lastLocationAt, now: now)
    }

    /// A region that shows every coordinate, leaving room for the bottom panel.
    static func region(fitting coordinates: [CLLocationCoordinate2D]) -> MKCoordinateRegion? {
        guard let first = coordinates.first else { return nil }
        if coordinates.count == 1 {
            return MKCoordinateRegion(center: first, span: MKCoordinateSpan(latitudeDelta: 0.025, longitudeDelta: 0.025))
        }
        let lats = coordinates.map(\.latitude)
        let lngs = coordinates.map(\.longitude)
        let latDelta = max(0.01, (lats.max()! - lats.min()!) * 1.9)
        let lngDelta = max(0.01, (lngs.max()! - lngs.min()!) * 1.4)
        // Shift the centre south so the pins sit above the bottom panel.
        let center = CLLocationCoordinate2D(latitude: (lats.max()! + lats.min()!) / 2 - latDelta * 0.18,
                                            longitude: (lngs.max()! + lngs.min()!) / 2)
        return MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lngDelta))
    }

    static let northAmerica = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 45, longitude: -95),
        span: MKCoordinateSpan(latitudeDelta: 40, longitudeDelta: 60)
    )
}

/// `Coordinate` → MapKit (named for this feature to avoid clashing with other screens' helpers).
func teamMapCoordinate(_ coordinate: Coordinate) -> CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude)
}
