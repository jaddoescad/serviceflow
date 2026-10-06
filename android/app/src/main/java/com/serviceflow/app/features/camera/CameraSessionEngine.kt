package com.serviceflow.app.features.camera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.media.ExifInterface
import android.util.Size
import android.view.Surface
import android.view.ViewGroup
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.ZoomState
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.graphics.scale
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.Observer
import java.io.File
import java.time.Instant

/**
 * Owns the CameraX use cases: preview, photo and video, bound together so
 * switching modes never reconfigures or restarts the camera. Runs on the main
 * thread; CameraX does its work on its own threads. The camera runs while
 * [start]ed and closes on [stop], through a lifecycle this engine controls.
 */
class CameraSessionEngine(private val context: Context) {
    /** Called on the main thread. */
    var onEvent: ((CameraEvent) -> Unit)? = null

    /** The live image; [CameraPreview] shows it. TextureView-backed so it clips to a rounded card. */
    val previewView: PreviewView = PreviewView(context).apply {
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        scaleType = PreviewView.ScaleType.FILL_CENTER
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private val mainExecutor = ContextCompat.getMainExecutor(context)
    private val lifecycleOwner = EngineLifecycle()
    private val fourByThree = ResolutionSelector.Builder()
        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
        .build()

    private val preview = Preview.Builder().setResolutionSelector(fourByThree).build()
    private val photoOutput = ImageCapture.Builder()
        .setResolutionSelector(
            ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(ResolutionStrategy(PHOTO_SIZE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                .build(),
        )
        .setJpegQuality(85)
        .build()
    private val recorder = Recorder.Builder()
        .setQualitySelector(QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.FHD)))
        .setAspectRatio(AspectRatio.RATIO_4_3)
        .setTargetVideoEncodingBitRate(10_000_000)
        .build()
    private val videoOutput = VideoCapture.withOutput(recorder)

    private var provider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var facing: CameraFacing? = null
    /** Some older phones can't run photo and video together; then only the current mode's output is bound. */
    private var bindsTogether = true
    private var mode = CameraMode.Photo
    private var interrupted = false

    private var recording: Recording? = null
    private var recordingFile: File? = null
    private var recordingStarted: ((Result<Unit>) -> Unit)? = null
    private var recordingStopped: ((Result<File>) -> Unit)? = null
    /** A recording that ended before it was asked to stop. */
    private var recordingResult: Result<File>? = null

    private val streamObserver = Observer<PreviewView.StreamState> { state ->
        if (state == PreviewView.StreamState.STREAMING) emit(CameraEvent.FirstFrame)
    }
    private val zoomObserver = Observer<ZoomState> { state -> emit(CameraEvent.ZoomChanged(state.zoomRatio)) }
    private val stateObserver = Observer<CameraState> { state -> handle(state) }

    init {
        previewView.previewStreamState.observeForever(streamObserver)
    }

    private fun emit(event: CameraEvent) {
        onEvent?.invoke(event)
    }

    /** Stops the camera and lets go of everything; the engine isn't used again. */
    fun release() {
        recording?.close()
        recording = null
        previewView.previewStreamState.removeObserver(streamObserver)
        detachObservers()
        provider?.unbind(preview, photoOutput, videoOutput)
        lifecycleOwner.moveTo(Lifecycle.State.DESTROYED)
    }

    /** The latest frame, for the blurred placeholder while restarting. */
    val latestSnapshot: Bitmap?
        get() {
            val frame = runCatching { previewView.bitmap }.getOrNull() ?: return null
            val width = SNAPSHOT_WIDTH
            if (frame.width <= width) return frame
            return frame.scale(width, maxOf(1, frame.height * width / frame.width))
        }

    // MARK: Devices

    private fun selector(facing: CameraFacing): CameraSelector =
        if (facing == CameraFacing.Back) CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA

    private fun has(provider: ProcessCameraProvider, facing: CameraFacing): Boolean =
        runCatching { provider.hasCamera(selector(facing)) }.getOrDefault(false)

    val canFlip: Boolean
        get() = provider?.let { has(it, CameraFacing.Back) && has(it, CameraFacing.Front) } ?: false

    /** Whether any camera is available; null until the camera service has answered. */
    fun hasAnyCamera(): Boolean? = provider?.let { has(it, CameraFacing.Back) || has(it, CameraFacing.Front) }

    // MARK: Configuration

    /** Selects the lens and binds the outputs. */
    fun configure(facing: CameraFacing) {
        withProvider { provider ->
            val available = if (has(provider, facing)) facing else CameraFacing.entries.firstOrNull { has(provider, it) }
            if (available == null) {
                emit(CameraEvent.ConfigurationFailed("No camera is available on this device."))
                return@withProvider
            }
            if (available == this.facing && camera != null) {
                camera?.let { emit(CameraEvent.Configured(info(it))) }
                return@withProvider
            }
            this.facing = available
            bind(provider)
        }
    }

    private fun withProvider(action: (ProcessCameraProvider) -> Unit) {
        provider?.let { return action(it) }
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val loaded = runCatching { future.get() }.getOrElse { error ->
                emit(CameraEvent.ConfigurationFailed(error.message ?: "The camera service did not respond."))
                return@addListener
            }
            if (lifecycleOwner.lifecycle.currentState == Lifecycle.State.DESTROYED) return@addListener
            provider = loaded
            action(loaded)
        }, mainExecutor)
    }

    private fun bind(provider: ProcessCameraProvider) {
        val facing = facing ?: return
        detachObservers()
        provider.unbind(preview, photoOutput, videoOutput)
        preview.surfaceProvider = previewView.surfaceProvider
        val bound = try {
            bindUseCases(provider, facing)
        } catch (error: Exception) {
            emit(CameraEvent.ConfigurationFailed(error.message ?: "The camera could not be opened."))
            return
        }
        camera = bound
        bound.cameraInfo.zoomState.observeForever(zoomObserver)
        bound.cameraInfo.cameraState.observeForever(stateObserver)
        emit(CameraEvent.Configured(info(bound)))
    }

    private fun bindUseCases(provider: ProcessCameraProvider, facing: CameraFacing): Camera {
        val selector = selector(facing)
        if (bindsTogether) {
            try {
                return provider.bindToLifecycle(lifecycleOwner, selector, preview, photoOutput, videoOutput)
            } catch (_: IllegalArgumentException) {
                bindsTogether = false
                provider.unbind(preview, photoOutput, videoOutput)
            }
        }
        val output: UseCase = if (mode == CameraMode.Video) videoOutput else photoOutput
        return provider.bindToLifecycle(lifecycleOwner, selector, preview, output)
    }

    private fun detachObservers() {
        camera?.cameraInfo?.zoomState?.removeObserver(zoomObserver)
        camera?.cameraInfo?.cameraState?.removeObserver(stateObserver)
        camera = null
    }

    private fun info(camera: Camera): CameraDeviceInfo {
        val zoom = camera.cameraInfo.zoomState.value
        val hasFlash = camera.cameraInfo.hasFlashUnit()
        return CameraDeviceInfo(
            hasFlash = hasFlash,
            hasTorch = hasFlash,
            minZoom = zoom?.minZoomRatio ?: 1f,
            maxZoom = minOf(zoom?.maxZoomRatio ?: 1f, 10f),
            rawPerDisplay = 1f,
            canFlip = canFlip,
        )
    }

    /** The outputs follow the mode only on phones that can't bind them together. */
    fun setMode(newMode: CameraMode) {
        mode = newMode
        if (bindsTogether || recording != null) return
        provider?.let { bind(it) }
    }

    private fun handle(state: CameraState) {
        val error = state.error
        if (error != null) {
            interrupted = true
            emit(CameraEvent.Interrupted(code(error.code)))
        } else if (state.type == CameraState.Type.OPEN && interrupted) {
            interrupted = false
            emit(CameraEvent.InterruptionEnded)
        }
    }

    private fun code(error: Int): String = when (error) {
        CameraState.ERROR_CAMERA_IN_USE, CameraState.ERROR_MAX_CAMERAS_IN_USE -> "video-device-in-use-by-another-client"
        CameraState.ERROR_CAMERA_DISABLED -> "video-device-disabled"
        CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED -> "do-not-disturb-mode-enabled"
        CameraState.ERROR_STREAM_CONFIG -> "stream-configuration-failed"
        else -> "camera-error-$error"
    }

    // MARK: Running

    fun start() {
        lifecycleOwner.moveTo(Lifecycle.State.RESUMED)
        emit(CameraEvent.Running(true))
    }

    fun stop() {
        lifecycleOwner.moveTo(Lifecycle.State.CREATED)
        emit(CameraEvent.Running(false))
    }

    /** Closes and opens the camera again (the preview watchdog's retry). */
    fun restart() {
        lifecycleOwner.moveTo(Lifecycle.State.CREATED)
        provider?.let { bind(it) }
        start()
    }

    // MARK: Controls

    fun setZoom(raw: Float) {
        val camera = camera ?: return
        val zoom = camera.cameraInfo.zoomState.value ?: return
        val clamped = raw.coerceIn(zoom.minZoomRatio, minOf(zoom.maxZoomRatio, 10f))
        camera.cameraControl.setZoomRatio(clamped)
    }

    /** Focus and expose at a point in the preview, in pixels. */
    fun focus(x: Float, y: Float) {
        val camera = camera ?: return
        val point = previewView.meteringPointFactory.createPoint(x, y)
        val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE).build()
        camera.cameraControl.startFocusAndMetering(action)
    }

    fun setTorch(on: Boolean) {
        val camera = camera ?: return
        if (!camera.cameraInfo.hasFlashUnit()) return
        val current = camera.cameraInfo.torchState.value == androidx.camera.core.TorchState.ON
        if (current != on) camera.cameraControl.enableTorch(on)
    }

    // MARK: Photo

    /** Writes a JPEG; completion runs on the main thread. */
    fun capturePhoto(flash: Boolean, rotation: Int, completion: (Result<CameraPhotoResult>) -> Unit) {
        photoOutput.flashMode = if (flash) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF
        photoOutput.targetRotation = rotation
        val file = CameraFiles.temporaryFile(context, "jpg")
        val options = ImageCapture.OutputFileOptions.Builder(file).build()
        photoOutput.takePicture(options, mainExecutor, object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                val size = pixelSize(file)
                completion(Result.success(CameraPhotoResult(file, size?.width, size?.height, Instant.now())))
            }

            override fun onError(exception: ImageCaptureException) {
                file.delete()
                completion(Result.failure(CameraFailure.photo(exception.message)))
            }
        })
    }

    /** Pixel size with the EXIF orientation applied. */
    private fun pixelSize(file: File): Size? = runCatching {
        val exif = ExifInterface(file.absolutePath)
        val width = exif.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0)
        val height = exif.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0)
        if (width <= 0 || height <= 0) return@runCatching null
        val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        if (orientation in 5..8) Size(height, width) else Size(width, height)
    }.getOrNull()

    // MARK: Video

    /** Starts writing an MP4. [started] runs on the main thread once frames are being written. */
    @SuppressLint("MissingPermission")
    fun startRecording(rotation: Int, withAudio: Boolean, started: (Result<Unit>) -> Unit) {
        if (recording != null) return started(Result.failure(CameraFailure.video("A recording is already running.")))
        videoOutput.targetRotation = rotation
        val file = CameraFiles.temporaryFile(context, "mp4")
        recordingFile = file
        recordingStarted = started
        recordingStopped = null
        recordingResult = null
        var pending = recorder.prepareRecording(context, FileOutputOptions.Builder(file).build())
        // Records without sound when the microphone isn't allowed.
        if (withAudio && CameraPermission.microphoneGranted(context)) pending = pending.withAudioEnabled()
        recording = try {
            pending.start(mainExecutor, ::handle)
        } catch (error: Exception) {
            file.delete()
            recordingStarted = null
            started(Result.failure(CameraFailure.video(error.message)))
            null
        }
    }

    private fun handle(event: VideoRecordEvent) {
        when (event) {
            is VideoRecordEvent.Start -> {
                recordingStarted?.invoke(Result.success(Unit))
                recordingStarted = null
            }
            is VideoRecordEvent.Finalize -> {
                recording = null
                val file = recordingFile
                recordingFile = null
                val result = if (file != null && event.error in keptErrors && file.length() > 0) {
                    Result.success(file)
                } else {
                    file?.delete()
                    Result.failure(CameraFailure.video(event.cause?.message ?: "No video frames were recorded."))
                }
                recordingStarted?.let { started ->
                    recordingStarted = null
                    started(result.map { })
                    if (result.isFailure) return
                }
                val stopped = recordingStopped
                recordingStopped = null
                if (stopped != null) {
                    stopped(result)
                } else {
                    recordingResult = result
                    emit(CameraEvent.RecordingStopped)
                }
                if (!bindsTogether && mode == CameraMode.Photo) provider?.let { bind(it) }
            }
            else -> Unit
        }
    }

    /** Finishes the file. Completion runs on the main thread. */
    fun stopRecording(completion: (Result<File>) -> Unit) {
        recordingResult?.let { result ->
            recordingResult = null
            return completion(result)
        }
        val recording = recording ?: return completion(Result.failure(CameraFailure.video("Recording was not running.")))
        recordingStopped = completion
        recording.stop()
    }

    private class EngineLifecycle : LifecycleOwner {
        private val registry = LifecycleRegistry(this).apply { currentState = Lifecycle.State.CREATED }
        override val lifecycle: Lifecycle get() = registry

        fun moveTo(state: Lifecycle.State) {
            if (registry.currentState != Lifecycle.State.DESTROYED) registry.currentState = state
        }
    }

    companion object {
        /** About 12 MP: full detail for job-site photos, and well under the 25 MB upload limit. */
        private val PHOTO_SIZE = Size(4096, 3072)
        private const val SNAPSHOT_WIDTH = 480
        /** Finalize errors after which the file is still a complete video. */
        private val keptErrors = setOf(
            VideoRecordEvent.Finalize.ERROR_NONE,
            VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE,
            VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED,
            VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED,
            VideoRecordEvent.Finalize.ERROR_INSUFFICIENT_STORAGE,
        )

        /** Capture rotation for a device orientation in degrees, as `Surface.ROTATION_*`. */
        fun rotation(degrees: Int): Int = when (degrees) {
            in 45 until 135 -> Surface.ROTATION_270
            in 135 until 225 -> Surface.ROTATION_180
            in 225 until 315 -> Surface.ROTATION_90
            else -> Surface.ROTATION_0
        }
    }
}
