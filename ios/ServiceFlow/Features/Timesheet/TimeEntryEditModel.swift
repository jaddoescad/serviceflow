import Observation
import ServiceFlowCore
import SwiftUI

/// Editing state for one of your own clock-ins, shared by the Timesheet and
/// Project Detail edit screens: the chosen times, whether they can be saved,
/// and save / delete through the time tracker.
@MainActor
@Observable
final class TimeEntryEditModel {
    let entry: TimeEntry
    var startAt: Date { didSet { error = nil } }
    var endAt: Date { didSet { error = nil } }
    private(set) var busy = false
    private(set) var error: String?

    init(entry: TimeEntry) {
        self.entry = entry
        startAt = entry.startedAt
        endAt = entry.endedAt ?? entry.startedAt
    }

    /// A running shift can only change its start.
    var isActive: Bool { entry.isActive }

    private var startChanged: Bool { Int(startAt.timeIntervalSince(entry.startedAt)) != 0 }
    private var endChanged: Bool { !isActive && Int(endAt.timeIntervalSince(entry.endedAt ?? entry.startedAt)) != 0 }

    var canSave: Bool {
        guard !busy else { return false }
        if isActive { return startChanged }
        return (startChanged || endChanged) && endAt > startAt
    }

    /// Duration as edited; a running shift counts up to `now`.
    func duration(now: Date) -> TimeInterval {
        max(0, (isActive ? now : endAt).timeIntervalSince(startAt))
    }

    /// `Original in 7:00 AM · edited 4:02 PM`, when the times were changed.
    var originalTimeNote: String? {
        TimesheetBuilder.originalTimeNote(entry: entry, startAt: startAt, endAt: isActive ? nil : endAt)
    }

    /// Saves the new times. Returns true on success; otherwise `error` says why.
    func save(with tracker: TimeTracker) async -> Bool {
        guard canSave else { return false }
        busy = true
        defer { busy = false }
        do {
            try await tracker.updateEntry(entry, startedAt: startAt, endedAt: isActive ? nil : endAt)
            return true
        } catch {
            let message = error.localizedDescription
            self.error = message.isEmpty ? "Could not save changes. Try again." : message
            return false
        }
    }

    func delete(with tracker: TimeTracker) async {
        busy = true
        defer { busy = false }
        await tracker.deleteEntry(entry)
    }
}

extension TimeEntryEditModel {
    static let inProgressHint = "This shift is still in progress. Only the start time can be changed."
}
