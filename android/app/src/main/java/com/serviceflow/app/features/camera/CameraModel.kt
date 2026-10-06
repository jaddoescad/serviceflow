package com.serviceflow.app.features.camera

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.view.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.serviceflow.app.platform.PermissionBridge
import com.serviceflow.core.MediaRules
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.time.Instant

/** State and actions of the camera screen, on top of [CameraSessionEngine]. Main thread only. */
class CameraModel(private val context: Context, private val permissions: PermissionBridge) {
    var permission by mutableStateOf(currentCameraPermission())
        private set
    var mode by mutableStateOf(CameraMode.Photo)
        private set
    var facing by mutableStateOf(CameraPreferences.facing)
        private set
    var flashOn by mutableStateOf(CameraPreferences.flashOn)
        private set
    var zoom by mutableStateOf(CameraZoom())
        private set
    var hasDevice by mutableStateOf(true)
        private set
    var isRunning by mutableStateOf(false)
        private set
    /** The first live frame has arrived since the last (re)start. */
    var previewReady by mutableStateOf(false)
        private set
    var previewFailed by mutableStateOf(false)
        private set
    /** The last frame, shown blurred while the camera restarts. */
    var frozenFrame by mutableStateOf<Bitmap?>(null)
        private set
    var isRecording by mutableStateOf(false)
        private set
    /** A stopped recording is still being written. */
    var isFinalizing by mutableStateOf(false)
        private set
    var recordingStartedAt by mutableStateOf<Instant?>(null)
        private set
    var isCapturingPhoto by mutableStateOf(false)
        private set
    var notice by mutableStateOf<CameraNotice?>(null)
        private set

    /** A photo was taken. */
    var onPhoto: ((CameraPhotoResult) -> Unit)? = null
    /** A video finished: its file, wall-clock duration (ms) and start time. */
    var onVideo: ((File, Int, Instant) -> Unit)? = null
    /** Capture rotation (`Surface.ROTATION_*`) for the current device orientation. */
    var captureRotation: () -> Int = { Surface.ROTATION_0 }

    val engine = CameraSessionEngine(context)
    private val scope = MainScope()
    private var active = false
    private var askedPermission = false
    private var watchdog: Job? = null
    private var restartedOnce = false
    private var noticeTimer: Job? = null
    private var recordingLimit: Job? = null
    private var recordingStarting = false
    private var stopRequested = false
    private val finishWaiters = mutableListOf<CompletableDeferred<Unit>>()
    private var pinchStartZoom = 1f
    private var audioAttached = false
    private var dictating = false

    init {
        engine.onEvent = ::handle
    }

    fun dispose() {
        deactivate()
        engine.release()
        scope.cancel()
    }

    // MARK: Lifecycle

    /** The camera is visible and the app is in the foreground. */
    fun activate() {
        active = true
        permission = currentCameraPermission(previous = permission)
        when (permission) {
            CameraPermission.Granted -> startSession()
            CameraPermission.NotDetermined -> {
                // Ask once per opening; the system prompt comes first.
                if (askedPermission) return
                askedPermission = true
                scope.launch {
                    val granted = permissions.request(arrayOf(Manifest.permission.CAMERA))?.get(Manifest.permission.CAMERA)
                    permission = when {
                        granted == true -> CameraPermission.Granted
                        // The system would still ask again: offer Continue, not Settings.
                        permissions.shouldShowRationale(Manifest.permission.CAMERA) || granted == null -> CameraPermission.NotDetermined
                        else -> CameraPermission.Denied
                    }
                    if (permission == CameraPermission.Granted && active) startSession()
                }
            }
            CameraPermission.Denied -> Unit
        }
    }

    /** Hidden or backgrounded: the camera stops. */
    fun deactivate() {
        active = false
        watchdog?.cancel()
        if (isRecording) stopRecording()
        freezeLastFrame()
        engine.setTorch(false)
        engine.stop()
        previewReady = false
        isRunning = false
    }

    fun requestPermission() {
        askedPermission = false
        permission = CameraPermission.NotDetermined
        activate()
    }

    fun retryPreview() {
        restartedOnce = false
        previewFailed = false
        notice = null
        previewReady = false
        engine.restart()
    }

    /** Granted now, or the answer from earlier in this opening (Android can't tell never-asked from declined). */
    private fun currentCameraPermission(previous: CameraPermission? = null): CameraPermission = when {
        CameraPermission.granted(context, Manifest.permission.CAMERA) -> CameraPermission.Granted
        previous == CameraPermission.Denied -> CameraPermission.Denied
        else -> CameraPermission.NotDetermined
    }

    private fun startSession() {
        engine.configure(facing)
        if (mode == CameraMode.Video && CameraPermission.microphoneGranted(context) && !dictating) attachAudio()
        engine.start()
    }

    private fun freezeLastFrame() {
        frozenFrame = engine.latestSnapshot ?: frozenFrame
    }

    // MARK: Events

    private fun handle(event: CameraEvent) {
        when (event) {
            is CameraEvent.Configured -> {
                hasDevice = true
                zoom = zoom.copy(info = event.info)
                updateTorch()
            }
            is CameraEvent.ConfigurationFailed -> {
                if (engine.hasAnyCamera() == false) hasDevice = false
                show("The camera could not start.", event.message)
            }
            is CameraEvent.Running -> {
                isRunning = event.running
                if (event.running) {
                    startWatchdog()
                } else {
                    previewReady = false
                    watchdog?.cancel()
                }
            }
            CameraEvent.FirstFrame -> {
                if (!active) return
                previewReady = true
                previewFailed = false
                watchdog?.cancel()
                notice = null
                // The torch can only be switched on once the camera is open.
                updateTorch()
            }
            is CameraEvent.ZoomChanged -> zoom = zoom.copy(raw = event.raw)
            is CameraEvent.Interrupted -> handleInterruption(event.reason)
            CameraEvent.InterruptionEnded -> notice = null
            is CameraEvent.RuntimeError -> CameraNotice.forNativeError(event.message)?.let(::show)
            CameraEvent.RecordingStopped -> stopRecording()
        }
    }

    /** If no frame arrives within 3 s, restart once, then give up with a Retry button. */
    private fun startWatchdog() {
        watchdog?.cancel()
        if (previewReady) return
        watchdog = scope.launch {
            delay(3_000)
            if (previewReady || !active) return@launch
            if (restartedOnce) {
                previewFailed = true
                show("The camera preview did not start.")
            } else {
                restartedOnce = true
                show("Restarting camera preview…")
                engine.restart()
            }
        }
    }

    private fun handleInterruption(reason: String?) {
        val details = "Camera interruption: ${reason ?: ""}"
        when (reason) {
            "video-device-in-use-by-another-client" -> show(CameraNotice.CAMERA_IN_USE, details)
            else -> show("The camera was temporarily interrupted by your phone.", if (reason == null) null else details)
        }
    }

    // MARK: Notices

    fun show(message: String, details: String? = null) {
        val detail = details?.trim()
        show(CameraNotice(message, if (detail == message || detail.isNullOrEmpty()) null else detail))
    }

    private fun show(newNotice: CameraNotice) {
        notice = newNotice
        noticeTimer?.cancel()
        // Clears itself after 6 s once the preview is running.
        noticeTimer = scope.launch {
            delay(6_000)
            if (previewReady) notice = null
        }
    }

    fun dismissNotice() {
        notice = null
    }

    // MARK: Controls

    val canUseFlash: Boolean
        get() {
            val info = zoom.info ?: return false
            return if (mode == CameraMode.Video) info.hasTorch else info.hasFlash
        }

    val canFlip: Boolean get() = zoom.info?.canFlip ?: engine.canFlip

    val canShoot: Boolean
        get() = permission == CameraPermission.Granted && isRunning && previewReady && !isFinalizing && !isCapturingPhoto

    fun toggleFlash() {
        if (isRecording || !canUseFlash) return
        flashOn = !flashOn
        CameraPreferences.flashOn = flashOn
        updateTorch()
    }

    fun flip() {
        if (isRecording || !canFlip) return
        facing = if (facing == CameraFacing.Back) CameraFacing.Front else CameraFacing.Back
        CameraPreferences.facing = facing
        freezeLastFrame()
        previewReady = false
        restartedOnce = false
        previewFailed = false
        engine.configure(facing)
        startWatchdog()
    }

    /**
     * Switches between photo and video instantly: the running camera is left
     * alone; the microphone is asked for the first time video is chosen.
     */
    fun select(newMode: CameraMode) {
        if (newMode == mode || isRecording || isFinalizing) return
        mode = newMode
        notice = null
        engine.setMode(newMode)
        updateTorch()
        if (newMode != CameraMode.Video || dictating) return
        if (CameraPermission.microphoneGranted(context)) {
            attachAudio()
        } else {
            scope.launch {
                if (ensureMicrophone() && mode == CameraMode.Video && !dictating) attachAudio()
            }
        }
    }

    /** CameraX adds sound per recording; this records whether the next one has it. */
    private fun attachAudio() {
        audioAttached = true
    }

    /** Dictating a note needs the microphone, so the camera lets go of it. */
    fun beginDictation() {
        dictating = true
        audioAttached = false
    }

    fun endDictation() {
        dictating = false
        if (mode == CameraMode.Video && CameraPermission.microphoneGranted(context)) attachAudio()
    }

    /** Asks for the microphone once per app run; a declined camera still records without sound. */
    private suspend fun ensureMicrophone(): Boolean {
        if (CameraPermission.microphoneGranted(context)) return true
        if (CameraPreferences.askedMicrophone) return false
        CameraPreferences.askedMicrophone = true
        return permissions.request(arrayOf(Manifest.permission.RECORD_AUDIO))?.get(Manifest.permission.RECORD_AUDIO) == true
    }

    /** In video mode the flash button is a torch that stays on. */
    private fun updateTorch() {
        engine.setTorch(mode == CameraMode.Video && flashOn && (zoom.info?.hasTorch ?: false) && active)
    }

    // MARK: Zoom and focus

    fun zoom(step: Float) = engine.setZoom(zoom.raw(step))

    fun pinchBegan() {
        pinchStartZoom = zoom.raw
    }

    fun pinchChanged(scale: Float) = engine.setZoom(pinchStartZoom * scale)

    fun focus(x: Float, y: Float) = engine.focus(x, y)

    // MARK: Capture

    fun shutter() {
        when (mode) {
            CameraMode.Photo -> takePhoto()
            CameraMode.Video -> if (isRecording) stopRecording() else startRecording()
        }
    }

    private fun takePhoto() {
        if (!canShoot || isRecording) return
        notice = null
        isCapturingPhoto = true
        val flash = flashOn && (zoom.info?.hasFlash ?: false)
        engine.capturePhoto(flash, captureRotation()) { result ->
            isCapturingPhoto = false
            result.onSuccess { onPhoto?.invoke(it) }
                .onFailure { show(it.message ?: "The photo could not be captured.", (it as? CameraFailure)?.details) }
        }
    }

    private fun startRecording() {
        if (!canShoot || isRecording || recordingStarting) return
        scope.launch {
            // Records without sound when the microphone isn't allowed.
            if (!CameraPermission.microphoneGranted(context) && ensureMicrophone() && !dictating) attachAudio()
            if (!canShoot || isRecording) return@launch
            notice = null
            // The UI flips immediately so a second tap is a stop.
            isRecording = true
            recordingStarting = true
            stopRequested = false
            val startedAt = Instant.now()
            recordingStartedAt = startedAt
            scheduleRecordingLimit()
            engine.startRecording(captureRotation(), withAudio = audioAttached) { result ->
                recordingDidStart(result, startedAt)
            }
        }
    }

    private fun recordingDidStart(result: Result<Unit>, startedAt: Instant) {
        recordingStarting = false
        result.onSuccess {
            // Stop was tapped while the recorder was still starting.
            if (stopRequested) {
                stopRequested = false
                finishRecording(startedAt)
            }
        }.onFailure { failure ->
            isRecording = false
            isFinalizing = false
            recordingStartedAt = null
            recordingLimit?.cancel()
            resumeFinishWaiters()
            show(failure.message ?: "The video could not be recorded.", (failure as? CameraFailure)?.details)
        }
    }

    private fun scheduleRecordingLimit() {
        recordingLimit?.cancel()
        recordingLimit = scope.launch {
            delay(MAX_VIDEO_SECONDS * 1000L)
            stopRecording()
        }
    }

    fun stopRecording() {
        val startedAt = recordingStartedAt
        if (!isRecording || startedAt == null) return
        isRecording = false
        isFinalizing = true
        recordingLimit?.cancel()
        if (recordingStarting) {
            stopRequested = true
        } else {
            finishRecording(startedAt)
        }
    }

    private fun finishRecording(startedAt: Instant) {
        engine.stopRecording { result ->
            val durationMs = (Instant.now().toEpochMilli() - startedAt.toEpochMilli()).toInt()
            isFinalizing = false
            recordingStartedAt = null
            result.onSuccess { onVideo?.invoke(it, durationMs, startedAt) }
                .onFailure { show(it.message ?: "The video could not be recorded.", (it as? CameraFailure)?.details) }
            resumeFinishWaiters()
        }
    }

    /** Stops a recording in progress and waits until its file is saved, so closing the camera never loses a video. */
    suspend fun finishPendingCapture() {
        if (isRecording) stopRecording()
        if (!isFinalizing && !isRecording) return
        val waiter = CompletableDeferred<Unit>()
        finishWaiters += waiter
        waiter.await()
    }

    private fun resumeFinishWaiters() {
        val waiters = finishWaiters.toList()
        finishWaiters.clear()
        waiters.forEach { it.complete(Unit) }
    }

    companion object {
        val MAX_VIDEO_SECONDS = MediaRules.maxVideoSeconds
    }
}
