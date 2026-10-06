package com.serviceflow.app.features.media

import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * A full-screen, edge-to-edge window over everything (the lightbox and photo
 * editor), with light system-bar icons and nothing dimmed behind it, so
 * swiping a viewer away reveals the screen underneath. Back calls
 * [onDismissRequest] unless the content handles it.
 */
@Composable
fun MediaFullScreenDialog(onDismissRequest: () -> Unit, content: @Composable () -> Unit) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val view = LocalView.current
        val window = (view.parent as? DialogWindowProvider)?.window
        DisposableEffect(window) {
            window?.let {
                it.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                WindowCompat.getInsetsController(it, view).apply {
                    isAppearanceLightStatusBars = false
                    isAppearanceLightNavigationBars = false
                }
            }
            onDispose {}
        }
        content()
    }
}

/**
 * Swipe down to dismiss, shared by the lightbox and the camera's capture
 * viewer: the content follows the finger, fades to 25 % and shrinks to 88 %
 * over 320 dp, and closes past 140 dp or on a fast flick. Drags a child
 * consumes (paging, a zoomed photo) are left alone.
 */
fun Modifier.mediaSwipeToDismiss(enabled: Boolean = true, onDismiss: () -> Unit): Modifier = composed {
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current.density
    val isEnabled by rememberUpdatedState(enabled)
    val dismiss by rememberUpdatedState(onDismiss)

    // Input sits outside the layer, so the moving content doesn't shift the touch coordinates.
    pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val velocity = VelocityTracker()
            velocity.addPosition(down.uptimeMillis, down.position)
            var tracking = false
            while (true) {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (!change.pressed) break
                velocity.addPosition(change.uptimeMillis, change.position)
                if (!isEnabled) continue
                val dx = change.position.x - down.position.x
                val dy = change.position.y - down.position.y
                if (!tracking) {
                    if (change.isConsumed || event.changes.size > 1) break
                    if (dy > 10 * density && abs(dy) > 1.5f * abs(dx)) tracking = true else continue
                }
                change.consume()
                scope.launch { offset.snapTo(max(0f, dy)) }
            }
            if (!tracking) return@awaitEachGesture
            // 0.8 dp/ms, as in the RN gesture.
            if (offset.value > 140 * density || velocity.calculateVelocity().y > 800 * density) {
                scope.launch {
                    offset.animateTo(900 * density, tween(180, easing = EaseIn))
                    dismiss()
                }
            } else {
                scope.launch { offset.animateTo(0f, spring(dampingRatio = 1f)) }
            }
        }
    }.graphicsLayer {
        val y = max(0f, offset.value)
        val progress = min(1f, y / (320 * density))
        translationY = y
        scaleX = 1 - 0.12f * progress
        scaleY = 1 - 0.12f * progress
        alpha = 1 - 0.75f * progress
    }
}

/**
 * A video player with the system (Media3) controls. [headers] go with every
 * request (the Worker's authorization); a `file:` [uri] plays a local capture.
 * It never autoplays or loops, and pauses when the app leaves the screen.
 */
@OptIn(UnstableApi::class)
@Composable
fun MediaVideoPlayer(uri: Uri, modifier: Modifier = Modifier, headers: Map<String, String> = emptyMap()) {
    val context = LocalContext.current
    val player = remember(uri, headers) {
        val http = DefaultHttpDataSource.Factory().setDefaultRequestProperties(headers)
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(context, http)))
            .build()
            .apply {
                setMediaItem(androidx.media3.common.MediaItem.fromUri(uri))
                prepare()
            }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) player.pause() }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            player.release()
        }
    }
    AndroidView(
        factory = { viewContext ->
            PlayerView(viewContext).apply {
                useController = true
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
            }
        },
        update = { view -> if (view.player !== player) view.player = player },
        modifier = modifier,
    )
}

/**
 * A photo that pinch-zooms from 1× to 4×, clamped to its edges. One-finger
 * panning only works while zoomed, so a swipe at 1× reaches the pager and the
 * swipe-to-dismiss gesture. Pages that scroll away ([isCurrent] false) reset to 1×.
 */
@Composable
fun MediaZoomableImage(image: ImageBitmap, isCurrent: Boolean, onZoomChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val reportZoom by rememberUpdatedState(onZoomChange)
    var zoomed by remember { mutableStateOf(false) }

    fun setZoomed(value: Boolean) {
        if (value == zoomed) return
        zoomed = value
        reportZoom(value)
    }

    LaunchedEffect(isCurrent) {
        if (!isCurrent && scale != 1f) {
            scale = 1f
            offset = Offset.Zero
            setZoomed(false)
        }
    }

    BoxWithConstraints(modifier.clipToBounds()) {
        val box = constraints
        // The aspect-fitted image's size at 1×.
        val fit = min(box.maxWidth / image.width.toFloat(), box.maxHeight / image.height.toFloat())
        val fittedWidth = image.width * fit
        val fittedHeight = image.height * fit

        fun clamped(value: Offset, zoom: Float): Offset {
            val maxX = max(0f, (fittedWidth * zoom - box.maxWidth) / 2)
            val maxY = max(0f, (fittedHeight * zoom - box.maxHeight) / 2)
            return Offset(value.x.coerceIn(-maxX, maxX), value.y.coerceIn(-maxY, maxY))
        }

        Image(
            image, contentDescription = null, contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(image) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        do {
                            val event = awaitPointerEvent()
                            val pressed = event.changes.count { it.pressed }
                            if (pressed >= 2) {
                                val next = (scale * event.calculateZoom()).coerceIn(1f, 4f)
                                val center = Offset(size.width / 2f, size.height / 2f)
                                val centroid = event.calculateCentroid(useCurrent = true) - center
                                val zoomedOffset = centroid - (centroid - offset) * (next / scale)
                                offset = clamped(zoomedOffset + event.calculatePan(), next)
                                scale = next
                                event.changes.forEach { it.consume() }
                            } else if (pressed == 1 && scale > 1.01f) {
                                offset = clamped(offset + event.calculatePan(), scale)
                                event.changes.forEach { it.consume() }
                            }
                            setZoomed(scale > 1.01f)
                        } while (event.changes.any { it.pressed })
                    }
                }
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                },
        )
    }
}
