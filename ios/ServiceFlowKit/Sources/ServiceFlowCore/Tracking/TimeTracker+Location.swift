import Foundation

/// Location samples, the manager-facing tracking status, and app lifecycle.
extension TimeTracker {
    // MARK: Samples

    /// A fix from the foreground location watcher or heartbeat.
    public func handleForegroundFix(_ point: LocationPoint) async {
        guard activeShift != nil, !isClockingOut, !applyingFix else { return }
        await apply(point, event: .location)
    }

    /// Updates the running shift with a fix and uploads it.
    func apply(_ point: LocationPoint, event: LocationEventType) async {
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
        // Keep the server row's location current too; best effort, never queued.
        if recorded, await isAcknowledged(updated.localId) {
            let observation = TimeEntryCommand.payload(for: updated, capturedAt: point.capturedAt)
            _ = try? await backend.recordTimeEntryCommand(action: TimeEntryAction.observation.rawValue, command: observation, nextCommand: nil)
        }
        await syncLocations()
    }

    /// The shift with a fix applied: locations, distance, on-site and segments.
    func located(_ shift: TimeEntry, at point: LocationPoint, status: LocationStatus, sampledAt: Date) -> TimeEntry {
        var next = shift
        if let coordinate = shift.project.coordinate ?? projects.first(where: { $0.id == shift.project.id })?.coordinate {
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

    /// Queues the fix as a location point when it's worth keeping.
    @discardableResult
    func queueRow(for shift: TimeEntry, point: LocationPoint, event: LocationEventType, status: LocationStatus?) async -> Bool {
        guard uploadsLocation else { return false }
        let mode = status?.mode ?? .unknown
        guard LocationSampling.shouldRecord(previous: lastRecordedPoint, point: point, mode: mode, event: event) else { return false }
        lastRecordedPoint = point
        let row = LocationRow(entry: shift, point: point, mode: event == .clockOut ? .clockedOut : mode, event: event, status: status)
        await locations.enqueue(row)
        return true
    }

    // MARK: Tracking status

    func statusUpdate(for shift: TimeEntry, point: LocationPoint?, mode: TrackingMode,
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

    /// Publishes the running shift's tracking status to managers.
    func publishStatus(mode: TrackingMode, taskStatus: TrackingStatusUpdate.TaskStatus,
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
}
