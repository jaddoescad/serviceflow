import Foundation

public enum LocationAuthorization: Sendable, Equatable {
    case notDetermined
    case denied
    case restricted
    case authorized

    public var isAuthorized: Bool { self == .authorized }
}

/// Location access for the time tracker. Authorization is only ever requested
/// from a Clock In tap; everything else just checks it.
public protocol LocationProviding: AnyObject, Sendable {
    var authorization: LocationAuthorization { get }
    /// Shows the system When-In-Use prompt if it has never been answered.
    func requestAuthorizationIfNeeded() async -> LocationAuthorization
    /// One fix, or nil when unavailable within `timeout`.
    func currentPoint(timeout: TimeInterval) async -> LocationPoint?
}

/// The "Still clocked in?" local notifications.
public protocol ShiftReminderScheduling: AnyObject, Sendable {
    func scheduleReminders(for shift: TimeEntry, now: Date)
    func cancelReminders()
}

/// The person using the app.
public struct CrewMember: Codable, Hashable, Sendable {
    public var id: String
    public var email: String?
    public var name: String

    public init(id: String, email: String?, name: String) {
        self.id = id
        self.email = email
        self.name = name
    }
}

/// A message shown in the clock-in feedback bubble. Never persisted.
public struct TrackingNotice: Equatable, Sendable {
    public enum Kind: Sendable { case info, problem }
    public var kind: Kind
    public var message: String

    public init(_ kind: Kind, _ message: String) {
        self.kind = kind
        self.message = message
    }
}

public enum TimeTrackingError: Error, Equatable, LocalizedError {
    case alreadyClockedIn
    case notClockedIn
    case busy
    case invalidTimes(String)
    case projectUnavailable(String)

    public var errorDescription: String? {
        switch self {
        case .alreadyClockedIn: return "You're already clocked in."
        case .notClockedIn: return "You're not clocked in."
        case .busy: return "Hang on, your last action is still finishing."
        case .invalidTimes(let message), .projectUnavailable(let message): return message
        }
    }
}
