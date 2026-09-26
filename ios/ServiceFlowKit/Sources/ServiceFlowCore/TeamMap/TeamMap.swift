import Foundation

/// One person's latest tracking row (`employee_tracking_status`).
public struct TeamMemberStatus: Identifiable, Hashable, Sendable {
    public var id: String { employeeId }
    public var employeeId: String
    public var name: String?
    public var email: String?
    public var timeEntryId: String?
    public var jobId: String?
    public var jobName: String?
    public var latitude: Double?
    public var longitude: Double?
    public var accuracyMeters: Double?
    public var lastLocationAt: Date?
    public var trackingMode: String?
    public var taskStatus: String?
    public var onSite: Bool?

    public init?(row: JSONValue) {
        guard let id = row["employee_id"]?.nonEmptyString else { return nil }
        employeeId = id
        name = row["employee_name"]?.nonEmptyString
        email = row["employee_email"]?.nonEmptyString
        timeEntryId = row["time_entry_id"]?.nonEmptyString
        jobId = row["job_id"]?.nonEmptyString
        jobName = row["job_name"]?.nonEmptyString
        (latitude, longitude) = Project.validCoordinate(row["latitude"]?.doubleValue, row["longitude"]?.doubleValue)
        accuracyMeters = row["accuracy_meters"]?.doubleValue
        lastLocationAt = row["last_location_at"]?.dateValue
        trackingMode = row["tracking_mode"]?.nonEmptyString
        taskStatus = row["task_status"]?.nonEmptyString
        onSite = row["metadata"]?["on_site"]?.boolValue
    }

    public var displayName: String { name ?? email ?? "Crew member" }
    public var initials: String { Initials.of(name, fallback: "P") }

    public var coordinate: Coordinate? {
        guard let latitude, let longitude else { return nil }
        return Coordinate(latitude: latitude, longitude: longitude)
    }

    public var isClockedIn: Bool { trackingMode != TrackingMode.clockedOut.rawValue && timeEntryId != nil }

    public enum State: Sendable { case clockedIn, clockedOut, noLocation }

    public var state: State {
        if isClockedIn { return coordinate == nil ? .noLocation : .clockedIn }
        return .clockedOut
    }
}

/// The latest recorded point for a person today, for the activity line.
public struct TeamLocationPoint: Identifiable, Hashable, Sendable {
    public var id: String
    public var employeeId: String
    public var latitude: Double
    public var longitude: Double
    public var accuracyMeters: Double?
    public var eventType: String
    public var isOnSite: Bool?
    public var jobId: String?
    public var capturedAt: Date

    public init?(row: JSONValue) {
        guard let employeeId = row["employee_id"]?.nonEmptyString,
              let latitude = row["latitude"]?.doubleValue, let longitude = row["longitude"]?.doubleValue,
              let capturedAt = row["captured_at"]?.dateValue else { return nil }
        id = row["id"]?.nonEmptyString ?? row["client_event_id"]?.nonEmptyString ?? "\(employeeId)-\(capturedAt.timeIntervalSince1970)"
        self.employeeId = employeeId
        self.latitude = latitude
        self.longitude = longitude
        accuracyMeters = row["accuracy_meters"]?.doubleValue
        eventType = row["event_type"]?.nonEmptyString ?? "location"
        isOnSite = row["is_on_site"]?.boolValue
        jobId = row["job_id"]?.nonEmptyString
        self.capturedAt = capturedAt
    }

    public var coordinate: Coordinate { Coordinate(latitude: latitude, longitude: longitude) }
}

public enum TeamMapText {
    /// `Last seen 2:41 PM`, `Last seen Yesterday, 4:10 PM`, `Last seen Sep 22, 4:10 PM`.
    public static func lastSeen(_ date: Date?, now: Date, calendar: Calendar = .current) -> String {
        guard let date else { return "No location recorded" }
        let time = DateText.time(date)
        if calendar.isDate(date, inSameDayAs: now) { return "Last seen \(time)" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "Last seen Yesterday, \(time)"
        }
        return "Last seen \(DateText.format(date, template: "MMMd")), \(time)"
    }

    /// What the person was last recorded doing.
    public static func activity(for status: TeamMemberStatus, latest: TeamLocationPoint?) -> String {
        guard status.isClockedIn else { return "Clocked out" }
        let job = status.jobName
        switch latest?.eventType {
        case "clock_in":
            if latest?.isOnSite == false { return "Clocked in off site" }
            return job.map { "Clocked in at \($0)" } ?? "Clocked in"
        case "project_switch":
            return job.map { "Switched to \($0)" } ?? "Switched jobs"
        case "clock_out":
            return "Clocked out"
        default:
            let onSite = latest?.isOnSite ?? status.onSite
            switch onSite {
            case true?: return "Seen on site"
            case false?: return "Seen off site"
            case nil: return status.coordinate == nil ? "Clocked in · no location recorded" : "Location recorded"
            }
        }
    }

    public static func recordCount(_ count: Int) -> String {
        count == 1 ? "1 location record" : "\(count) location records"
    }

    public static let notLiveNote = "Locations are recorded at clock-in, clock-out and while ServiceFlow is open. They are not live."
}
