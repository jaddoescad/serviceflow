import Foundation

/// Clock in, clock out, switch, edits and deletes.
extension TimeTracker {
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
        let shift = newShift(on: job, at: startedAt)
        activeShift = shift
        locationStatus = nil
        suggestedProject = nil
        notice = nil
        persist()
        reminders.scheduleReminders(for: shift, now: startedAt)

        await enqueue(.clockIn, entryIds: [shift.localId], command: TimeEntryCommand.clockIn(shift, capturedAt: startedAt), at: startedAt)
        Task { await self.afterClockIn(shift.localId, authorized: authorization.isAuthorized) }
        return shift
    }

    /// Sends the clock-in, then records where the shift started.
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

    /// New entries use a UUID client id the server also uses as the row id.
    private func newShift(on project: Project, at date: Date, travelStartedAt: Date? = nil) -> TimeEntry {
        TimeEntry(localId: UUID().uuidString.lowercased(), userId: user.id, userEmail: user.email, userName: user.name,
                  project: project, originalStartedAt: date, startedAt: date, travelStartedAt: travelStartedAt)
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
            let fixStatus = LocationStatus(point: point, project: shift.project, projects: projects)
            shift = located(shift, at: point, status: fixStatus, sampledAt: endedAt)
            await queueRow(for: shift, point: point, event: .clockOut, status: fixStatus)
            status = fixStatus
        }
        shift.endedAt = endedAt
        shift.clockOutReason = reason
        shift.segments = SegmentBuilder.close(shift.segments, at: endedAt)

        dropActiveShift()
        notice = nil
        insert(shift)
        persist()

        let command = TimeEntryCommand.payload(for: shift, includeEndedAt: true, reason: reason.rawValue, capturedAt: endedAt)
        await enqueue(.clockOut, entryIds: [shift.localId], command: command, at: endedAt)
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
        let next = newShift(on: job, at: switchedAt, travelStartedAt: closing.travelStartedAt)

        activeShift = next
        insert(closing)
        tombstone(closing.localId)
        locationStatus = nil
        suggestedProject = nil
        notice = nil
        persist()
        reminders.scheduleReminders(for: next, now: switchedAt)

        await enqueue(
            .switchProject, entryIds: [closing.localId, next.localId],
            command: TimeEntryCommand.payload(for: closing, includeEndedAt: true, reason: ClockOutReason.switchedProject.rawValue,
                                              capturedAt: switchedAt),
            nextCommand: TimeEntryCommand.clockIn(next, capturedAt: switchedAt), at: switchedAt
        )
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
        let updated = try Self.edited(entry, startedAt: startedAt, endedAt: endedAt, now: current)

        if entry.isActive {
            guard activeShift?.localId == entry.localId else { throw TimeTrackingError.notClockedIn }
            activeShift = updated
        } else {
            replace(updated)
        }
        persist()

        let command = TimeEntryCommand.payload(for: updated, includeEndedAt: !updated.isActive,
                                               adjustmentSource: "mobile_time_edit", capturedAt: current)
        await enqueue(.adjust, entryIds: [updated.localId], command: command, at: current)
        Task { await self.flushCommands() }
    }

    /// The entry with new times, validated; the first and last segments follow
    /// the new start and end.
    static func edited(_ entry: TimeEntry, startedAt: Date, endedAt: Date?, now: Date) throws -> TimeEntry {
        guard startedAt <= now else { throw TimeTrackingError.invalidTimes("Clock-in time can't be in the future.") }
        var updated = entry
        updated.startedAt = startedAt
        if startedAt != entry.startedAt { updated.startEditedAt = now }
        if !entry.isActive {
            guard let endedAt else { throw TimeTrackingError.invalidTimes("Choose a clock-out time.") }
            guard endedAt > startedAt else { throw TimeTrackingError.invalidTimes("Clock-out time must be after clock-in time.") }
            guard endedAt <= now.addingTimeInterval(60) else {
                throw TimeTrackingError.invalidTimes("Clock-out time can't be in the future.")
            }
            updated.endedAt = endedAt
        }
        if var first = updated.segments.first, first.startedAt < startedAt || updated.segments.count == 1 {
            first.startedAt = startedAt
            updated.segments[0] = first
        }
        if let end = updated.endedAt, var last = updated.segments.last {
            last.endedAt = end
            updated.segments[updated.segments.count - 1] = last
        }
        return updated
    }

    /// Deletes an entry (the running shift included).
    public func deleteEntry(_ entry: TimeEntry) async {
        let current = now()
        if activeShift?.localId == entry.localId {
            dropActiveShift()
            await locations.setStatus(statusUpdate(for: entry, point: entry.lastLocation, mode: .clockedOut,
                                                   taskStatus: .stopped, status: nil, reason: "deleted"))
        }
        tombstone(entry.localId)
        entries.removeAll { $0.isSameEntry(as: entry) }
        persist()
        await enqueue(.delete, entryIds: [entry.localId], command: TimeEntryCommand.deletion(of: entry, capturedAt: current), at: current)
        Task {
            await self.flushCommands()
            await self.syncLocations()
        }
    }

    // MARK: Over-budget reasons

    /// Saves the answer to "What slowed it down?" for a job that went over
    /// budget. Queued like every other command, so it survives being offline.
    public func submitOverBudgetReason(jobId: String, reason: String, note: String?, minutesOver: Int) async {
        let clientId = "job-obr-\(UUID().uuidString.lowercased())"
        let command = TimeEntryCommand.jobIssue(clientId: clientId, jobId: jobId, reason: reason, note: note, minutesOver: minutesOver)
        await enqueue(.jobIssue, entryIds: [], command: command, at: now())
        await flushCommands()
    }
}
