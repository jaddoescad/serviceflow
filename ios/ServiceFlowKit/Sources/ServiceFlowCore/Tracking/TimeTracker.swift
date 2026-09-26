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
@MainActor
@Observable
public final class TimeTracker {
    // MARK: Observable state

    public private(set) var activeShift: TimeEntry?
    /// The person's completed entries, newest first.
    public private(set) var entries: [TimeEntry] = []
    public private(set) var locationStatus: LocationStatus?
    public private(set) var suggestedProject: Project?
    public private(set) var notice: TrackingNotice?
    public private(set) var isClockingOut = false
    /// Jobs with coordinates, used for on-site checks and suggestions.
    public var projects: [Project] = []

    // MARK: Dependencies

    public let user: CrewMember
    private let backend: TimeTrackingBackend
    private let location: LocationProviding
    private let reminders: ShiftReminderScheduling
    private let commands: CommandQueue
    private let locations: LocationQueue
    private let snapshotStore: JSONFileStore<TrackingSnapshot>
    private let appVersion: String
    private let uploadsLocation: Bool
    private let now: @Sendable () -> Date

    @ObservationIgnored private var closedShiftIds: [String] = []
    @ObservationIgnored private var lastRecordedPoint: LocationPoint?
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var applyingFix = false

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

    // MARK: Clock in

    /// Starts a shift on `project`. Location is requested here (and only here)
    /// the first time; if the person declines, the shift still starts, just
    /// without location.
    @discardableResult
    public func clockIn(_ project: Project) async throws -> TimeEntry {
        if let activeShift {
            if activeShift.project.id == project.id { return activeShift }
            guard let switched = try await switchProject(to: project) else { throw TimeTrackingError.busy }
            return switched
        }
        let authorization = await location.requestAuthorizationIfNeeded()
        let job = try await clockInJob(for: project)
        guard activeShift == nil else { throw TimeTrackingError.alreadyClockedIn }

        let startedAt = now()
        let shift = TimeEntry(
            localId: UUID().uuidString.lowercased(), userId: user.id, userEmail: user.email, userName: user.name,
            project: job, originalStartedAt: startedAt, startedAt: startedAt
        )
        activeShift = shift
        locationStatus = nil
        suggestedProject = nil
        notice = nil
        persist()
        reminders.scheduleReminders(for: shift, now: startedAt)

        await commands.enqueue(QueuedCommand(action: .clockIn, entryIds: [shift.localId],
                                             command: TimeEntryCommand.clockIn(shift, capturedAt: startedAt), createdAt: startedAt))
        Task { await self.afterClockIn(shift.localId, authorized: authorization.isAuthorized) }
        return shift
    }

    private func afterClockIn(_ shiftId: String, authorized: Bool) async {
        await flushCommands()
        guard authorized else {
            await publishStatus(mode: .unavailable, taskStatus: .running, reason: "location_not_authorized")
            return
        }
        guard let point = await location.currentPoint(timeout: TrackingConstants.clockInLocationTimeout) else {
            if activeShift?.localId == shiftId {
                notice = TrackingNotice(.info, "Your location wasn't available yet. ServiceFlow will record it while the app is open.")
                await publishStatus(mode: .unknown, taskStatus: .running, errorCode: "initial_location_unavailable")
            }
            return
        }
        guard activeShift?.localId == shiftId else { return }
        await apply(point, event: .clockIn)
    }

    /// A lead becomes a job before anyone can clock into it.
    private func clockInJob(for project: Project) async throws -> Project {
        guard project.isLead else { return project }
        let row = try await backend.ensureLeadClockInJob(leadId: project.id)
        guard let job = TimeEntryCommand.firstRow(row).flatMap(Project.init(jobRow:)) else {
            throw TimeTrackingError.projectUnavailable("The lead could not be prepared for clock in.")
        }
        return job
    }

    // MARK: Clock out

    /// Ends the running shift. Returns the completed entry.
    @discardableResult
    public func clockOut(reason: ClockOutReason = .manual) async -> TimeEntry? {
        guard let expected = activeShift, !isClockingOut else { return nil }
        isClockingOut = true
        defer { isClockingOut = false }
        let endedAt = now()

        var point: LocationPoint?
        if location.authorization.isAuthorized {
            point = await location.currentPoint(timeout: TrackingConstants.clockOutLocationTimeout)
        }
        guard var shift = activeShift, shift.localId == expected.localId else { return nil }

        var status: LocationStatus?
        if let point {
            status = LocationStatus(point: point, project: shift.project, projects: projects)
            shift = located(shift, at: point, status: status!, sampledAt: endedAt)
            await queueRow(for: shift, point: point, event: .clockOut, status: status)
        }
        shift.endedAt = endedAt
        shift.clockOutReason = reason
        shift.segments = SegmentBuilder.close(shift.segments, at: endedAt)

        activeShift = nil
        locationStatus = nil
        suggestedProject = nil
        notice = nil
        insert(shift)
        tombstone(shift.localId)
        persist()
        reminders.cancelReminders()

        let command = TimeEntryCommand.payload(for: shift, includeEndedAt: true, reason: reason.rawValue, capturedAt: endedAt)
        await commands.enqueue(QueuedCommand(action: .clockOut, entryIds: [shift.localId], command: command, createdAt: endedAt))
        await locations.setStatus(statusUpdate(for: shift, point: shift.lastLocation, mode: .clockedOut, taskStatus: .stopped,
                                               status: status, reason: reason.rawValue))
        Task {
            await self.flushCommands()
            await self.syncLocations()
        }
        return shift
    }

    // MARK: Switch

    /// Closes the running shift and starts one on `project` in one step.
    @discardableResult
    public func switchProject(to project: Project) async throws -> TimeEntry? {
        guard let current = activeShift else { return try await clockIn(project) }
        guard current.project.id != project.id else { return current }
        guard !isClockingOut else { throw TimeTrackingError.busy }
        let job = try await clockInJob(for: project)
        guard var closing = activeShift, closing.localId == current.localId else { return nil }

        let switchedAt = now()
        closing.endedAt = switchedAt
        closing.clockOutReason = .switchedProject
        closing.segments = SegmentBuilder.close(closing.segments, at: switchedAt)
        let next = TimeEntry(
            localId: UUID().uuidString.lowercased(), userId: user.id, userEmail: user.email, userName: user.name,
            project: job, originalStartedAt: switchedAt, startedAt: switchedAt, travelStartedAt: closing.travelStartedAt
        )

        activeShift = next
        insert(closing)
        tombstone(closing.localId)
        locationStatus = nil
        suggestedProject = nil
        notice = nil
        persist()
        reminders.scheduleReminders(for: next, now: switchedAt)

        await commands.enqueue(QueuedCommand(
            action: .switchProject, entryIds: [closing.localId, next.localId],
            command: TimeEntryCommand.payload(for: closing, includeEndedAt: true, reason: ClockOutReason.switchedProject.rawValue,
                                              capturedAt: switchedAt),
            nextCommand: TimeEntryCommand.clockIn(next, capturedAt: switchedAt), createdAt: switchedAt
        ))
        let authorized = location.authorization.isAuthorized
        Task {
            await self.flushCommands()
            guard authorized, let point = await self.location.currentPoint(timeout: TrackingConstants.clockOutLocationTimeout),
                  self.activeShift?.localId == next.localId else { return }
            await self.apply(point, event: .projectSwitch)
        }
        return next
    }

    // MARK: Edit and delete

    /// Moves the running shift's start by `minutes` (the ±5m buttons).
    public func adjustActiveStart(byMinutes minutes: Int) async throws {
        guard let shift = activeShift else { throw TimeTrackingError.notClockedIn }
        let next = shift.startedAt.addingTimeInterval(TimeInterval(minutes * 60))
        guard next <= now() else { throw TimeTrackingError.invalidTimes("Start time can't be later than now.") }
        try await updateEntry(shift, startedAt: next, endedAt: nil)
    }

    /// Changes an entry's times. A running shift can only change its start.
    public func updateEntry(_ entry: TimeEntry, startedAt: Date, endedAt: Date?) async throws {
        let current = now()
        guard startedAt <= current else { throw TimeTrackingError.invalidTimes("Clock-in time can't be in the future.") }
        var updated = entry
        updated.startedAt = startedAt
        if updated.startedAt != entry.startedAt { updated.startEditedAt = current }
        if !entry.isActive {
            guard let endedAt else { throw TimeTrackingError.invalidTimes("Choose a clock-out time.") }
            guard endedAt > startedAt else { throw TimeTrackingError.invalidTimes("Clock-out time must be after clock-in time.") }
            guard endedAt <= current.addingTimeInterval(60) else {
                throw TimeTrackingError.invalidTimes("Clock-out time can't be in the future.")
            }
            updated.endedAt = endedAt
        }
        if var first = updated.segments.first, first.startedAt < startedAt || updated.segments.count == 1 {
            first.startedAt = startedAt
            updated.segments[0] = first
        }
        if let endedAt = updated.endedAt, var last = updated.segments.last {
            last.endedAt = endedAt
            updated.segments[updated.segments.count - 1] = last
        }

        if entry.isActive {
            guard activeShift?.localId == entry.localId else { throw TimeTrackingError.notClockedIn }
            activeShift = updated
        } else {
            replace(updated)
        }
        persist()

        let command = TimeEntryCommand.payload(for: updated, includeEndedAt: !updated.isActive,
                                               adjustmentSource: "mobile_time_edit", capturedAt: current)
        await commands.enqueue(QueuedCommand(action: .adjust, entryIds: [updated.localId], command: command, createdAt: current))
        Task { await self.flushCommands() }
    }

    /// Deletes an entry (the running shift included).
    public func deleteEntry(_ entry: TimeEntry) async {
        let current = now()
        if activeShift?.localId == entry.localId {
            activeShift = nil
            locationStatus = nil
            suggestedProject = nil
            reminders.cancelReminders()
            await locations.setStatus(statusUpdate(for: entry, point: entry.lastLocation, mode: .clockedOut,
                                                   taskStatus: .stopped, status: nil, reason: "deleted"))
        }
        tombstone(entry.localId)
        entries.removeAll { $0.isSameEntry(as: entry) }
        persist()
        await commands.enqueue(QueuedCommand(action: .delete, entryIds: [entry.localId],
                                             command: TimeEntryCommand.deletion(of: entry, capturedAt: current), createdAt: current))
        Task {
            await self.flushCommands()
            await self.syncLocations()
        }
    }

    // MARK: Location samples

    /// A fix from the foreground location watcher or heartbeat.
    public func handleForegroundFix(_ point: LocationPoint) async {
        guard activeShift != nil, !isClockingOut, !applyingFix else { return }
        await apply(point, event: .location)
    }

    private func apply(_ point: LocationPoint, event: LocationEventType) async {
        guard let shift = activeShift else { return }
        applyingFix = true
        defer { applyingFix = false }
        let status = LocationStatus(point: point, project: shift.project, projects: projects)
        let updated = located(shift, at: point, status: status, sampledAt: now())
        activeShift = updated
        locationStatus = status
        suggestedProject = status.suggestedProject
        if notice?.kind == .info { notice = nil }
        let recorded = await queueRow(for: updated, point: point, event: event, status: status)
        persist()

        await locations.setStatus(statusUpdate(for: updated, point: point, mode: status.mode, taskStatus: .running, status: status))
        if recorded, await isAcknowledged(updated.localId) {
            let observation = TimeEntryCommand.payload(for: updated, capturedAt: point.capturedAt)
            _ = try? await backend.recordTimeEntryCommand(action: TimeEntryAction.observation.rawValue, command: observation, nextCommand: nil)
        }
        await syncLocations()
    }

    private func located(_ shift: TimeEntry, at point: LocationPoint, status: LocationStatus, sampledAt: Date) -> TimeEntry {
        var next = shift
        if let coordinate = shift.project.coordinate {
            next.project.latitude = coordinate.latitude
            next.project.longitude = coordinate.longitude
        } else if let known = projects.first(where: { $0.id == shift.project.id }), let coordinate = known.coordinate {
            next.project.latitude = coordinate.latitude
            next.project.longitude = coordinate.longitude
        }
        if next.startedLocation == nil { next.startedLocation = point }
        next.lastLocation = point
        if status.reliable {
            next.lastDistanceMeters = status.activeDistance
            next.onSite = status.onSite
        }
        if status.mode == .travel, next.travelStartedAt == nil { next.travelStartedAt = sampledAt }
        let mode: SiteMode = status.reliable ? SiteMode(onSite: status.onSite) : .unknown
        next.segments = SegmentBuilder.append(next.segments, mode: mode, at: sampledAt, distance: status.activeDistance,
                                              location: point, shiftStart: next.startedAt)
        return next
    }

    @discardableResult
    private func queueRow(for shift: TimeEntry, point: LocationPoint, event: LocationEventType, status: LocationStatus?) async -> Bool {
        guard uploadsLocation else { return false }
        let mode = status?.mode ?? .unknown
        guard LocationSampling.shouldRecord(previous: lastRecordedPoint, point: point, mode: mode, event: event) else { return false }
        lastRecordedPoint = point
        let row = LocationRow(entry: shift, point: point, mode: event == .clockOut ? .clockedOut : mode, event: event, status: status)
        await locations.enqueue(row)
        return true
    }

    private func statusUpdate(for shift: TimeEntry, point: LocationPoint?, mode: TrackingMode,
                              taskStatus: TrackingStatusUpdate.TaskStatus, status: LocationStatus?,
                              reason: String? = nil, errorCode: String? = nil) -> TrackingStatusUpdate {
        TrackingStatusUpdate(
            clientEntryId: shift.localId, jobId: TimeEntryCommand.isUUID(shift.project.id) ? shift.project.id : nil,
            point: point, mode: mode, taskStatus: taskStatus, permissionForeground: location.authorization.isAuthorized,
            appVersion: appVersion, lastErrorCode: errorCode, onSite: status?.onSite ?? shift.onSite,
            distanceMeters: (status?.activeDistance ?? shift.lastDistanceMeters).map { Int($0.rounded()) },
            reason: reason, updatedAt: now()
        )
    }

    private func publishStatus(mode: TrackingMode, taskStatus: TrackingStatusUpdate.TaskStatus,
                               reason: String? = nil, errorCode: String? = nil) async {
        guard uploadsLocation, let shift = activeShift else { return }
        await locations.setStatus(statusUpdate(for: shift, point: shift.lastLocation, mode: mode, taskStatus: taskStatus,
                                               status: locationStatus, reason: reason, errorCode: errorCode))
        await syncLocations()
    }

    // MARK: App lifecycle

    /// The app went to the background: location stops until it's opened again.
    public func appDidEnterBackground() async {
        await publishStatus(mode: locationStatus?.mode ?? .unknown, taskStatus: .paused, reason: "app_backgrounded")
        await flushCommands()
    }

    public func appDidBecomeActive() async {
        if activeShift != nil {
            await publishStatus(mode: locationStatus?.mode ?? .unknown, taskStatus: .running, reason: "app_opened")
        }
        await refresh()
    }

    // MARK: Server sync

    /// Sends queued commands, then reloads the person's entries from the server.
    public func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        await flushCommands()
        await syncLocations()
        do {
            let rows = try await backend.fetchOwnTimeEntries(userId: user.id, since: nil, limit: 1000)
            await reconcile(rows)
        } catch {
            // Offline or failing: local data keeps working.
        }
    }

    public func flushCommands() async {
        let backend = self.backend
        let outcomes = await commands.flush { command in
            try await backend.recordTimeEntryCommand(action: command.action.rawValue, command: command.command,
                                                     nextCommand: command.nextCommand)
        }
        for outcome in outcomes { handle(outcome) }
    }

    public func syncLocations() async {
        guard uploadsLocation else { return }
        let held = await commands.unacknowledgedEntryIds
        let backend = self.backend
        await locations.sync(heldBack: held, now: now()) { point, tracking in
            try await backend.recordLocationUpdate(point: point, tracking: tracking)
        }
    }

    private func isAcknowledged(_ entryId: String) async -> Bool {
        !(await commands.unacknowledgedEntryIds.contains(entryId))
    }

    private func handle(_ outcome: CommandOutcome) {
        let command = outcome.command
        if let error = outcome.permanentError {
            if command.action == .clockIn || command.action == .switchProject,
               error.message.localizedCaseInsensitiveContains("already has an active time entry") {
                // Clocked in somewhere else (another device, or a manager).
                // Drop the local shift; the next refresh adopts the real one.
                if let local = activeShift, command.entryIds.contains(local.localId) {
                    activeShift = nil
                    reminders.cancelReminders()
                    persist()
                    notice = TrackingNotice(.problem, "You were already clocked in on another device. Showing that shift.")
                }
            } else if command.action != .delete {
                notice = TrackingNotice(.problem, "A time change couldn't be saved: \(error.message)")
            }
            return
        }
        guard let response = outcome.response else { return }
        switch command.action {
        case .clockIn:
            if let row = TimeEntryCommand.firstRow(response) { acknowledge(row) }
        case .switchProject:
            if let completed = response["completed_entry"] { acknowledge(completed) }
            if let active = response["active_entry"] { acknowledge(active) }
        case .clockOut, .adjust:
            if let row = TimeEntryCommand.firstRow(response) { acknowledge(row) }
        default:
            break
        }
    }

    /// Records the server id and server-owned fields from a returned row.
    private func acknowledge(_ row: JSONValue) {
        guard let server = TimeEntry(serverRow: row, now: now()) else { return }
        if var shift = activeShift, shift.localId == server.localId {
            shift.serverId = server.serverId
            shift.adjustmentHistory = server.adjustmentHistory
            activeShift = shift
            persist()
        } else if let index = entries.firstIndex(where: { $0.isSameEntry(as: server) }), TimeEntryRowStatus.isCompleted(row) {
            var local = entries[index]
            local.serverId = server.serverId
            local.adjustmentHistory = server.adjustmentHistory
            entries[index] = local
            persist()
        }
    }

    /// Merges the server's view of the person's entries into local state.
    func reconcile(_ rows: [JSONValue]) async {
        let pending = await commands.pending
        let pendingIds = Set(pending.flatMap(\.entryIds))
        let current = now()
        var serverEntries: [String: (entry: TimeEntry, status: String?)] = [:]
        var activeRow: TimeEntry?
        for row in rows {
            guard let entry = TimeEntry(serverRow: row, now: current), entry.userId == user.id else { continue }
            serverEntries[entry.localId] = (entry, TimeEntryRowStatus.of(row))
            if TimeEntryRowStatus.isActive(row) { activeRow = entry }
        }

        // Completed history: the server wins, except for entries with changes
        // still on their way up.
        var merged = entries.filter { pendingIds.contains($0.localId) }
        for (_, item) in serverEntries where item.status == "completed" && !pendingIds.contains(item.entry.localId) {
            var entry = item.entry
            if let local = entries.first(where: { $0.isSameEntry(as: entry) }) {
                // Keep what only the device knows.
                entry.project.latitude = local.project.latitude
                entry.project.longitude = local.project.longitude
                entry.clockOutReason = local.clockOutReason
            }
            merged.append(entry)
        }
        if let active = activeShift, let item = serverEntries[active.localId], item.status == "completed", !pendingIds.contains(active.localId) {
            // Ended on the server: by a manager or on another device.
            activeShift = nil
            locationStatus = nil
            suggestedProject = nil
            reminders.cancelReminders()
            tombstone(active.localId)
            notice = TrackingNotice(.info, "Your shift at \(active.project.name) was clocked out.")
        } else if let active = activeShift, let item = serverEntries[active.localId], item.status == "deleted" {
            activeShift = nil
            locationStatus = nil
            reminders.cancelReminders()
            tombstone(active.localId)
        } else if let active = activeShift, serverEntries[active.localId] == nil, !pendingIds.contains(active.localId),
                  active.serverId != nil {
            // Acknowledged before, now gone: removed on the server.
            activeShift = nil
            locationStatus = nil
            reminders.cancelReminders()
            tombstone(active.localId)
        }

        if activeShift == nil, let serverActive = activeRow, !closedShiftIds.contains(serverActive.localId),
           !pendingIds.contains(serverActive.localId) {
            var adopted = serverActive
            if let project = projects.first(where: { $0.id == adopted.project.id }) {
                adopted.project = project
            }
            activeShift = adopted
            reminders.scheduleReminders(for: adopted, now: current)
        } else if var active = activeShift, let serverActive = activeRow, serverActive.localId == active.localId,
                  !pendingIds.contains(active.localId) {
            // Start time may have been edited on the web.
            active.serverId = serverActive.serverId
            active.startedAt = serverActive.startedAt
            active.originalStartedAt = serverActive.originalStartedAt
            active.startEditedAt = serverActive.startEditedAt
            active.adjustmentHistory = serverActive.adjustmentHistory
            activeShift = active
        }

        entries = merged.sorted { $0.startedAt > $1.startedAt }
        persist()
    }

    // MARK: Local state helpers

    private func insert(_ entry: TimeEntry) {
        entries.removeAll { $0.isSameEntry(as: entry) }
        entries.insert(entry, at: 0)
        entries.sort { $0.startedAt > $1.startedAt }
    }

    private func replace(_ entry: TimeEntry) {
        if let index = entries.firstIndex(where: { $0.isSameEntry(as: entry) }) {
            entries[index] = entry
        } else {
            insert(entry)
        }
    }

    private func tombstone(_ id: String) {
        closedShiftIds.removeAll { $0 == id }
        closedShiftIds.append(id)
        if closedShiftIds.count > 64 { closedShiftIds.removeFirst(closedShiftIds.count - 64) }
    }

    private func persist() {
        snapshotStore.save(TrackingSnapshot(activeShift: activeShift, entries: entries, closedShiftIds: closedShiftIds,
                                            lastRecordedPoint: lastRecordedPoint))
    }

    /// Forgets this person's local data (used on sign-out and account deletion).
    public func eraseLocalData() async {
        reminders.cancelReminders()
        await commands.removeAll()
        await locations.removeAll()
        snapshotStore.delete()
        activeShift = nil
        entries = []
    }

    /// Saves the answer to "What slowed it down?" for a job that went over
    /// budget. Queued like every other command, so it survives being offline.
    public func submitOverBudgetReason(jobId: String, reason: String, note: String?, minutesOver: Int) async {
        let clientId = "job-obr-\(UUID().uuidString.lowercased())"
        let command = TimeEntryCommand.jobIssue(clientId: clientId, jobId: jobId, reason: reason, note: note, minutesOver: minutesOver)
        await commands.enqueue(QueuedCommand(action: .jobIssue, entryIds: [], command: command, createdAt: now()))
        await flushCommands()
    }

    /// Commands still waiting for the server.
    public func pendingCommandCount() async -> Int { await commands.pending.count }
}
