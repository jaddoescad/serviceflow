package com.serviceflow.core

import kotlinx.serialization.Serializable
import java.time.Instant

enum class LocationAuthorization {
    NotDetermined, Denied, Restricted, Authorized;

    val isAuthorized: Boolean get() = this == Authorized
}

/**
 * Location access for the time tracker. Authorization is only ever requested
 * from a Clock In tap; everything else just checks it.
 */
interface LocationProviding {
    val authorization: LocationAuthorization

    /** Shows the system location prompt if it has never been answered. */
    suspend fun requestAuthorizationIfNeeded(): LocationAuthorization

    /** One fix, or null when unavailable within [timeoutSeconds]. */
    suspend fun currentPoint(timeoutSeconds: Double): LocationPoint?
}

/** The "Still clocked in?" local notifications. */
interface ShiftReminderScheduling {
    fun scheduleReminders(shift: TimeEntry, now: Instant)
    fun cancelReminders()
}

/** The person using the app. */
@Serializable
data class CrewMember(val id: String, val email: String?, val name: String)

/** A message shown in the clock-in feedback bubble. Never persisted. */
data class TrackingNotice(val kind: Kind, val message: String) {
    enum class Kind { Info, Problem }
}

sealed class TimeTrackingError(override val message: String) : Exception(message) {
    object AlreadyClockedIn : TimeTrackingError("You're already clocked in.")
    object NotClockedIn : TimeTrackingError("You're not clocked in.")
    object Busy : TimeTrackingError("Hang on, your last action is still finishing.")
    class InvalidTimes(message: String) : TimeTrackingError(message)
    class ProjectUnavailable(message: String) : TimeTrackingError(message)
}
