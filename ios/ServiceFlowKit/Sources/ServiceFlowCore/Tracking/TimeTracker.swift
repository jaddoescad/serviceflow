import Foundation
import Observation

/// What is kept on disk for one person.
struct TrackingSnapshot: Codable {
    var activeShift: TimeEntry?
    var entries: [TimeEntry] = []
    /// Shifts closed on this device. A stale server read can't bring them back.
    var closedShiftIds: [String] = []
    var lastRecordedPoint: LocationPoint?
}

/// The single owner of shift state: clock in, clock out, switch, edits,
/// deletes, location samples and server reconciliation.
///
/// Every change is applied locally first and saved to disk, then sent through
/// the durable `CommandQueue`, so the app behaves the same offline.
///
/// The work is split by concern:
/// - `TimeTracker+Shifts.swift`: clock in/out, switch, edit, delete.
/// - `TimeTracker+Location.swift`: location samples and tracking status.
/// - `TimeTracker+Sync.swift`: sending commands and reconciling with the server.
@MainActor
@Observable
public final class TimeTracker {
    // MARK: Observable state

    public internal(set) var activeShift: TimeEntry?
    /// The person's completed entries, newest first.
    public internal(set) var entries: [TimeEntry] = []
    public internal(set) var locationStatus: LocationStatus?
    public internal(set) var suggestedProject: Project?
    public internal(set) var notice: TrackingNotice?
    public internal(set) var isClockingOut = false
    /// Jobs with coordinates, used for on-site checks and suggestions.
    public var projects: [Project] = []

    // MARK: Dependencies

    public let user: CrewMember
    let backend: TimeTrackingBackend
    let location: LocationProviding
    let reminders: ShiftReminderScheduling
    let commands: CommandQueue
    let locations: LocationQueue
    let snapshotStore: JSONFileStore<TrackingSnapshot>
    let appVersion: String
    /// False when location uploads are switched off for this build.
    let uploadsLocation: Bool
    let now: @Sendable () -> Date

    // MARK: Bookkeeping

    @ObservationIgnored var closedShiftIds: [String] = []
    @ObservationIgnored var lastRecordedPoint: LocationPoint?
    @ObservationIgnored var refreshing = false
    @ObservationIgnored var applyingFix = false

    static let maxClosedShiftIds = 64

    public init(user: CrewMember, storage: UserStorage, backend: TimeTrackingBackend, location: LocationProviding,
                reminders: ShiftReminderScheduling, appVersion: String, uploadsLocation: Bool = true,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.user = user
        self.backend = backend
        self.location = location
        self.reminders = reminders
        self.appVersion = appVersion
        self.uploadsLocation = uploadsLocation
        self.now = now
        commands = CommandQueue(store: storage.store("time-entry-commands"))
        locations = LocationQueue(storeURL: storage.directory.appendingPathComponent("location-queue.json"))
        snapshotStore = storage.store("time-tracking")

        let snapshot = snapshotStore.load() ?? TrackingSnapshot()
        activeShift = snapshot.activeShift?.userId == user.id ? snapshot.activeShift : nil
        entries = snapshot.entries.filter { $0.userId == user.id }
        closedShiftIds = snapshot.closedShiftIds
        lastRecordedPoint = snapshot.lastRecordedPoint
        if let activeShift { reminders.scheduleReminders(for: activeShift, now: now()) }
    }

    // MARK: Derived values

    /// Completed entries plus the running shift, newest first.
    public var allEntries: [TimeEntry] {
        (activeShift.map { [$0] } ?? []) + entries
    }

    /// Time worked today; an entry counts towards the day it started.
    public func workedToday(calendar: Calendar = .current) -> TimeInterval {
        let current = now()
        let midnight = calendar.startOfDay(for: current)
        return allEntries.filter { $0.startedAt >= midnight }.reduce(0) { $0 + $1.duration(at: current) }
    }

    /// Your time per job, e.g. `["<job id>": 26_100]` seconds.
    public func myTimeByProject() -> [String: TimeInterval] {
        let current = now()
        return allEntries.reduce(into: [:]) { totals, entry in
            totals[entry.project.id, default: 0] += entry.duration(at: current)
        }
    }

    public func clearNotice() { notice = nil }

    /// Commands still waiting for the server.
    public func pendingCommandCount() async -> Int { await commands.pending.count }

    /// Forgets this person's local data (used on sign-out and account deletion).
    public func eraseLocalData() async {
        reminders.cancelReminders()
        await commands.removeAll()
        await locations.removeAll()
        snapshotStore.delete()
        activeShift = nil
        entries = []
    }

    // MARK: Local state helpers

    /// Clears the running shift on this device only (no command is sent).
    /// A tombstoned shift can't be revived by a stale server read.
    func dropActiveShift(tombstone shouldTombstone: Bool = true) {
        guard let id = activeShift?.localId else { return }
        activeShift = nil
        locationStatus = nil
        suggestedProject = nil
        reminders.cancelReminders()
        if shouldTombstone { tombstone(id) }
    }

    /// Adds or moves an entry into the history, keeping it newest first.
    func insert(_ entry: TimeEntry) {
        entries.removeAll { $0.isSameEntry(as: entry) }
        entries.append(entry)
        entries.sort { $0.startedAt > $1.startedAt }
    }

    func replace(_ entry: TimeEntry) {
        if let index = entries.firstIndex(where: { $0.isSameEntry(as: entry) }) {
            entries[index] = entry
        } else {
            insert(entry)
        }
    }

    func tombstone(_ id: String) {
        closedShiftIds.removeAll { $0 == id }
        closedShiftIds.append(id)
        if closedShiftIds.count > Self.maxClosedShiftIds {
            closedShiftIds.removeFirst(closedShiftIds.count - Self.maxClosedShiftIds)
        }
    }

    func persist() {
        snapshotStore.save(TrackingSnapshot(activeShift: activeShift, entries: entries, closedShiftIds: closedShiftIds,
                                            lastRecordedPoint: lastRecordedPoint))
    }

    /// Queues a command; `flushCommands` sends it.
    func enqueue(_ action: TimeEntryAction, entryIds: [String], command: JSONValue, nextCommand: JSONValue? = nil,
                 at date: Date) async {
        await commands.enqueue(QueuedCommand(action: action, entryIds: entryIds, command: command,
                                             nextCommand: nextCommand, createdAt: date))
    }
}
