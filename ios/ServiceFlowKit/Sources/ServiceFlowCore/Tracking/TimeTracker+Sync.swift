import Foundation

/// Sending queued commands and reconciling with the server.
extension TimeTracker {
    /// Sends queued commands, then reloads the person's entries from the server.
    public func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        await flushCommands()
        await syncLocations()
        // Offline or failing: local data keeps working.
        if let rows = try? await backend.fetchOwnTimeEntries(userId: user.id, since: nil, limit: 1000) {
            await reconcile(rows)
        }
    }

    public func flushCommands() async {
        let backend = self.backend
        let outcomes = await commands.flush { command in
            try await backend.recordTimeEntryCommand(action: command.action.rawValue, command: command.command,
                                                     nextCommand: command.nextCommand)
        }
        outcomes.forEach(handle)
    }

    public func syncLocations() async {
        guard uploadsLocation else { return }
        let held = await commands.unacknowledgedEntryIds
        let backend = self.backend
        await locations.sync(heldBack: held, now: now()) { point, tracking in
            try await backend.recordLocationUpdate(point: point, tracking: tracking)
        }
    }

    func isAcknowledged(_ entryId: String) async -> Bool {
        !(await commands.unacknowledgedEntryIds.contains(entryId))
    }

    // MARK: Command outcomes

    private func handle(_ outcome: CommandOutcome) {
        let command = outcome.command
        if let error = outcome.permanentError {
            handleRefusal(of: command, error)
            return
        }
        guard let response = outcome.response else { return }
        switch command.action {
        case .clockIn, .clockOut, .adjust:
            if let row = TimeEntryCommand.firstRow(response) { acknowledge(row) }
        case .switchProject:
            if let completed = response["completed_entry"] { acknowledge(completed) }
            if let active = response["active_entry"] { acknowledge(active) }
        default:
            break
        }
    }

    private func handleRefusal(of command: QueuedCommand, _ error: BackendError) {
        let startsShift = command.action == .clockIn || command.action == .switchProject
        if startsShift, error.message.localizedCaseInsensitiveContains("already has an active time entry") {
            // Clocked in somewhere else (another device, or a manager): drop
            // the local shift; the next refresh adopts the real one.
            guard let local = activeShift, command.entryIds.contains(local.localId) else { return }
            dropActiveShift(tombstone: false)
            persist()
            notice = TrackingNotice(.problem, "You were already clocked in on another device. Showing that shift.")
        } else if command.action != .delete {
            notice = TrackingNotice(.problem, "A time change couldn't be saved: \(error.message)")
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
            entries[index].serverId = server.serverId
            entries[index].adjustmentHistory = server.adjustmentHistory
            persist()
        }
    }

    // MARK: Reconciliation

    /// The server's view of the person's entries.
    private struct ServerView {
        var entries: [String: (entry: TimeEntry, status: String?)] = [:]
        var active: TimeEntry?

        func status(of id: String) -> String? { entries[id]?.status }
    }

    /// Merges the server's view of the person's entries into local state.
    /// The server is the source of truth, except for entries with changes
    /// still on their way up.
    func reconcile(_ rows: [JSONValue]) async {
        let pendingIds = Set(await commands.pending.flatMap(\.entryIds))
        let current = now()
        var server = ServerView()
        for row in rows {
            guard let entry = TimeEntry(serverRow: row, now: current), entry.userId == user.id else { continue }
            server.entries[entry.localId] = (entry, TimeEntryRowStatus.of(row))
            if TimeEntryRowStatus.isActive(row) { server.active = entry }
        }

        let history = mergedHistory(server, pendingIds: pendingIds)
        reconcileActiveShift(server, pendingIds: pendingIds, now: current)
        entries = history.sorted { $0.startedAt > $1.startedAt }
        persist()
    }

    private func mergedHistory(_ server: ServerView, pendingIds: Set<String>) -> [TimeEntry] {
        var merged = entries.filter { pendingIds.contains($0.localId) }
        for (_, item) in server.entries where item.status == "completed" && !pendingIds.contains(item.entry.localId) {
            var entry = item.entry
            if let local = entries.first(where: { $0.isSameEntry(as: entry) }) {
                // Keep what only the device knows.
                entry.project.latitude = local.project.latitude
                entry.project.longitude = local.project.longitude
                entry.clockOutReason = local.clockOutReason
            }
            merged.append(entry)
        }
        return merged
    }

    private func reconcileActiveShift(_ server: ServerView, pendingIds: Set<String>, now current: Date) {
        if let active = activeShift, !pendingIds.contains(active.localId) {
            switch server.status(of: active.localId) {
            case "completed"?:
                // Ended on the server: by a manager or on another device.
                dropActiveShift()
                notice = TrackingNotice(.info, "Your shift at \(active.project.name) was clocked out.")
            case "deleted"?:
                dropActiveShift()
            case nil where active.serverId != nil:
                // Acknowledged before, now gone: removed on the server.
                dropActiveShift()
            default:
                break
            }
        } else if let active = activeShift, server.status(of: active.localId) == "deleted" {
            dropActiveShift()
        }

        guard let serverActive = server.active, !pendingIds.contains(serverActive.localId) else { return }
        if activeShift == nil, !closedShiftIds.contains(serverActive.localId) {
            var adopted = serverActive
            if let project = projects.first(where: { $0.id == adopted.project.id }) { adopted.project = project }
            activeShift = adopted
            reminders.scheduleReminders(for: adopted, now: current)
        } else if var active = activeShift, active.localId == serverActive.localId {
            // The start time may have been edited on the web.
            active.serverId = serverActive.serverId
            active.startedAt = serverActive.startedAt
            active.originalStartedAt = serverActive.originalStartedAt
            active.startEditedAt = serverActive.startEditedAt
            active.adjustmentHistory = serverActive.adjustmentHistory
            activeShift = active
        }
    }
}
