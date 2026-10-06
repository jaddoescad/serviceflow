package com.serviceflow.app.features.photoeditor

import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.AnnotationShape
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val Accent = Color(0xFF0A84FF)

/** What a touch does, decided where it starts. */
private sealed interface Interaction {
    data class Resizing(val original: AnnotationShape, val handle: PhotoEditorHandle) : Interaction
    data class Moving(val original: AnnotationShape) : Interaction
    data object Drawing : Interaction
    data object None : Interaction
}

/**
 * The photo with its drawings, and the one gesture that draws, selects,
 * moves and resizes. Geometry is in dp, like the iOS points it was tuned in.
 *
 * A touch is interpreted when it starts: on a handle of the selected
 * drawing it resizes, on the selected drawing it moves it, elsewhere it
 * draws with the current tool. A tap selects the drawing under it (with any
 * tool), places text with the text tool, or clears the selection.
 */
@Composable
internal fun PhotoEditorCanvas(model: PhotoEditorModel, onTouch: () -> Unit, modifier: Modifier = Modifier) {
    val density = LocalDensity.current.density
    val image = remember(model.image) { model.image.asImageBitmap() }

    BoxWithConstraints(modifier.clipToBounds()) {
        val width = constraints.maxWidth / density
        val height = constraints.maxHeight / density
        val fitted = AnnotationRenderer.fittedRect(model.image.width.toFloat(), model.image.height.toFloat(),
                                                   RectF(0f, 8f, width, max(8f, height - 8f)))
        val rect = Rect(fitted.left, fitted.top, fitted.right, fitted.bottom)
        val selection = remember(rect.size) { PhotoEditorSelection(rect.size) }
        val imageFrame = Modifier.offset(rect.left.dp, rect.top.dp).size(rect.width.dp, rect.height.dp)

        Box(Modifier.fillMaxSize().pointerInput(rect, density) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                onTouch()
                fun local(position: Offset) = Offset(position.x / density - rect.left, position.y / density - rect.top)
                val start = local(down.position)
                val interaction = begin(model, start, selection)
                var location = start
                fun changed() = handleChange(model, interaction, start, location, rect.size, selection)
                changed()
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    location = local(change.position)
                    if (!change.pressed) break
                    change.consume()
                    changed()
                }
                val tapped = hypot(location.x - start.x, location.y - start.y) < 6
                if (interaction == Interaction.Drawing) model.finishDraft(rect.size)
                if (tapped) tap(model, selection.normalized(location), rect.size)
            }
        })

        // Saved shapes and the shape being drawn are separate layers, so a
        // stroke in progress doesn't redraw everything else.
        val editing = model.textDraft?.id
        val saved = if (editing == null) model.shapes else model.shapes.filter { it.id != editing }
        Canvas(imageFrame) {
            drawImage(image, dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()), filterQuality = FilterQuality.High)
            drawAnnotations(AnnotationDocument(shapes = saved), density)
        }
        val live = model.draft ?: model.textPreview
        if (live != null) {
            Canvas(imageFrame.alpha(if (model.textDraft?.text?.isEmpty() == true) 0.5f else 1f)) {
                drawAnnotations(AnnotationDocument(shapes = listOf(live)), density)
            }
        }
        val selected = model.selectedShape
        if (model.textDraft == null && selected != null) {
            Canvas(imageFrame) { drawSelection(selected, selection, density) }
            SelectionActions(model, selected, selection, rect)
        }
    }
}

/** Draws in dp so stroke and text sizes match the selection geometry. */
private fun DrawScope.drawAnnotations(document: AnnotationDocument, density: Float) {
    drawIntoCanvas { canvas ->
        val native = canvas.nativeCanvas
        native.save()
        native.scale(density, density)
        AnnotationRenderer.draw(document, RectF(0f, 0f, size.width / density, size.height / density), native)
        native.restore()
    }
}

/** The dashed box and drag handles around the selected drawing. */
private fun DrawScope.drawSelection(shape: AnnotationShape, selection: PhotoEditorSelection, density: Float) {
    if (shape.type != AnnotationShape.Kind.Line && shape.type != AnnotationShape.Kind.Arrow) {
        val box = selection.bounds(shape).inflate(6f)
        drawRect(
            Accent, topLeft = box.topLeft * density,
            size = Size(max(box.width, 1f) * density, max(box.height, 1f) * density),
            style = Stroke(width = 1.5f * density, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5 * density, 4 * density))),
        )
    }
    for ((_, point) in selection.handles(shape)) {
        val center = point * density
        drawCircle(Color.Black.copy(alpha = 0.25f), radius = 10.5f * density, center = center + Offset(0f, 0.5f * density))
        drawCircle(Color.White, radius = 9f * density, center = center)
        drawCircle(Accent, radius = 7.75f * density, center = center, style = Stroke(width = 2.5f * density))
    }
}

/** Duplicate, Edit (text) and Delete, just above the selected drawing. */
@Composable
private fun SelectionActions(model: PhotoEditorModel, shape: AnnotationShape, selection: PhotoEditorSelection, rect: Rect) {
    val box = selection.bounds(shape)
    val y = if (box.top - 34 > 20) box.top - 34 else min(rect.height - 20, box.bottom + 34)
    val x = min(max(box.center.x, 90f), rect.width - 90)
    Row(
        Modifier
            .layout { measurable, constraints ->
                val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
                layout(placeable.width, placeable.height) {
                    placeable.place(IntOffset(((rect.left + x).dp.roundToPx() - placeable.width / 2),
                                              ((rect.top + y).dp.roundToPx() - placeable.height / 2)))
                }
            }
            .background(Color(0xE62C2C2E), RoundedCornerShape(50))
            .padding(4.dp),
    ) {
        ActionButton("Duplicate", Icons.Outlined.ContentCopy, Color.White, model::duplicateSelection)
        if (shape.type == AnnotationShape.Kind.Text) {
            ActionButton("Edit", Icons.Outlined.Edit, Color.White, model::editSelectedText)
        }
        ActionButton("Delete", Icons.Outlined.Delete, Color(0xFFFF6B6B)) { model.delete(shape.id) }
    }
}

@Composable
private fun ActionButton(title: String, icon: ImageVector, color: Color, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        colors = ButtonDefaults.textButtonColors(contentColor = color),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 7.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(5.dp))
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

// MARK: Gesture

/** Decides what a touch does from where it starts. */
private fun begin(model: PhotoEditorModel, start: Offset, selection: PhotoEditorSelection): Interaction {
    val selected = model.selectedShape
    if (selected != null && model.textDraft == null) {
        selection.handle(selected, start)?.let { handle ->
            model.checkpoint()
            return Interaction.Resizing(selected, handle)
        }
        if (model.shapeAt(selection.normalized(start), selection.imageSize)?.id == selected.id) {
            model.checkpoint()
            return Interaction.Moving(selected)
        }
    }
    if (model.tool == null) {
        // With no drawing tool, dragging any drawing moves it.
        val hit = model.shapeAt(selection.normalized(start), selection.imageSize) ?: return Interaction.None
        model.selectedId = hit.id
        model.checkpoint()
        return Interaction.Moving(hit)
    }
    return if (model.tool == PhotoEditorTool.Text) Interaction.None else Interaction.Drawing
}

private fun handleChange(model: PhotoEditorModel, interaction: Interaction, start: Offset, location: Offset,
                         imageSize: Size, selection: PhotoEditorSelection) {
    when (interaction) {
        is Interaction.Resizing -> model.update(selection.resized(interaction.original, interaction.handle, location))
        is Interaction.Moving -> {
            val dx = location.x - start.x
            val dy = location.y - start.y
            if (hypot(dx, dy) <= 3) return
            model.move(interaction.original, dx / max(1f, imageSize.width), dy / max(1f, imageSize.height))
        }
        Interaction.Drawing -> {
            val tool = model.tool
            if (tool != null && tool != PhotoEditorTool.Text) {
                model.continueDraft(selection.normalized(start), selection.normalized(location), tool)
            }
        }
        Interaction.None -> Unit
    }
}

/** A tap selects the drawing under it, places text, or clears the selection. */
private fun tap(model: PhotoEditorModel, point: com.serviceflow.core.AnnotationPoint, imageSize: Size) {
    val hit = model.shapeAt(point, imageSize)
    when {
        model.textDraft != null -> model.commitText()
        hit != null -> model.selectedId = hit.id
        model.tool == PhotoEditorTool.Text -> model.beginText(point)
        else -> model.selectedId = null
    }
}
