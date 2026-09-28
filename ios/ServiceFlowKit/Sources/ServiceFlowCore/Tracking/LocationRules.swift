import Foundation

public enum TrackingConstants {
    /// Clocked-out screen auto-targets the nearest job within this distance.
    public static let nearestProjectRadius: Double = 2000
    /// A fix this close to the job counts as on site.
    public static let siteRadius: Double = 150
    /// "Switch to …" is suggested for another job this close.
    public static let jobSuggestionRadius: Double = 175
    /// Fixes less accurate than this are not trusted.
    public static let maximumAcceptedAccuracy: Double = 250
    /// Time between recorded samples beyond which the gap is "not recorded".
    public static let recordingGap: TimeInterval = 15 * 60
    public static let foregroundHeartbeat: TimeInterval = 4 * 60
    public static let foregroundDistanceFilter: Double = 25
    public static let clockInLocationTimeout: TimeInterval = 12
    public static let clockOutLocationTimeout: TimeInterval = 8
}

public enum Geo {
    /// Haversine distance in metres, rounded to a whole metre.
    public static func distance(_ a: Coordinate, _ b: Coordinate) -> Double {
        let radius = 6_371_000.0
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLng = (b.longitude - a.longitude) * .pi / 180
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
        return (radius * 2 * atan2(sqrt(h), sqrt(1 - h))).rounded()
    }

    /// The closest non-archived job with coordinates.
    public static func nearest(_ projects: [Project], to point: Coordinate) -> (project: Project, distance: Double)? {
        projects
            .filter { !$0.isArchived }
            .compactMap { project in project.coordinate.map { (project: project, distance: distance(point, $0)) } }
            .min { $0.distance < $1.distance }
    }
}

public enum TrackingMode: String, Codable, Sendable {
    case painting, stationary, travel, unknown, unavailable
    case clockedOut = "clocked_out"
}

/// Where a fix puts the painter relative to their job.
public struct LocationStatus: Equatable, Sendable {
    public var point: LocationPoint
    public var activeDistance: Double?
    public var onSite: Bool?
    public var suggestedProject: Project?
    public var reliable: Bool

    public init(point: LocationPoint, project: Project, projects: [Project]) {
        self.point = point
        reliable = (point.accuracy ?? 0) <= TrackingConstants.maximumAcceptedAccuracy
        let distance = project.coordinate.map { Geo.distance(point.coordinate, $0) }
        guard reliable else {
            activeDistance = distance
            onSite = nil
            suggestedProject = nil
            return
        }
        activeDistance = distance
        onSite = distance.map { $0 <= TrackingConstants.siteRadius }
        if let nearest = Geo.nearest(projects, to: point.coordinate), nearest.project.id != project.id,
           nearest.distance <= TrackingConstants.jobSuggestionRadius {
            suggestedProject = nearest.project
        } else {
            suggestedProject = nil
        }
    }

    public var mode: TrackingMode {
        guard reliable else { return .travel }
        switch onSite {
        case true?: return .painting
        case false?: return .travel
        case nil: return .unknown
        }
    }

    /// The status line on the active clock-in card.
    public var label: String {
        guard reliable else { return "Location accuracy is still improving." }
        guard let activeDistance else { return "Location captured. Job-site distance unavailable." }
        let distance = DistanceFormat.meters(activeDistance)
        return onSite == true ? "On site, \(distance) from job." : "Off site, \(distance) from job."
    }
}

public enum LocationEventType: String, Codable, Sendable {
    case location
    case clockIn = "clock_in"
    case clockOut = "clock_out"
    case projectSwitch = "project_switch"
    case trackingStatus = "tracking_status"
}

public enum LocationSampling {
    /// Whether a fix is worth uploading as a location point. Lifecycle events
    /// are always kept; routine fixes are thinned by distance and time.
    public static func shouldRecord(previous: LocationPoint?, point: LocationPoint, mode: TrackingMode,
                                    event: LocationEventType) -> Bool {
        guard event == .location else { return true }
        if (point.accuracy ?? 0) > TrackingConstants.maximumAcceptedAccuracy { return false }
        guard let previous else { return true }
        let steady = mode == .painting || mode == .stationary
        let distance = Geo.distance(previous.coordinate, point.coordinate)
        let elapsed = point.capturedAt.timeIntervalSince(previous.capturedAt)
        return distance >= (steady ? 60 : 100) || elapsed >= (steady ? 15 * 60 : 3 * 60)
    }
}

public enum SegmentBuilder {
    /// Adds a sample to the shift's segments. Without background location the
    /// app sees nothing while it is closed, so a gap longer than
    /// `recordingGap` since the last sample becomes an `unknown` segment
    /// instead of silently stretching the previous mode across it.
    public static func append(_ segments: [ShiftSegment], mode: SiteMode, at now: Date, distance: Double?,
                              location: LocationPoint?, shiftStart: Date) -> [ShiftSegment] {
        var result = segments
        let lastEnd = result.last?.endedAt ?? result.last?.startedAt ?? shiftStart
        if now.timeIntervalSince(lastEnd) > TrackingConstants.recordingGap {
            if result.last?.mode == .unknown {
                result[result.count - 1].endedAt = now
            } else {
                result.append(ShiftSegment(mode: .unknown, startedAt: lastEnd, endedAt: now))
            }
        }
        if var last = result.last, last.mode == mode {
            last.endedAt = now
            last.distanceMeters = distance
            last.location = location
            result[result.count - 1] = last
        } else {
            result.append(ShiftSegment(mode: mode, startedAt: now, endedAt: now, distanceMeters: distance, location: location))
        }
        return result
    }

    /// Closes the segments at clock-out, marking an unobserved tail as `unknown`.
    public static func close(_ segments: [ShiftSegment], at end: Date) -> [ShiftSegment] {
        guard var last = segments.last else { return segments }
        var result = segments
        let lastEnd = last.endedAt ?? last.startedAt
        if end.timeIntervalSince(lastEnd) > TrackingConstants.recordingGap {
            if last.mode == .unknown {
                last.endedAt = end
                result[result.count - 1] = last
            } else {
                result.append(ShiftSegment(mode: .unknown, startedAt: lastEnd, endedAt: end))
            }
        } else {
            last.endedAt = end
            result[result.count - 1] = last
        }
        return result
    }
}
