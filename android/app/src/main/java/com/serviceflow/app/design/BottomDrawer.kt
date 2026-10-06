package com.serviceflow.app.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Where a [BottomDrawer] rests. */
enum class DrawerStop {
    /** Just the grabber and the header row. */
    Collapsed,
    /** About half the space. */
    Middle,
    /** Nearly the whole space. */
    Expanded;

    /** The next stop when the grabber is tapped. */
    val next: DrawerStop
        get() = when (this) {
            Collapsed -> Middle
            Middle -> Expanded
            Expanded -> Collapsed
        }
}

object BottomDrawerDefaults {
    val cornerRadius = 16.dp
    /** Height of the grabber area above the header. */
    val grabberHeight = 20.dp

    /** Resting height at [stop] for a container of [available] height. */
    fun height(stop: DrawerStop, collapsed: Dp, available: Dp): Dp {
        val top = max(collapsed.value, available.value - 12)
        return when (stop) {
            DrawerStop.Collapsed -> collapsed
            DrawerStop.Middle -> min(top, max(collapsed.value + 120, available.value * 0.46f)).dp
            DrawerStop.Expanded -> top.dp
        }
    }
}

/**
 * A drawer at the bottom of its container, like the Maps sheet. It follows the
 * finger and settles at the nearest of three stops. The header always drags;
 * the content drags the drawer until it's fully open, then scrolls, and
 * pulling down from the top of the content lowers it again. Tapping the
 * grabber moves to the next stop.
 *
 * Place it in a container that ends above the navigation bar (it never
 * covers it). On wide screens it becomes a card on the leading side.
 *
 * @param collapsedHeight height of the collapsed drawer: grabber ([BottomDrawerDefaults.grabberHeight]) plus header.
 * @param availableHeight height of the space the drawer lives in.
 */
@Composable
fun BottomDrawer(
    stop: DrawerStop,
    onStopChange: (DrawerStop) -> Unit,
    collapsedHeight: Dp,
    availableHeight: Dp,
    modifier: Modifier = Modifier,
    header: @Composable ColumnScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val currentStop by rememberUpdatedState(stop)
    val currentOnStopChange by rememberUpdatedState(onStopChange)
    val collapsed by rememberUpdatedState(collapsedHeight)
    val available by rememberUpdatedState(availableHeight)

    fun px(at: DrawerStop): Float =
        with(density) { BottomDrawerDefaults.height(at, collapsed, available).toPx() }

    val height = remember { Animatable(px(stop)) }
    // The finger-following height before rubber-banding, while a drag is in progress.
    val drag = remember { DragState() }
    val settleSpec = spring<Float>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

    LaunchedEffect(stop, collapsedHeight, availableHeight) {
        if (!drag.active) height.animateTo(px(stop), settleSpec)
    }

    fun dragBy(deltaDown: Float) {
        if (!drag.active) {
            drag.active = true
            drag.raw = height.value
        }
        drag.raw -= deltaDown
        val low = px(DrawerStop.Collapsed)
        val high = px(DrawerStop.Expanded)
        val band = with(density) { 40.dp.toPx() }
        val reach = with(density) { 120.dp.toPx() }
        fun rubber(distance: Float) = band * (1 - 1 / (distance / reach + 1))
        val shown = when {
            drag.raw < low -> low - rubber(low - drag.raw)
            drag.raw > high -> high + rubber(drag.raw - high)
            else -> drag.raw
        }
        scope.launch { height.snapTo(shown) }
    }

    fun settle(target: DrawerStop, velocityDown: Float = 0f) {
        drag.active = false
        scope.launch { height.animateTo(px(target), settleSpec, initialVelocity = -velocityDown) }
        if (target != currentStop) currentOnStopChange(target)
    }

    fun finish(velocityDown: Float) {
        // Where the fling would carry the drawer, then the nearest stop to that.
        val projected = height.value - velocityDown * 0.2f
        val nearest = DrawerStop.entries.minBy { abs(px(it) - projected) }
        settle(nearest, velocityDown)
    }

    val connection = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput) return Offset.Zero
                val dy = available.y
                // Below the top stop, pulling up opens the drawer instead of scrolling.
                val belowTop = height.value < px(DrawerStop.Expanded) - 0.5f
                if ((dy < 0 && belowTop) || (dy != 0f && drag.active)) {
                    dragBy(dy)
                    return Offset(0f, dy)
                }
                return Offset.Zero
            }

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                // Pulling down from the top of the content lowers the drawer.
                if (source == NestedScrollSource.UserInput && available.y > 0) {
                    dragBy(available.y)
                    return Offset(0f, available.y)
                }
                return Offset.Zero
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                if (!drag.active) return Velocity.Zero
                finish(available.y)
                return available
            }
        }
    }

    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth > 600.dp
        val radius = BottomDrawerDefaults.cornerRadius
        val shape = if (wide) RoundedCornerShape(radius) else RoundedCornerShape(topStart = radius, topEnd = radius)
        Surface(
            shape = shape,
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            shadowElevation = 8.dp,
            modifier = Modifier
                .align(if (wide) Alignment.BottomStart else Alignment.BottomCenter)
                .padding(start = if (wide) 12.dp else 0.dp, bottom = if (wide) 12.dp else 0.dp)
                .then(if (wide) Modifier.width(min(500.dp.value, maxWidth.value - 24).dp) else Modifier.fillMaxWidth())
                .layout { measurable, constraints ->
                    val h = max(0, height.value.roundToInt())
                    val placeable = measurable.measure(constraints.copy(minHeight = h, maxHeight = h))
                    layout(placeable.width, h) { placeable.place(0, 0) }
                },
        ) {
            Column {
                Column(
                    Modifier.draggable(
                        state = rememberDraggableState { delta -> dragBy(delta) },
                        orientation = Orientation.Vertical,
                        onDragStopped = { velocity -> finish(velocity) },
                    ),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(BottomDrawerDefaults.grabberHeight)
                            .clickable(
                                role = Role.Button,
                                onClickLabel = if (stop == DrawerStop.Expanded) "Collapse panel" else "Expand panel",
                            ) { settle(currentStop.next) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            Modifier
                                .size(width = 36.dp, height = 5.dp)
                                .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f), RoundedCornerShape(50)),
                        )
                    }
                    header()
                }
                Column(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .nestedScroll(connection)
                        .verticalScroll(rememberScrollState()),
                    content = content,
                )
            }
        }
    }
}

private class DragState {
    var active = false
    var raw = 0f
}
