package com.serviceflow.app.platform

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.serviceflow.core.LocationAuthorization
import com.serviceflow.core.LocationPoint
import com.serviceflow.core.LocationProviding
import com.serviceflow.core.TrackingConstants
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import kotlin.coroutines.resume

/**
 * Fused location for the time tracker.
 *
 * - Foreground only ("while using the app"); permission is requested solely
 *   from a Clock In tap ([requestAuthorizationIfNeeded]). Everything else
 *   only checks it.
 * - There is no background location and no foreground service: updates run
 *   while the app is open during a shift and stop when it leaves the screen.
 */
class LocationService(private val context: Context, private val permissions: PermissionBridge) : LocationProviding {
    private val client = LocationServices.getFusedLocationProviderClient(context)
    private val prefs = context.getSharedPreferences("serviceflow.platform", Context.MODE_PRIVATE)
    private var watching = false
    private var lastAuthorization: LocationAuthorization? = null

    /** Continuous foreground fixes while watching. */
    var onFix: ((LocationPoint) -> Unit)? = null
    /** Authorization changed (the prompt was answered, or it changed in Settings). */
    var onAuthorizationChange: ((LocationAuthorization) -> Unit)? = null

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            if (watching) onFix?.invoke(point(location))
        }
    }

    private val isGranted: Boolean
        get() = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION).any {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }

    /**
     * Approximate location counts as authorized. Android has no
     * "not determined" state, so it is tracked: never asked, or declined once
     * while the system would still show its prompt.
     */
    override val authorization: LocationAuthorization
        get() = when {
            isGranted -> LocationAuthorization.Authorized
            !prefs.getBoolean(ASKED_KEY, false) -> LocationAuthorization.NotDetermined
            permissions.shouldShowRationale(Manifest.permission.ACCESS_FINE_LOCATION) -> LocationAuthorization.NotDetermined
            else -> LocationAuthorization.Denied
        }

    override suspend fun requestAuthorizationIfNeeded(): LocationAuthorization {
        if (authorization != LocationAuthorization.NotDetermined) return authorization
        permissions.request(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            ?: return authorization
        prefs.edit { putBoolean(ASKED_KEY, true) }
        val status = authorization
        checkAuthorization()
        return status
    }

    /** Reports a change made outside the app (Settings); called when the app returns to the screen. */
    fun checkAuthorization() {
        val status = authorization
        if (status == lastAuthorization) return
        lastAuthorization = status
        if (!status.isAuthorized) stopWatching()
        onAuthorizationChange?.invoke(status)
    }

    @SuppressLint("MissingPermission")
    override suspend fun currentPoint(timeoutSeconds: Double): LocationPoint? {
        if (!authorization.isAuthorized) return null
        return withTimeoutOrNull((timeoutSeconds * 1000).toLong()) {
            suspendCancellableCoroutine { continuation ->
                val cancellation = CancellationTokenSource()
                continuation.invokeOnCancellation { cancellation.cancel() }
                runCatching {
                    client.getCurrentLocation(PRIORITY, cancellation.token)
                        .addOnSuccessListener { location -> if (continuation.isActive) continuation.resume(location?.let(::point)) }
                        .addOnFailureListener { if (continuation.isActive) continuation.resume(null) }
                        .addOnCanceledListener { if (continuation.isActive) continuation.resume(null) }
                }.onFailure { if (continuation.isActive) continuation.resume(null) }
            }
        }
    }

    /** Starts foreground updates (25 m apart) while a shift is active. */
    @SuppressLint("MissingPermission")
    fun startWatching() {
        if (!authorization.isAuthorized || watching) return
        watching = true
        val request = LocationRequest.Builder(PRIORITY, WATCH_INTERVAL_MS)
            .setMinUpdateDistanceMeters(TrackingConstants.foregroundDistanceFilter.toFloat())
            .build()
        runCatching { client.requestLocationUpdates(request, callback, Looper.getMainLooper()) }
            .onFailure { watching = false }
    }

    fun stopWatching() {
        if (!watching) return
        watching = false
        client.removeLocationUpdates(callback)
    }

    private fun point(location: Location): LocationPoint = LocationPoint(
        latitude = location.latitude,
        longitude = location.longitude,
        accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
        speed = if (location.hasSpeed()) location.speed.toDouble() else null,
        heading = if (location.hasBearing()) location.bearing.toDouble() else null,
        mocked = if (Build.VERSION.SDK_INT >= 31) location.isMock else @Suppress("DEPRECATION") location.isFromMockProvider,
        capturedAt = Instant.ofEpochMilli(location.time),
    )

    private companion object {
        const val ASKED_KEY = "askedLocation"
        const val WATCH_INTERVAL_MS = 30_000L
        // Balanced power never turns on GPS, so a job site without Wi-Fi gets
        // no fix at all. Updates only run in the foreground during a shift.
        const val PRIORITY = Priority.PRIORITY_HIGH_ACCURACY
    }
}
