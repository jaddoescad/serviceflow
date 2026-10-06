package com.serviceflow.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

/** What is kept on disk for one person. */
@Serializable
internal data class TrackingSnapshot(
    val activeShift: TimeEntry? = null,
    val entries: List<TimeEntry> = emptyList(),
    /** Shifts closed on this device. A stale server read can't bring them back. */
    val closedShiftIds: List<String> = emptyList(),
    val lastRecordedPoint: LocationPoint? = null,
)

/**
 * The single owner of shift state: clock in, clock out, switch, edits,
 * deletes, location samples and server reconciliation.
 *
 * Every change is applied locally first and saved to disk, then sent through
 * the durable [CommandQueue], so the app behaves the same offline.
 *
 * The Swift class is split into extensions by concern; here they are sections
 * of one class:
 * - Shifts (`TimeTracker+Shifts.swift`): clock in/out, switch, edit, delete.
 * - Location (`TimeTracker+Location.swift`): location samples and tracking status.
 * - Sync (`TimeTracker+Sync.swift`): sending commands and reconciling with the server.
 *
 * Like the Swift `@MainActor` class, it is used from one thread: call it on
 * the main dispatcher. Follow-up work (background flushes, the clock-in fix)
 * is launched in [scope], which should run on the main dispatcher too.
 */
class TimeTracker(
    val user: CrewMember,
    storage: UserStorage,
    internal val backend: TimeTrackingBackend,
    internal val location: LocationProviding,
    internal val reminders: ShiftReminderScheduling,
    internal val appVersion: String,
    /** False when location uploads are switched off for this build. */
    internal val uploadsLocation: Boolean = true,
    internal val scope: CoroutineScope,
    internal val now: () -> Instant = { Instant.now() },
) {
    // MARK: Observable state

    private val _activeShift = MutableStateFlow<TimeEntry?>(null)
    val activeShift: StateFlow<TimeEntry?> = _activeShift.asStateFlow()

    /** The person's completed entries, newest first. */
    private val _entries = MutableStateFlow<List<TimeEntry>>(emptyList())
    val entries: StateFlow<List<TimeEntry>> = _entries.asStateFlow()

    private val _locationStatus = MutableStateFlow<LocationStatus?>(null)
    val locationStatus: StateFlow<LocationStatus?> = _locationStatus.asStateFlow()

    private val _suggestedProject = MutableStateFlow<Project?>(null)
    val suggestedProject: StateFlow<Project?> = _suggestedProject.asStateFlow()

    private val _notice = MutableStateFlow<TrackingNotice?>(null)
    val notice: StateFlow<TrackingNotice?> = _notice.asStateFlow()

    private val _isClockingOut = MutableStateFlow(false)
    val isClockingOut: StateFlow<Boolean> = _isClockingOut.asStateFlow()

    /** Jobs with coordinates, used for on-site checks and suggestions. */
    var projects: List<Project> = emptyList()

    // MARK: Dependencies

    internal val commands = CommandQueue(storage.store("time-entry-commands", ListSerializer(QueuedCommand.serializer())))
    internal val locations = LocationQueue(File(storage.directory, "location-queue.json"))
    internal val snapshotStore = storage.store("time-tracking", TrackingSnapshot.serializer())

    // MARK: Bookkeeping

    internal var closedShiftIds: List<String> = emptyList()
    internal var lastRecordedPoint: LocationPoint? = null
    internal var refreshing = false
    internal var applyingFix = false

    init {
        val snapshot = snapshotStore.load() ?: TrackingSnapshot()
        _activeShift.value = snapshot.activeShift?.takeIf { it.userId == user.id }
        _entries.value = snapshot.entries.filter { it.userId == user.id }
        closedShiftIds = snapshot.closedShiftIds
        lastRecordedPoint = snapshot.lastRecordedPoint
        _activeShift.value?.let { reminders.scheduleReminders(it, now()) }
    }

    // MARK: Derived values

    /** Completed entries plus the running shift, newest first. */
    val allEntries: List<TimeEntry> get() = listOfNotNull(_activeShift.value) + _entries.value

    /** Seconds worked today; an entry counts towards the day it started. */
    fun workedToday(zone: ZoneId = ZoneId.systemDefault()): Double {
        val current = now()
        val midnight = current.atZone(zone).toLocalDate().atStartOfDay(zone).toInstant()
        return allEntries.filter { it.startedAt >= midnight }.sumOf { it.duration(current) }
    }

    /** Your time per job in seconds, e.g. `{"<job id>": 26100.0}`. */
    fun myTimeByProject(): Map<String, Double> {
        val current = now()
        val totals = linkedMapOf<String, Double>()
        for (entry in allEntries) totals[entry.project.id] = (totals[entry.project.id] ?: 0.0) + entry.duration(current)
        return totals
    }

    fun clearNotice() {
        _notice.value = null
    }

    /** Commands still waiting for the server. */
    suspend fun pendingCommandCount(): Int = commands.pending.size

    /** Forgets this person's local data (used on sign-out and account deletion). */
    suspend fun eraseLocalData() {
        reminders.cancelReminders()
        commands.removeAll()
        locations.removeAll()
        snapshotStore.delete()
        _activeShift.value = null
        _entries.value = emptyList()
    }

    // MARK: Local state helpers

    /**
     * Clears the running shift on this device only (no command is sent).
     * A tombstoned shift can't be revived by a stale server read.
     */
    internal fun dropActiveShift(tombstone: Boolean = true) {
        val id = _activeShift.value?.localId ?: return
        _activeShift.value = null
        _locationStatus.value = null
        _suggestedProject.value = null
        reminders.cancelReminders()
        if (tombstone) tombstone(id)
    }

    /** Adds or moves an entry into the history, keeping it newest first. */
    internal fun insert(entry: TimeEntry) {
        _entries.value = (_entries.value.filter { !it.isSameEntry(entry) } + entry).sortedByDescending { it.startedAt }
    }

    internal fun replace(entry: TimeEntry) {
        val list = _entries.value
        val index = list.indexOfFirst { it.isSameEntry(entry) }
        if (index >= 0) {
            _entries.value = list.toMutableList().also { it[index] = entry }
        } else {
            insert(entry)
        }
    }

    internal fun tombstone(id: String) {
        var ids = closedShiftIds.filter { it != id } + id
        if (ids.size > maxClosedShiftIds) ids = ids.drop(ids.size - maxClosedShiftIds)
        closedShiftIds = ids
    }

    internal fun persist() {
        snapshotStore.save(
            TrackingSnapshot(
                activeShift = _activeShift.value, entries = _entries.value, closedShiftIds = closedShiftIds,
                lastRecordedPoint = lastRecordedPoint,
            ),
        )
    }

    /** Queues a command; `flushCommands` sends it. */
    internal suspend fun enqueue(
        action: TimeEntryAction, entryIds: List<String>, command: JSONValue, nextCommand: JSONValue? = null, at: Instant,
    ) {
        commands.enqueue(QueuedCommand(action = action, entryIds = entryIds, command = command, nextCommand = nextCommand, createdAt = at))
    }

    // =====================================================================
    // Shifts (TimeTracker+Shifts.swift): clock in, clock out, switch, edits and deletes.
    // =====================================================================

    // MARK: Clock in

    /**
     * Starts a shift on `project`. Location is requested here (and only here)
     * the first time; if the person declines, the shift still starts, just
     * without location.
     */
    suspend fun clockIn(project: Project): TimeEntry {
        _activeShift.value?.let { activeShift ->
            if (activeShift.project.id == project.id) return activeShift
            return switchProject(project) ?: throw TimeTrackingError.Busy
        }
        val authorization = location.requestAuthorizationIfNeeded()
        val job = clockInJob(project)
        if (_activeShift.value != null) throw TimeTrackingError.AlreadyClockedIn

        val startedAt = now()
        val shift = newShift(job, startedAt)
        _activeShift.value = shift
        _locationStatus.value = null
        _suggestedProject.value = null
        _notice.value = null
        persist()
        reminders.scheduleReminders(shift, startedAt)

        enqueue(TimeEntryAction.ClockIn, listOf(shift.localId), TimeEntryCommand.clockIn(shift, capturedAt = startedAt), at = startedAt)
        scope.launch { afterClockIn(shift.localId, authorization.isAuthorized) }
        return shift
    }

    /** Sends the clock-in, then records where the shift started. */
    private suspend fun afterClockIn(shiftId: String, authorized: Boolean) {
        flushCommands()
        if (!authorized) {
            publishStatus(TrackingMode.Unavailable, TrackingStatusUpdate.TaskStatus.Running, reason = "location_not_authorized")
            return
        }
        val point = location.currentPoint(TrackingConstants.clockInLocationTimeout)
        if (point == null) {
            if (_activeShift.value?.localId == shiftId) {
                _notice.value = TrackingNotice(
                    TrackingNotice.Kind.Info, "Your location wasn't available yet. ServiceFlow will record it while the app is open.",
                )
                publishStatus(TrackingMode.Unknown, TrackingStatusUpdate.TaskStatus.Running, errorCode = "initial_location_unavailable")
            }
            return
        }
        if (_activeShift.value?.localId != shiftId) return
        apply(point, LocationEventType.ClockIn)
    }

    /** A lead becomes a job before anyone can clock into it. */
    private suspend fun clockInJob(project: Project): Project {
        if (!project.isLead) return project
        val row = backend.ensureLeadClockInJob(project.id)
        return TimeEntryCommand.firstRow(row)?.let { Project.fromJobRow(it) }
            ?: throw TimeTrackingError.ProjectUnavailable("The lead could not be prepared for clock in.")
    }

    /** New entries use a UUID client id the server also uses as the row id. */
    private fun newShift(project: Project, date: Instant, travelStartedAt: Instant? = null): TimeEntry =
        TimeEntry(
            localId = UUID.randomUUID().toString().lowercase(), userId = user.id, userEmail = user.email, userName = user.name,
            project = project, originalStartedAt = date, startedAt = date, travelStartedAt = travelStartedAt,
        )

    // MARK: Clock out

    /** Ends the running shift. Returns the completed entry. */
    suspend fun clockOut(reason: ClockOutReason = ClockOutReason.Manual): TimeEntry? {
        val expected = _activeShift.value ?: return null
        if (_isClockingOut.value) return null
        _isClockingOut.value = true
        try {
            val endedAt = now()

            var point: LocationPoint? = null
            if (location.authorization.isAuthorized) {
                point = location.currentPoint(TrackingConstants.clockOutLocationTimeout)
            }
            var shift = _activeShift.value
            if (shift == null || shift.localId != expected.localId) return null

            var status: LocationStatus? = null
            if (point != null) {
                val fixStatus = LocationStatus(point = point, project = shift.project, projects = projects)
                shift = located(shift, point, fixStatus, endedAt)
                queueRow(shift, point, LocationEventType.ClockOut, fixStatus)
                status = fixStatus
            }
            shift = shift.copy(endedAt = endedAt, clockOutReason = reason, segments = SegmentBuilder.close(shift.segments, at = endedAt))

            dropActiveShift()
            _notice.value = null
            insert(shift)
            persist()

            val command = TimeEntryCommand.payload(shift, includeEndedAt = true, reason = reason.rawValue, capturedAt = endedAt)
            enqueue(TimeEntryAction.ClockOut, listOf(shift.localId), command, at = endedAt)
            locations.setStatus(
                statusUpdate(
                    shift, shift.lastLocation, TrackingMode.ClockedOut, TrackingStatusUpdate.TaskStatus.Stopped,
                    status, reason = reason.rawValue,
                ),
            )
            scope.launch {
                flushCommands()
                syncLocations()
            }
            return shift
        } finally {
            _isClockingOut.value = false
        }
    }

    // MARK: Switch

    /** Closes the running shift and starts one on `project` in one step. */
    suspend fun switchProject(to: Project): TimeEntry? {
        val project = to
        val current = _activeShift.value ?: return clockIn(project)
        if (current.project.id == project.id) return current
        if (_isClockingOut.value) throw TimeTrackingError.Busy
        val job = clockInJob(project)
        var closing = _activeShift.value
        if (closing == null || closing.localId != current.localId) return null

        val switchedAt = now()
        closing = closing.copy(
            endedAt = switchedAt,
            clockOutReason = ClockOutReason.SwitchedProject,
            segments = SegmentBuilder.close(closing.segments, at = switchedAt),
        )
        val next = newShift(job, switchedAt, travelStartedAt = closing.travelStartedAt)

        _activeShift.value = next
        insert(closing)
        tombstone(closing.localId)
        _locationStatus.value = null
        _suggestedProject.value = null
        _notice.value = null
        persist()
        reminders.scheduleReminders(next, switchedAt)

        enqueue(
            TimeEntryAction.SwitchProject, listOf(closing.localId, next.localId),
            command = TimeEntryCommand.payload(
                closing, includeEndedAt = true, reason = ClockOutReason.SwitchedProject.rawValue, capturedAt = switchedAt,
            ),
            nextCommand = TimeEntryCommand.clockIn(next, capturedAt = switchedAt), at = switchedAt,
        )
        val authorized = location.authorization.isAuthorized
        scope.launch {
            flushCommands()
            if (!authorized) return@launch
            val point = location.currentPoint(TrackingConstants.clockOutLocationTimeout) ?: return@launch
            if (_activeShift.value?.localId != next.localId) return@launch
            apply(point, LocationEventType.ProjectSwitch)
        }
        return next
    }

    // MARK: Edit and delete

    /** Moves the running shift's start by `minutes` (the ±5m buttons). */
    suspend fun adjustActiveStart(byMinutes: Int) {
        val shift = _activeShift.value ?: throw TimeTrackingError.NotClockedIn
        val next = shift.startedAt.plusSeconds(byMinutes * 60L)
        if (next > now()) throw TimeTrackingError.InvalidTimes("Start time can't be later than now.")
        updateEntry(shift, startedAt = next, endedAt = null)
    }

    /** Changes an entry's times. A running shift can only change its start. */
    suspend fun updateEntry(entry: TimeEntry, startedAt: Instant, endedAt: Instant?) {
        val current = now()
        val updated = edited(entry, startedAt, endedAt, current)

        if (entry.isActive) {
            if (_activeShift.value?.localId != entry.localId) throw TimeTrackingError.NotClockedIn
            _activeShift.value = updated
        } else {
            replace(updated)
        }
        persist()

        val command = TimeEntryCommand.payload(
            updated, includeEndedAt = !updated.isActive, adjustmentSource = "mobile_time_edit", capturedAt = current,
        )
        enqueue(TimeEntryAction.Adjust, listOf(updated.localId), command, at = current)
        scope.launch { flushCommands() }
    }

    /** Deletes an entry (the running shift included). */
    suspend fun deleteEntry(entry: TimeEntry) {
        val current = now()
        if (_activeShift.value?.localId == entry.localId) {
            dropActiveShift()
            locations.setStatus(
                statusUpdate(
                    entry, entry.lastLocation, TrackingMode.ClockedOut, TrackingStatusUpdate.TaskStatus.Stopped,
                    null, reason = "deleted",
                ),
            )
        }
        tombstone(entry.localId)
        _entries.value = _entries.value.filter { !it.isSameEntry(entry) }
        persist()
        enqueue(TimeEntryAction.Delete, listOf(entry.localId), TimeEntryCommand.deletion(of = entry, capturedAt = current), at = current)
        scope.launch {
            flushCommands()
            syncLocations()
        }
    }

    // MARK: Over-budget reasons

    /**
     * Saves the answer to "What slowed it down?" for a job that went over
     * budget. Queued like every other command, so it survives being offline.
     */
    suspend fun submitOverBudgetReason(jobId: String, reason: String, note: String?, minutesOver: Int) {
        val clientId = "job-obr-${UUID.randomUUID().toString().lowercase()}"
        val command = TimeEntryCommand.jobIssue(clientId, jobId, reason, note, minutesOver)
        enqueue(TimeEntryAction.JobIssue, emptyList(), command, at = now())
        flushCommands()
    }

    // =====================================================================
    // Location (TimeTracker+Location.swift): samples, tracking status, app lifecycle.
    // =====================================================================

    // MARK: Samples

    /** A fix from the foreground location watcher or heartbeat. */
    suspend fun handleForegroundFix(point: LocationPoint) {
        if (_activeShift.value == null || _isClockingOut.value || applyingFix) return
        apply(point, LocationEventType.Location)
    }

    /** Updates the running shift with a fix and uploads it. */
    internal suspend fun apply(point: LocationPoint, event: LocationEventType) {
        val shift = _activeShift.value ?: return
        applyingFix = true
        try {
            val status = LocationStatus(point = point, project = shift.project, projects = projects)
            val updated = located(shift, point, status, now())
            _activeShift.value = updated
            _locationStatus.value = status
            _suggestedProject.value = status.suggestedProject
            if (_notice.value?.kind == TrackingNotice.Kind.Info) _notice.value = null
            val recorded = queueRow(updated, point, event, status)
            persist()

            locations.setStatus(statusUpdate(updated, point, status.mode, TrackingStatusUpdate.TaskStatus.Running, status))
            // Keep the server row's location current too; best effort, never queued.
            if (recorded && isAcknowledged(updated.localId)) {
                val observation = TimeEntryCommand.payload(updated, capturedAt = point.capturedAt)
                try {
                    backend.recordTimeEntryCommand(TimeEntryAction.Observation.rawValue, observation, null)
                } catch (error: Exception) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                }
            }
            syncLocations()
        } finally {
            applyingFix = false
        }
    }

    /** The shift with a fix applied: locations, distance, on-site and segments. */
    internal fun located(shift: TimeEntry, point: LocationPoint, status: LocationStatus, sampledAt: Instant): TimeEntry {
        var next = shift
        val coordinate = shift.project.coordinate ?: projects.firstOrNull { it.id == shift.project.id }?.coordinate
        if (coordinate != null) {
            next = next.copy(project = next.project.copy(latitude = coordinate.latitude, longitude = coordinate.longitude))
        }
        if (next.startedLocation == null) next = next.copy(startedLocation = point)
        next = next.copy(lastLocation = point)
        if (status.reliable) next = next.copy(lastDistanceMeters = status.activeDistance, onSite = status.onSite)
        if (status.mode == TrackingMode.Travel && next.travelStartedAt == null) next = next.copy(travelStartedAt = sampledAt)
        val mode = if (status.reliable) SiteMode(onSite = status.onSite) else SiteMode.Unknown
        return next.copy(
            segments = SegmentBuilder.append(
                next.segments, mode, at = sampledAt, distance = status.activeDistance, location = point, shiftStart = next.startedAt,
            ),
        )
    }

    /** Queues the fix as a location point when it's worth keeping. */
    internal suspend fun queueRow(shift: TimeEntry, point: LocationPoint, event: LocationEventType, status: LocationStatus?): Boolean {
        if (!uploadsLocation) return false
        val mode = status?.mode ?: TrackingMode.Unknown
        if (!LocationSampling.shouldRecord(lastRecordedPoint, point, mode, event)) return false
        lastRecordedPoint = point
        val row = LocationRow(
            entry = shift, point = point, mode = if (event == LocationEventType.ClockOut) TrackingMode.ClockedOut else mode,
            event = event, status = status,
        )
        locations.enqueue(row)
        return true
    }

    // MARK: Tracking status

    internal fun statusUpdate(
        shift: TimeEntry, point: LocationPoint?, mode: TrackingMode, taskStatus: TrackingStatusUpdate.TaskStatus,
        status: LocationStatus?, reason: String? = null, errorCode: String? = null,
    ): TrackingStatusUpdate = TrackingStatusUpdate(
        clientEntryId = shift.localId, jobId = if (TimeEntryCommand.isUUID(shift.project.id)) shift.project.id else null,
        point = point, mode = mode, taskStatus = taskStatus, permissionForeground = location.authorization.isAuthorized,
        appVersion = appVersion, lastErrorCode = errorCode, onSite = status?.onSite ?: shift.onSite,
        distanceMeters = (status?.activeDistance ?: shift.lastDistanceMeters)?.let { it.roundedSwift().toInt() },
        reason = reason, updatedAt = now(),
    )

    /** Publishes the running shift's tracking status to managers. */
    internal suspend fun publishStatus(
        mode: TrackingMode, taskStatus: TrackingStatusUpdate.TaskStatus, reason: String? = null, errorCode: String? = null,
    ) {
        if (!uploadsLocation) return
        val shift = _activeShift.value ?: return
        locations.setStatus(
            statusUpdate(shift, shift.lastLocation, mode, taskStatus, _locationStatus.value, reason = reason, errorCode = errorCode),
        )
        syncLocations()
    }

    // MARK: App lifecycle

    /** The app went to the background: location stops until it's opened again. */
    suspend fun appDidEnterBackground() {
        publishStatus(_locationStatus.value?.mode ?: TrackingMode.Unknown, TrackingStatusUpdate.TaskStatus.Paused, reason = "app_backgrounded")
        flushCommands()
    }

    suspend fun appDidBecomeActive() {
        if (_activeShift.value != null) {
            publishStatus(_locationStatus.value?.mode ?: TrackingMode.Unknown, TrackingStatusUpdate.TaskStatus.Running, reason = "app_opened")
        }
        refresh()
    }

    // =====================================================================
    // Sync (TimeTracker+Sync.swift): sending queued commands and reconciling.
    // =====================================================================

    /** Sends queued commands, then reloads the person's entries from the server. */
    suspend fun refresh() {
        if (refreshing) return
        refreshing = true
        try {
            flushCommands()
            syncLocations()
            // Offline or failing: local data keeps working.
            val rows = try {
                backend.fetchOwnTimeEntries(user.id, null, 1000)
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                null
            }
            if (rows != null) reconcile(rows)
        } finally {
            refreshing = false
        }
    }

    suspend fun flushCommands() {
        val backend = backend
        val outcomes = commands.flush { command ->
            backend.recordTimeEntryCommand(command.action.rawValue, command.command, command.nextCommand)
        }
        outcomes.forEach { handle(it) }
    }

    suspend fun syncLocations() {
        if (!uploadsLocation) return
        val held = commands.unacknowledgedEntryIds
        val backend = backend
        locations.sync(heldBack = held, now = now()) { point, tracking -> backend.recordLocationUpdate(point, tracking) }
    }

    internal fun isAcknowledged(entryId: String): Boolean = entryId !in commands.unacknowledgedEntryIds

    // MARK: Command outcomes

    private fun handle(outcome: CommandOutcome) {
        val command = outcome.command
        outcome.permanentError?.let {
            handleRefusal(command, it)
            return
        }
        val response = outcome.response ?: return
        when (command.action) {
            TimeEntryAction.ClockIn, TimeEntryAction.ClockOut, TimeEntryAction.Adjust ->
                TimeEntryCommand.firstRow(response)?.let { acknowledge(it) }
            TimeEntryAction.SwitchProject -> {
                response["completed_entry"]?.let { acknowledge(it) }
                response["active_entry"]?.let { acknowledge(it) }
            }
            else -> Unit
        }
    }

    private fun handleRefusal(command: QueuedCommand, error: BackendError) {
        val startsShift = command.action == TimeEntryAction.ClockIn || command.action == TimeEntryAction.SwitchProject
        if (startsShift && error.message.contains("already has an active time entry", ignoreCase = true)) {
            // Clocked in somewhere else (another device, or a manager): drop
            // the local shift; the next refresh adopts the real one.
            val local = _activeShift.value
            if (local == null || local.localId !in command.entryIds) return
            dropActiveShift(tombstone = false)
            persist()
            _notice.value = TrackingNotice(TrackingNotice.Kind.Problem, "You were already clocked in on another device. Showing that shift.")
        } else if (command.action != TimeEntryAction.Delete) {
            _notice.value = TrackingNotice(TrackingNotice.Kind.Problem, "A time change couldn't be saved: ${error.message}")
        }
    }

    /** Records the server id and server-owned fields from a returned row. */
    private fun acknowledge(row: JSONValue) {
        val server = TimeEntry.fromServerRow(row, now()) ?: return
        val shift = _activeShift.value
        if (shift != null && shift.localId == server.localId) {
            _activeShift.value = shift.copy(serverId = server.serverId, adjustmentHistory = server.adjustmentHistory)
            persist()
            return
        }
        val list = _entries.value
        val index = list.indexOfFirst { it.isSameEntry(server) }
        if (index >= 0 && TimeEntryRowStatus.isCompleted(row)) {
            _entries.value = list.toMutableList().also {
                it[index] = it[index].copy(serverId = server.serverId, adjustmentHistory = server.adjustmentHistory)
            }
            persist()
        }
    }

    // MARK: Reconciliation

    /** The server's view of the person's entries. */
    private class ServerView {
        val entries = linkedMapOf<String, Pair<TimeEntry, String?>>()
        var active: TimeEntry? = null

        fun status(id: String): String? = entries[id]?.second
    }

    /**
     * Merges the server's view of the person's entries into local state.
     * The server is the source of truth, except for entries with changes
     * still on their way up.
     */
    internal suspend fun reconcile(rows: List<JSONValue>) {
        val pendingIds = commands.pending.flatMap { it.entryIds }.toSet()
        val current = now()
        val server = ServerView()
        for (row in rows) {
            val entry = TimeEntry.fromServerRow(row, current) ?: continue
            if (entry.userId != user.id) continue
            server.entries[entry.localId] = entry to TimeEntryRowStatus.of(row)
            if (TimeEntryRowStatus.isActive(row)) server.active = entry
        }

        val history = mergedHistory(server, pendingIds)
        reconcileActiveShift(server, pendingIds, current)
        _entries.value = history.sortedByDescending { it.startedAt }
        persist()
    }

    private fun mergedHistory(server: ServerView, pendingIds: Set<String>): List<TimeEntry> {
        val local = _entries.value
        val merged = local.filter { it.localId in pendingIds }.toMutableList()
        for ((entry, status) in server.entries.values) {
            if (status != "completed" || entry.localId in pendingIds) continue
            val known = local.firstOrNull { it.isSameEntry(entry) }
            merged.add(
                if (known == null) entry
                // Keep what only the device knows.
                else entry.copy(
                    project = entry.project.copy(latitude = known.project.latitude, longitude = known.project.longitude),
                    clockOutReason = known.clockOutReason,
                ),
            )
        }
        return merged
    }

    private fun reconcileActiveShift(server: ServerView, pendingIds: Set<String>, current: Instant) {
        val active = _activeShift.value
        if (active != null && active.localId !in pendingIds) {
            when (server.status(active.localId)) {
                "completed" -> {
                    // Ended on the server: by a manager or on another device.
                    dropActiveShift()
                    _notice.value = TrackingNotice(TrackingNotice.Kind.Info, "Your shift at ${active.project.name} was clocked out.")
                }
                "deleted" -> dropActiveShift()
                // Acknowledged before, now gone: removed on the server.
                null -> if (active.serverId != null) dropActiveShift()
                else -> Unit
            }
        } else if (active != null && server.status(active.localId) == "deleted") {
            dropActiveShift()
        }

        val serverActive = server.active ?: return
        if (serverActive.localId in pendingIds) return
        val shift = _activeShift.value
        if (shift == null && serverActive.localId !in closedShiftIds) {
            val project = projects.firstOrNull { it.id == serverActive.project.id }
            val adopted = if (project != null) serverActive.copy(project = project) else serverActive
            _activeShift.value = adopted
            reminders.scheduleReminders(adopted, current)
        } else if (shift != null && shift.localId == serverActive.localId) {
            // The start time may have been edited on the web.
            _activeShift.value = shift.copy(
                serverId = serverActive.serverId,
                startedAt = serverActive.startedAt,
                originalStartedAt = serverActive.originalStartedAt,
                startEditedAt = serverActive.startEditedAt,
                adjustmentHistory = serverActive.adjustmentHistory,
            )
        }
    }

    companion object {
        internal const val maxClosedShiftIds = 64

        /** The entry with new times, validated; the first and last segments follow the new start and end. */
        internal fun edited(entry: TimeEntry, startedAt: Instant, endedAt: Instant?, now: Instant): TimeEntry {
            if (startedAt > now) throw TimeTrackingError.InvalidTimes("Clock-in time can't be in the future.")
            var updated = entry.copy(startedAt = startedAt)
            if (startedAt.compareTo(entry.startedAt) != 0) updated = updated.copy(startEditedAt = now)
            if (!entry.isActive) {
                endedAt ?: throw TimeTrackingError.InvalidTimes("Choose a clock-out time.")
                if (endedAt <= startedAt) throw TimeTrackingError.InvalidTimes("Clock-out time must be after clock-in time.")
                if (endedAt > now.addingTimeInterval(60.0)) throw TimeTrackingError.InvalidTimes("Clock-out time can't be in the future.")
                updated = updated.copy(endedAt = endedAt)
            }
            val segments = updated.segments.toMutableList()
            val first = segments.firstOrNull()
            if (first != null && (first.startedAt < startedAt || segments.size == 1)) {
                segments[0] = first.copy(startedAt = startedAt)
            }
            val end = updated.endedAt
            val last = segments.lastOrNull()
            if (end != null && last != null) segments[segments.size - 1] = last.copy(endedAt = end)
            return updated.copy(segments = segments)
        }
    }
}
