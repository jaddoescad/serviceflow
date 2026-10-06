package com.serviceflow.app.features.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import java.io.File
import java.time.Instant
import java.util.UUID

enum class CameraFacing { Back, Front }
enum class CameraMode { Photo, Video }

/** What the active camera can do. */
data class CameraDeviceInfo(
    val hasFlash: Boolean,
    val hasTorch: Boolean,
    val minZoom: Float,
    val maxZoom: Float,
    /** Zoom ratio of the 1× (wide) lens. CameraX reports ratios relative to it, so this is 1. */
    val rawPerDisplay: Float,
    val canFlip: Boolean,
)

/** Things the camera reports, always delivered on the main thread. */
sealed interface CameraEvent {
    data class Configured(val info: CameraDeviceInfo) : CameraEvent
    data class ConfigurationFailed(val message: String) : CameraEvent
    data class Running(val running: Boolean) : CameraEvent
    data object FirstFrame : CameraEvent
    data class ZoomChanged(val raw: Float) : CameraEvent
    /** A camera interruption, with the reason as a stable code. */
    data class Interrupted(val reason: String?) : CameraEvent
    data object InterruptionEnded : CameraEvent
    data class RuntimeError(val message: String) : CameraEvent
    /** A recording ended without being stopped (an error, or the camera closed). */
    data object RecordingStopped : CameraEvent
}

class CameraFailure(override val message: String, val details: String? = null) : Exception(message) {
    companion object {
        fun photo(details: String?) = CameraFailure("The photo could not be captured.", details)
        fun video(details: String?) = CameraFailure("The video could not be recorded.", details)
    }
}

class CameraPhotoResult(val file: File, val width: Int?, val height: Int?, val capturedAt: Instant)

/** A message in the camera's red notice banner. */
class CameraNotice(val message: String, val details: String? = null) {
    val id: String = UUID.randomUUID().toString()

    companion object {
        const val PHONE_CALL_USES_MICROPHONE = "Your phone call is using the microphone. Photo mode is still available."
        const val CAMERA_IN_USE = "Your phone is using the camera in another app or call."

        /** Friendly text for a native camera error; null when it should be ignored. */
        fun forNativeError(message: String): CameraNotice? {
            fun matches(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(message)
            if (matches("cancel")) return null
            if (matches("audio-device-in-use-by-another-client|audio.*(busy|in use|another client)")) {
                return CameraNotice(PHONE_CALL_USES_MICROPHONE, message)
            }
            if (matches("video-device-in-use-by-another-client|camera.*(busy|in use|another client)")) {
                return CameraNotice(CAMERA_IN_USE, message)
            }
            return CameraNotice("The camera could not start.", message)
        }
    }
}

/** Lens and flash choices last the whole app run, not just one opening. */
object CameraPreferences {
    var facing = CameraFacing.Back
    var flashOn = false
    var askedMicrophone = false
}

enum class CameraPermission {
    NotDetermined, Granted, Denied;

    companion object {
        fun granted(context: Context, permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

        fun microphoneGranted(context: Context): Boolean = granted(context, Manifest.permission.RECORD_AUDIO)
    }
}

object CameraFiles {
    /** A unique file in the cache directory, e.g. `project-1727…-a1b2c3.jpg`. */
    fun temporaryFile(context: Context, extension: String): File =
        File(context.cacheDir, "project-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(6)}.$extension")
}
