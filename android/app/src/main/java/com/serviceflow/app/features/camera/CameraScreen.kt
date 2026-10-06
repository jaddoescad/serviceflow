package com.serviceflow.app.features.camera

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.serviceflow.app.LocalAppModel
import com.serviceflow.app.LocalSession
import com.serviceflow.app.design.hex
import com.serviceflow.app.features.media.MediaPhotoEditFlow
import com.serviceflow.app.features.media.rememberMediaStore
import com.serviceflow.core.CapturedMedia
import com.serviceflow.core.MediaItem
import com.serviceflow.core.MediaKind
import com.serviceflow.core.Project
import com.serviceflow.core.ProjectKind
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.roundToInt

private val cameraSpring = spring<Dp>(dampingRatio = 0.88f, stiffness = 450f)

/**
 * Full-screen project camera, laid out like CompanyCam's: the preview as a
 * rounded card, flip/flash/zoom down the right edge, the shutter with Done, a
 * Photo/Video switch, and a drawer of this opening's captures where each
 * gets a note and markup. Captures are held until Done (or close), then
 * upload with their notes and drawings.
 */
@Composable
fun CameraScreen(
    projectName: String,
    projectId: String,
    projectKind: ProjectKind,
    onClose: () -> Unit,
    onCapture: (() -> Unit)? = null,
) {
    val session = LocalSession.current
    val context = LocalContext.current
    val permissions = LocalAppModel.current.permissions
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    val camera = remember { CameraModel(context, permissions) }
    val dictation = remember { CameraDictation(context, permissions, scope) }
    /** Local ids of this opening's captures, newest first. */
    val captureIds = remember { mutableStateListOf<String>() }
    var editing by remember { mutableStateOf<String?>(null) }
    var editingUploaded by remember { mutableStateOf<MediaItem?>(null) }
    var viewing by remember { mutableStateOf<CameraViewerItem?>(null) }
    var closing by remember { mutableStateOf(false) }
    val shutterFlash = remember { Animatable(0f) }
    val isEditing = editing != null || editingUploaded != null

    // The job's photos already on the server, shown under this opening's shots.
    val project = remember(projectId, projectKind) { Project(id = projectId, name = projectName, isLead = projectKind == ProjectKind.Lead) }
    val jobMedia = rememberMediaStore(project, includeLinkedLead = true)
    LaunchedEffect(jobMedia) { jobMedia.load() }

    val uploadItems by (session.uploads?.items ?: remember { MutableStateFlow(emptyList()) }).collectAsState()
    // This opening's captures, newest first.
    val captures = captureIds.mapNotNull { id -> uploadItems.firstOrNull { it.localId == id } }
    val drawerEntries = CameraDrawerEntry.list(captures, jobMedia.items)

    /** Hands a capture to the upload queue, held until Done so notes and markup go up with it. */
    fun enqueue(capture: CapturedMedia, files: List<File>) {
        val uploads = session.uploads
        if (uploads == null) {
            files.forEach { it.delete() }
            camera.show("Project media is not configured.")
            return
        }
        val item = uploads.enqueue(capture, projectId = projectId, projectKind = projectKind, held = true)
        if (item == null) {
            files.forEach { it.delete() }
            val failure = if (capture.kind == MediaKind.Video) CameraFailure.video(null) else CameraFailure.photo(null)
            camera.show(failure.message, "The capture could not be saved for upload.")
            return
        }
        captureIds.add(0, item.localId)
        onCapture?.invoke()
    }

    val currentEnqueue by rememberUpdatedState(::enqueue)
    /** Videos still getting their poster before they're queued. */
    val videoJobs = remember { mutableListOf<Job>() }
    DisposableEffect(camera) {
        camera.onPhoto = { photo ->
            val capture = CapturedMedia(fileURL = photo.file, kind = MediaKind.Image, mimeType = "image/jpeg",
                                        width = photo.width, height = photo.height, capturedAt = photo.capturedAt)
            currentEnqueue(capture, listOf(photo.file))
        }
        camera.onVideo = { file, durationMs, startedAt ->
            // In the session's scope so leaving the camera never drops the video.
            videoJobs += session.scope.launch {
                val poster = CameraPoster.make(file)
                val capture = CapturedMedia(fileURL = file, posterURL = poster, kind = MediaKind.Video, mimeType = "video/mp4",
                                            durationMs = durationMs, capturedAt = startedAt)
                currentEnqueue(capture, listOfNotNull(file, poster))
            }
        }
        onDispose {
            dictation.stop()
            camera.dispose()
        }
    }

    // Runs while the app is in the foreground and the editor isn't up.
    val editingNow by rememberUpdatedState(isEditing)
    DisposableEffect(lifecycle, camera) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> if (!editingNow) camera.activate()
                Lifecycle.Event.ON_STOP -> camera.deactivate()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val wasEditing = remember { booleanArrayOf(false) }
    LaunchedEffect(isEditing) {
        // The editor has the screen; the camera rests until it closes.
        if (isEditing) {
            camera.deactivate()
        } else if (wasEditing[0] && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            camera.activate()
        }
        wasEditing[0] = isEditing
    }

    LightSystemBarIcons()

    /** Done and close both keep the captures: they start uploading now. */
    fun close() {
        if (closing) return
        closing = true
        dictation.stop()
        focusManager.clearFocus()
        keyboard?.hide()
        scope.launch {
            // A recording in progress is finished and kept, not thrown away.
            camera.finishPendingCapture()
            videoJobs.joinAll()
            session.uploads?.release(projectId)
            camera.deactivate()
            onClose()
        }
    }

    fun shutter() {
        if (camera.mode == CameraMode.Photo && camera.canShoot) {
            scope.launch {
                shutterFlash.animateTo(0.55f, tween(50))
                delay(10)
                shutterFlash.animateTo(0f, tween(250))
            }
        }
        camera.shutter()
    }

    BackHandler(onBack = ::close)

    val density = LocalDensity.current
    val insetTop = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
    val insetBottom = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val layout = CameraLayout(maxWidth, maxHeight, insetTop, insetBottom, camera.mode)
        val width = maxWidth

        when {
            camera.permission == CameraPermission.Granted && camera.hasDevice -> {
                val previewHeight by animateDpAsState(layout.previewHeight, cameraSpring, label = "preview")
                Box(
                    Modifier
                        .offset(y = layout.previewTop)
                        .size(width, previewHeight)
                        .clip(RoundedCornerShape(CameraLayout.PREVIEW_CORNER_RADIUS)),
                ) {
                    // Swiping sideways on the preview switches Photo and Video.
                    CameraPreview(camera, onSwipe = { dx -> camera.select(if (dx < 0) CameraMode.Video else CameraMode.Photo) })
                    AnimatedVisibility(!camera.previewReady, enter = fadeIn(tween(350)), exit = fadeOut(tween(350))) {
                        CameraPreviewPlaceholder(camera)
                    }
                    Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = shutterFlash.value)))
                }
            }
            camera.permission == CameraPermission.Granted -> CameraUnavailableView()
            else -> CameraPermissionCard(
                permission = camera.permission,
                onAllow = camera::requestPermission,
                modifier = Modifier
                    .offset(y = layout.previewTop)
                    .size(width, layout.previewHeight)
                    .background(hex(0x16191a), RoundedCornerShape(CameraLayout.PREVIEW_CORNER_RADIUS)),
            )
        }

        CameraCloseButton(disabled = closing, action = ::close, modifier = Modifier.centeredAt(33.dp, layout.topControlsY))

        if (camera.permission == CameraPermission.Granted) {
            val zoomY by animateDpAsState(layout.zoomCenterY, cameraSpring, label = "zoom")
            CameraSideControls(camera, Modifier.centeredAt(width - 36.dp, layout.topControlsY + 26.dp))
            CameraZoomRail(camera, Modifier.centeredAt(width - 36.dp, zoomY))
            if (camera.isRecording || camera.isFinalizing) {
                CameraRecordingPill(camera, Modifier.centeredAt(width / 2, layout.previewTop + 30.dp))
            }
            camera.notice?.let { notice ->
                CameraNoticeBanner(notice, camera::dismissNotice, Modifier.centeredAt(width / 2, layout.previewTop + 80.dp))
            }
            CameraShutterRow(camera, closing, onShutter = ::shutter, onDone = ::close,
                             modifier = Modifier.centeredAt(width / 2, layout.shutterCenterY))
            CameraModeSwitcher(camera, Modifier.centeredAt(width / 2, layout.modeCenterY))
        }

        // Its own layer so it rises with the keyboard while a note is typed.
        if (camera.permission == CameraPermission.Granted && viewing == null) {
            Box(Modifier.fillMaxSize().imePadding()) {
                CameraCaptureSheet(
                    entries = drawerEntries,
                    isLoading = !jobMedia.hasLoaded,
                    collapsedHeight = layout.drawerCollapsed,
                    expandedHeight = layout.drawerExpanded,
                    bottomInset = insetBottom,
                    dictation = dictation,
                    canEdit = { entry ->
                        when (entry) {
                            is CameraDrawerEntry.Capture -> true
                            is CameraDrawerEntry.Uploaded -> jobMedia.canEdit(entry.item)
                        }
                    },
                    onEdit = { entry ->
                        if (entry.kind == MediaKind.Image) {
                            when (entry) {
                                is CameraDrawerEntry.Capture -> editing = entry.upload.localId
                                is CameraDrawerEntry.Uploaded -> editingUploaded = entry.item
                            }
                        }
                    },
                    onView = { entry ->
                        if (entry is CameraDrawerEntry.Capture) {
                            viewing = CameraViewerItem(entry.upload, session.uploads?.fileURL(entry.upload))
                        }
                    },
                    // A shot's note travels with its upload; an earlier photo's description
                    // is saved the same way the photo viewer and the web admin save it.
                    onNote = { entry, text ->
                        when (entry) {
                            is CameraDrawerEntry.Capture -> session.uploads?.setNote(entry.upload.localId, text)
                            is CameraDrawerEntry.Uploaded -> scope.launch {
                                jobMedia.saveEdits(entry.item, description = text, annotations = null)
                            }
                        }
                    },
                    onDictationBegin = camera::beginDictation,
                    onDictationEnd = camera::endDictation,
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
        }

        // Keeps showing the last item while it fades out.
        val lastViewed = remember { arrayOfNulls<CameraViewerItem>(1) }
        viewing?.let { lastViewed[0] = it }
        AnimatedVisibility(viewing != null, Modifier.zIndex(5f), enter = fadeIn(tween(150)), exit = fadeOut(tween(150))) {
            lastViewed[0]?.let { item ->
                CameraCaptureViewer(item, safeTop = insetTop, safeBottom = insetBottom,
                                    onRetry = { session.uploads?.retry(it) }, onClose = { viewing = null })
            }
        }

        editing?.let { localId ->
            EditorCover(onBack = { editing = null }) { CameraPhotoEditorHost(localId) { editing = null } }
        }
        editingUploaded?.let { item ->
            EditorCover(onBack = { editingUploaded = null }) { MediaPhotoEditFlow(item, jobMedia) { editingUploaded = null } }
        }
    }
}

/** Places the element with its center at ([x], [y]) of the full-screen container, like SwiftUI's `position`. */
private fun Modifier.centeredAt(x: Dp, y: Dp): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
    layout(constraints.maxWidth, constraints.maxHeight) {
        placeable.place((x.toPx() - placeable.width / 2f).roundToInt(), (y.toPx() - placeable.height / 2f).roundToInt())
    }
}

/** Covers the camera for the photo editor; back closes it unless the editor handles back itself. */
@Composable
private fun EditorCover(onBack: () -> Unit, content: @Composable () -> Unit) {
    BackHandler(onBack = onBack)
    Box(
        Modifier
            .fillMaxSize()
            .zIndex(10f)
            .background(Color.Black)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
    ) { content() }
}

/** White status and navigation bar icons over the black camera, restored on leaving. */
@Composable
private fun LightSystemBarIcons() {
    val activity = LocalActivity.current ?: return
    DisposableEffect(activity) {
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        val status = controller.isAppearanceLightStatusBars
        val navigation = controller.isAppearanceLightNavigationBars
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
        onDispose {
            controller.isAppearanceLightStatusBars = status
            controller.isAppearanceLightNavigationBars = navigation
        }
    }
}
