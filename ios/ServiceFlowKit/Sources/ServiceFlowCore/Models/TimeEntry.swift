import Foundation

/// A GPS fix as stored on entries and segments.
public struct LocationPoint: Codable, Hashable, Sendable {
    public var latitude: Double
    public var longitude: Double
    /// Horizontal accuracy in metres; nil when unknown.
    public var accuracy: Double?
    public var speed: Double?
    public var heading: Double?
    public var mocked: Bool?
    public var capturedAt: Date

    public init(latitude: Double, longitude: Double, accuracy: Double? = nil, speed: Double? = nil,
                heading: Double? = nil, mocked: Bool? = nil, capturedAt: Date) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy.flatMap { $0 > 0 ? $0 : nil }
        self.speed = speed.flatMap { $0 >= 0 ? $0 : nil }
        self.heading = heading.flatMap { $0 >= 0 ? $0 : nil }
        self.mocked = mocked
        self.capturedAt = capturedAt
    }

    public var coordinate: Coordinate { Coordinate(latitude: latitude, longitude: longitude) }
}

public enum SiteMode: String, Codable, Sendable {
    case onSite = "on_site"
    case offSite = "off_site"
    case unknown

    public init(onSite: Bool?) {
        switch onSite {
        case true?: self = .onSite
        case false?: self = .offSite
        case nil: self = .unknown
        }
    }

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SiteMode(rawValue: raw) ?? .unknown
    }
}

/// A stretch of a shift spent in one location mode.
public struct ShiftSegment: Codable, Hashable, Sendable {
    public var mode: SiteMode
    public var startedAt: Date
    public var endedAt: Date?
    public var distanceMeters: Double?
    public var location: LocationPoint?

    public init(mode: SiteMode, startedAt: Date, endedAt: Date?, distanceMeters: Double? = nil, location: LocationPoint? = nil) {
        self.mode = mode
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.distanceMeters = distanceMeters
        self.location = location
    }
}

/// One edit in `adjustment_history`. The server writes snake_case items
/// (`adjusted_at`, `previous_started_at`); older app builds wrote camelCase.
/// Both are read, and the app never writes history itself.
public struct AdjustmentRecord: Codable, Hashable, Sendable {
    public var adjustedAt: Date?
    public var adjustedBy: String?
    public var adjustedByName: String?
    public var source: String?
    public var previousStartedAt: Date?
    public var previousEndedAt: Date?

    public init(adjustedAt: Date? = nil, adjustedBy: String? = nil, adjustedByName: String? = nil, source: String? = nil,
                previousStartedAt: Date? = nil, previousEndedAt: Date? = nil) {
        self.adjustedAt = adjustedAt
        self.adjustedBy = adjustedBy
        self.adjustedByName = adjustedByName
        self.source = source
        self.previousStartedAt = previousStartedAt
        self.previousEndedAt = previousEndedAt
    }

    public init(json: JSONValue) {
        func pick(_ keys: String...) -> JSONValue? {
            keys.lazy.compactMap { json[$0] }.first { !$0.isNull }
        }
        adjustedAt = pick("adjusted_at", "adjustedAt")?.dateValue
        adjustedBy = pick("adjusted_by", "adjustedByUserId")?.nonEmptyString
        adjustedByName = pick("adjusted_by_name", "adjustedByName", "adjustedByEmail")?.nonEmptyString
        source = pick("source")?.nonEmptyString
        previousStartedAt = pick("previous_started_at", "previousStartedAt")?.dateValue
        previousEndedAt = pick("previous_ended_at", "previousEndedAt")?.dateValue
    }
}

public enum ClockOutReason: String, Codable, Sendable {
    case active
    case manual
    case projectDetail = "project_detail"
    case notification
    case switchedProject = "switched_project"
    case server
}

/// A time entry. While `endedAt` is nil it is the running shift.
public struct TimeEntry: Codable, Hashable, Identifiable, Sendable {
    /// The `client_entry_id`. Created on the device at clock-in and never changed.
    public var localId: String
    /// `time_entries.id` once the server has acknowledged the entry.
    public var serverId: String?
    public var userId: String
    public var userEmail: String?
    public var userName: String
    public var project: Project
    public var originalStartedAt: Date
    public var startedAt: Date
    public var startEditedAt: Date?
    public var endedAt: Date?
    public var clockOutReason: ClockOutReason
    public var startedLocation: LocationPoint?
    public var lastLocation: LocationPoint?
    public var lastDistanceMeters: Double?
    public var onSite: Bool?
    public var travelStartedAt: Date?
    public var segments: [ShiftSegment]
    public var adjustmentHistory: [AdjustmentRecord]

    public var id: String { localId }
    public var isActive: Bool { endedAt == nil }

    public init(localId: String, serverId: String? = nil, userId: String, userEmail: String?, userName: String,
                project: Project, originalStartedAt: Date, startedAt: Date, startEditedAt: Date? = nil,
                endedAt: Date? = nil, clockOutReason: ClockOutReason = .active, startedLocation: LocationPoint? = nil,
                lastLocation: LocationPoint? = nil, lastDistanceMeters: Double? = nil, onSite: Bool? = nil,
                travelStartedAt: Date? = nil, segments: [ShiftSegment] = [], adjustmentHistory: [AdjustmentRecord] = []) {
        self.localId = localId
        self.serverId = serverId
        self.userId = userId
        self.userEmail = userEmail
        self.userName = userName
        self.project = project
        self.originalStartedAt = originalStartedAt
        self.startedAt = startedAt
        self.startEditedAt = startEditedAt
        self.endedAt = endedAt
        self.clockOutReason = clockOutReason
        self.startedLocation = startedLocation
        self.lastLocation = lastLocation
        self.lastDistanceMeters = lastDistanceMeters
        self.onSite = onSite
        self.travelStartedAt = travelStartedAt
        self.segments = segments
        self.adjustmentHistory = adjustmentHistory
    }

    public func duration(at now: Date) -> TimeInterval {
        max(0, (endedAt ?? now).timeIntervalSince(startedAt))
    }

    /// Keys under which the server or the device may know this entry.
    public var identityKeys: Set<String> {
        Set([serverId, localId].compactMap { $0.nonBlank })
    }

    public func isSameEntry(as other: TimeEntry) -> Bool {
        !identityKeys.isDisjoint(with: other.identityKeys)
    }

    /// Net start-time edit in minutes (`Edited -10m`), nil when unchanged.
    public var startAdjustmentMinutes: Int? {
        let minutes = Int((startedAt.timeIntervalSince(originalStartedAt) / 60).rounded())
        return minutes == 0 ? nil : minutes
    }
}

public extension TimeEntry {
    /// Builds an entry from a `time_entries` row.
    init?(serverRow row: JSONValue, now: Date = Date()) {
        guard let id = row["id"]?.nonEmptyString,
              let startedAt = row["started_at"]?.dateValue else { return nil }
        let status = row["status"]?.stringValue
        let isActive = status == "active" && (row["ended_at"]?.isNull ?? true)
        let jobId = row["job_id"]?.nonEmptyString ?? ""
        let address = row["job_address"]?.nonEmptyString

        func point(_ lat: String, _ lng: String) -> LocationPoint? {
            guard let latitude = row[lat]?.doubleValue, let longitude = row[lng]?.doubleValue else { return nil }
            return LocationPoint(latitude: latitude, longitude: longitude, capturedAt: startedAt)
        }

        let segments = (row["segments"]?.arrayValue ?? []).compactMap { try? $0.decode(ShiftSegment.self) }
        self.init(
            localId: row["client_entry_id"]?.nonEmptyString ?? id,
            serverId: id,
            userId: row["employee_id"]?.nonEmptyString ?? "",
            userEmail: row["employee_email"]?.nonEmptyString,
            userName: row["employee_name"]?.nonEmptyString ?? "Crew member",
            project: Project(id: jobId, name: row["job_name"]?.nonEmptyString ?? "Job", formattedAddress: address),
            originalStartedAt: row["original_started_at"]?.dateValue ?? startedAt,
            startedAt: startedAt,
            startEditedAt: row["start_edited_at"]?.dateValue,
            endedAt: isActive ? nil : (row["ended_at"]?.dateValue ?? now),
            clockOutReason: isActive ? .active : .server,
            startedLocation: point("clock_in_latitude", "clock_in_longitude"),
            lastLocation: point("clock_out_latitude", "clock_out_longitude"),
            lastDistanceMeters: row["last_distance_meters"]?.doubleValue,
            onSite: row["is_on_site"]?.boolValue,
            segments: segments,
            adjustmentHistory: (row["adjustment_history"]?.arrayValue ?? []).map(AdjustmentRecord.init(json:))
        )
    }
}

/// Server status of a time entry row.
public enum TimeEntryRowStatus {
    public static func of(_ row: JSONValue) -> String? { row["status"]?.stringValue }
    /// The server writes `completed` (the RN app checked `complete`, so it never reconciled).
    public static func isCompleted(_ row: JSONValue) -> Bool {
        of(row) == "completed" && !(row["ended_at"]?.isNull ?? true)
    }
    public static func isActive(_ row: JSONValue) -> Bool {
        of(row) == "active" && (row["ended_at"]?.isNull ?? true)
    }
}
