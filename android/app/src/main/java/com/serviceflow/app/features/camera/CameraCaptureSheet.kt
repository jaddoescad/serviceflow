package com.serviceflow.app.features.camera

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.app.design.hex
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The white drawer at the bottom of the camera: this opening's shots, then
 * the job's earlier photos, newest first, each with a note field, dictation
 * and the photo editor. It follows the finger and settles all the way down
 * (grabber only), at one row, or all the way up.
 */
@Composable
fun CameraCaptureSheet(
    entries: List<CameraDrawerEntry>,
    isLoading: Boolean,
    collapsedHeight: Dp,
    expandedHeight: Dp,
    bottomInset: Dp,
    dictation: CameraDictation,
    canEdit: (CameraDrawerEntry) -> Boolean,
    onEdit: (CameraDrawerEntry) -> Unit,
    onView: (CameraDrawerEntry) -> Unit,
    onNote: (CameraDrawerEntry, String) -> Unit,
    onDictationBegin: () -> Unit,
    onDictationEnd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    var stop by remember { mutableStateOf(SheetStop.Peek) }
    val collapsed by rememberUpdatedState(collapsedHeight)
    val expanded by rememberUpdatedState(expandedHeight)

    fun px(at: SheetStop): Float = with(density) {
        when (at) {
            SheetStop.Minimized -> MINIMIZED_HEIGHT.toPx()
            SheetStop.Peek -> collapsed.toPx()
            SheetStop.Full -> expanded.toPx()
        }
    }

    val height = remember { Animatable(px(stop)) }
    var dragging by remember { mutableStateOf(false) }
    val settleSpec = spring<Float>(dampingRatio = 0.86f, stiffness = 500f)

    LaunchedEffect(stop, collapsedHeight, expandedHeight) {
        if (!dragging) height.animateTo(px(stop), settleSpec)
    }

    fun settle(target: SheetStop, velocityDown: Float = 0f) {
        dragging = false
        stop = target
        scope.launch { height.animateTo(px(target), settleSpec, initialVelocity = -velocityDown) }
    }

    // Follows the finger between the lowest and highest stop.
    val dragState = rememberDraggableState { delta ->
        dragging = true
        scope.launch { height.snapTo((height.value - delta).coerceIn(px(SheetStop.Minimized), px(SheetStop.Full))) }
    }
    val onDragStopped: suspend kotlinx.coroutines.CoroutineScope.(Float) -> Unit = { velocity ->
        // Settle at the stop nearest to where the flick would end.
        val projected = height.value - velocity * 0.2f
        settle(SheetStop.entries.minBy { abs(px(it) - projected) }, velocity)
    }

    var lastCount by remember { mutableStateOf(entries.size) }
    LaunchedEffect(entries.size) {
        // A new shot makes a pushed-down drawer peek so it can be noted.
        if (entries.size > lastCount && stop == SheetStop.Minimized) settle(SheetStop.Peek)
        lastCount = entries.size
    }

    Column(
        modifier
            .fillMaxWidth()
            .layout { measurable, constraints ->
                val h = height.value.roundToInt().coerceIn(0, constraints.maxHeight)
                val placeable = measurable.measure(constraints.copy(minHeight = h, maxHeight = h))
                layout(placeable.width, h) { placeable.place(0, 0) }
            }
            .clipToBounds()
            .background(SHEET_BACKGROUND, RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp))
            // Anywhere on the drawer drags it, except while its list is scrollable.
            .draggable(dragState, Orientation.Vertical, enabled = stop != SheetStop.Full, onDragStopped = onDragStopped),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(MINIMIZED_HEIGHT)
                .draggable(dragState, Orientation.Vertical, enabled = stop == SheetStop.Full, onDragStopped = onDragStopped)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button,
                    onClickLabel = if (stop == SheetStop.Full) "Collapse captures" else "Show all captures",
                ) { settle(if (stop == SheetStop.Full) SheetStop.Peek else SheetStop.Full) },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(width = 40.dp, height = 5.dp).background(hex(0xc8cccb), CircleShape))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (entries.isEmpty()) {
                Text(
                    if (isLoading) "Loading photos…" else "No photos yet",
                    style = TextStyle(fontSize = 15.sp, color = hex(0x6d7f7b)),
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 4.dp),
                )
            } else {
                // A new shot goes on top; keep it in view (a lazy list would
                // otherwise stay on the row that was showing).
                val listState = rememberLazyListState()
                LaunchedEffect(entries.first().id) { listState.scrollToItem(0) }
                LazyColumn(
                    state = listState,
                    userScrollEnabled = stop == SheetStop.Full,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp + bottomInset),
                ) {
                    items(entries, key = { it.id }) { entry ->
                        CameraCaptureRow(
                            entry = entry, dictation = dictation, canEdit = canEdit(entry),
                            onEdit = { onEdit(entry) }, onView = { onView(entry) }, onNote = { onNote(entry, it) },
                            onDictationBegin = onDictationBegin, onDictationEnd = onDictationEnd,
                        )
                    }
                }
            }
        }
        dictation.error?.let { error ->
            Text(
                error,
                style = TextStyle(fontSize = 13.sp, color = hex(0xa5321f)),
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp + bottomInset),
            )
        }
    }
}

private enum class SheetStop { Minimized, Peek, Full }

private val MINIMIZED_HEIGHT = 34.dp
private val SHEET_BACKGROUND = hex(0xf6f7f6)
