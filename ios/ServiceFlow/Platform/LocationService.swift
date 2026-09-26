import CoreLocation
import ServiceFlowCore

/// CoreLocation for the time tracker.
///
/// - Authorization is When In Use only and is requested solely from a Clock In
///   tap (`requestAuthorizationIfNeeded`). Everything else only checks it.
/// - There is no background location: updates run while the app is open during
///   a shift and stop when it goes to the background.
final class LocationService: NSObject, LocationProviding, CLLocationManagerDelegate, @unchecked Sendable {
    private let manager = CLLocationManager()
    private var authorizationWaiters: [CheckedContinuation<LocationAuthorization, Never>] = []
    private var fixWaiters: [UUID: CheckedContinuation<LocationPoint?, Never>] = [:]
    private var watching = false

    /// Continuous foreground fixes while watching.
    var onFix: ((LocationPoint) -> Void)?
    /// Authorization changed (e.g. in Settings).
    var onAuthorizationChange: ((LocationAuthorization) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = TrackingConstants.foregroundDistanceFilter
        manager.activityType = .other
        manager.pausesLocationUpdatesAutomatically = true
        retireLegacyRegions()
    }

    var authorization: LocationAuthorization { Self.map(manager.authorizationStatus) }

    static func map(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .restricted: return .restricted
        case .authorizedAlways, .authorizedWhenInUse: return .authorized
        @unknown default: return .denied
        }
    }

    @MainActor
    func requestAuthorizationIfNeeded() async -> LocationAuthorization {
        guard manager.authorizationStatus == .notDetermined else { return authorization }
        return await withCheckedContinuation { continuation in
            authorizationWaiters.append(continuation)
            manager.requestWhenInUseAuthorization()
        }
    }

    func currentPoint(timeout: TimeInterval) async -> LocationPoint? {
        guard authorization.isAuthorized else { return nil }
        let id = UUID()
        return await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                self.fixWaiters[id] = continuation
                self.manager.requestLocation()
                DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
                    self.fixWaiters.removeValue(forKey: id)?.resume(returning: nil)
                }
            }
        }
    }

    /// Starts foreground updates (distance filter 25 m) while a shift is active.
    func startWatching() {
        guard authorization.isAuthorized, !watching else { return }
        watching = true
        manager.startUpdatingLocation()
    }

    func stopWatching() {
        guard watching else { return }
        watching = false
        manager.stopUpdatingLocation()
    }

    /// Earlier releases monitored job-site regions; make sure none remain.
    private func retireLegacyRegions() {
        for region in manager.monitoredRegions { manager.stopMonitoring(for: region) }
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = Self.map(manager.authorizationStatus)
        guard status != .notDetermined else { return }
        let waiters = authorizationWaiters
        authorizationWaiters.removeAll()
        waiters.forEach { $0.resume(returning: status) }
        if !status.isAuthorized { stopWatching() }
        onAuthorizationChange?(status)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let point = Self.point(location)
        let waiters = fixWaiters
        fixWaiters.removeAll()
        waiters.values.forEach { $0.resume(returning: point) }
        if watching { onFix?(point) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { return }
        let waiters = fixWaiters
        fixWaiters.removeAll()
        waiters.values.forEach { $0.resume(returning: nil) }
    }

    static func point(_ location: CLLocation) -> LocationPoint {
        LocationPoint(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            accuracy: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
            speed: location.speed >= 0 ? location.speed : nil,
            heading: location.course >= 0 ? location.course : nil,
            mocked: location.sourceInformation?.isSimulatedBySoftware,
            capturedAt: location.timestamp
        )
    }
}
