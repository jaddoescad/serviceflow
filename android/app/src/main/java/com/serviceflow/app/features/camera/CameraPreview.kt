package com.serviceflow.app.features.camera

import android.view.OrientationEventListener
import android.view.Surface
import android.view.ViewGroup
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.serviceflow.app.design.hex
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The live camera image, aspect-filled and full bleed. Pinch zooms, a tap
 * focuses, and a sideways swipe calls [onSwipe] (negative is leftwards). The
 * orientation listener tells the model which way to rotate captures.
 */
@Composable
fun CameraPreview(model: CameraModel, onSwipe: (Float) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val touchSlop = LocalViewConfiguration.current.touchSlop
    val swipe by rememberUpdatedState(onSwipe)
    var focusPoint by remember { mutableStateOf<Offset?>(null) }
    var focusTap by remember { mutableStateOf(0) }

    DisposableEffect(model) {
        var rotation = Surface.ROTATION_0
        val listener = object : OrientationEventListener(context) {
            override fun onOrientationChanged(degrees: Int) {
                if (degrees != ORIENTATION_UNKNOWN) rotation = CameraSessionEngine.rotation(degrees)
            }
        }
        listener.enable()
        model.captureRotation = { rotation }
        onDispose { listener.disable() }
    }

    Box(modifier.fillMaxSize()) {
        AndroidView(
            factory = {
                val view = model.engine.previewView
                (view.parent as? ViewGroup)?.removeView(view)
                view
            },
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(model) {
                    val swipeDistance = with(density) { 50.dp.toPx() }
                    val minimumDrag = with(density) { 24.dp.toPx() }
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var pinching = false
                        var startSpan = 0f
                        var total = Offset.Zero
                        var moved = false
                        while (true) {
                            val event = awaitPointerEvent()
                            val pressed = event.changes.filter { it.pressed }
                            if (pressed.isEmpty()) break
                            if (pressed.size >= 2) {
                                val span = (pressed[0].position - pressed[1].position).getDistance()
                                if (!pinching) {
                                    pinching = true
                                    startSpan = maxOf(span, 1f)
                                    model.pinchBegan()
                                } else {
                                    model.pinchChanged(span / startSpan)
                                }
                                event.changes.forEach { it.consume() }
                            } else if (!pinching) {
                                total += pressed[0].positionChange()
                                if (total.getDistance() > maxOf(touchSlop, minimumDrag)) moved = true
                            }
                        }
                        if (pinching) return@awaitEachGesture
                        if (!moved) {
                            focusPoint = down.position
                            focusTap += 1
                            model.focus(down.position.x, down.position.y)
                        } else if (abs(total.x) > swipeDistance && abs(total.x) > abs(total.y) * 1.5f) {
                            swipe(total.x)
                        }
                    }
                },
        )
        focusPoint?.let { point -> FocusRing(point, focusTap) }
    }
}

/** The yellow square that marks a tap to focus. */
@Composable
private fun FocusRing(point: Offset, tap: Int) {
    val scale = remember { Animatable(1.3f) }
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(tap) {
        alpha.snapTo(1f)
        scale.snapTo(1.3f)
        launch { scale.animateTo(1f, tween(200)) }
        delay(800)
        alpha.animateTo(0f, tween(300))
    }
    val half = with(LocalDensity.current) { 36.dp.toPx() }
    Box(
        Modifier
            .offset { IntOffset((point.x - half).roundToInt(), (point.y - half).roundToInt()) }
            .size(72.dp)
            .graphicsLayer {
                scaleX = scale.value
                scaleY = scale.value
                this.alpha = alpha.value
            }
            .border(1.5.dp, hex(0xffd633)),
    )
}
