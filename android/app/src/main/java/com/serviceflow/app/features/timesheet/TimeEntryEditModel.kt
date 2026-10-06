package com.serviceflow.app.features.timesheet

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.serviceflow.core.TimeEntry
import com.serviceflow.core.TimeTracker
import com.serviceflow.core.TimesheetBuilder
import com.serviceflow.core.timeIntervalSince
import kotlinx.coroutines.CancellationException
import java.time.Instant
import kotlin.math.max

/**
 * Editing state for one of your own clock-ins, shared by the Timesheet and
 * Project Detail edit screens: the chosen times, whether they can be saved,
 * and save / delete through the time tracker.
 */
class TimeEntryEditModel(val entry: TimeEntry) {
    private var _startAt by mutableStateOf(entry.startedAt)
    private var _endAt by mutableStateOf(entry.endedAt ?: entry.startedAt)

    var startAt: Instant
        get() = _startAt
        set(value) {
            _startAt = value
            error = null
        }
    var endAt: Instant
        get() = _endAt
        set(value) {
            _endAt = value
            error = null
        }
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** A running shift can only change its start. */
    val isActive: Boolean get() = entry.isActive

    private val startChanged: Boolean get() = startAt.timeIntervalSince(entry.startedAt).toInt() != 0
    private val endChanged: Boolean
        get() = !isActive && endAt.timeIntervalSince(entry.endedAt ?: entry.startedAt).toInt() != 0

    val canSave: Boolean
        get() {
            if (busy) return false
            if (isActive) return startChanged
            return (startChanged || endChanged) && endAt > startAt
        }

    /** Duration as edited, in seconds; a running shift counts up to [now]. */
    fun duration(now: Instant): Double = max(0.0, (if (isActive) now else endAt).timeIntervalSince(startAt))

    /** `Original in 7:00 AM · edited 4:02 PM`, when the times were changed. */
    val originalTimeNote: String?
        get() = TimesheetBuilder.originalTimeNote(entry = entry, startAt = startAt, endAt = if (isActive) null else endAt)

    /** Saves the new times. Returns true on success; otherwise [error] says why. */
    suspend fun save(tracker: TimeTracker): Boolean {
        if (!canSave) return false
        busy = true
        try {
            tracker.updateEntry(entry, startedAt = startAt, endedAt = if (isActive) null else endAt)
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            error = e.message?.takeIf { it.isNotEmpty() } ?: "Could not save changes. Try again."
            return false
        } finally {
            busy = false
        }
    }

    suspend fun delete(tracker: TimeTracker) {
        busy = true
        try {
            tracker.deleteEntry(entry)
        } finally {
            busy = false
        }
    }

    companion object {
        const val IN_PROGRESS_HINT = "This shift is still in progress. Only the start time can be changed."
    }
}
