package com.serviceflow.app.features.photoeditor

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import com.serviceflow.core.AnnotationPoint
import com.serviceflow.core.AnnotationShape
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * A drag handle on the selected shape: an end of a line or arrow, or a
 * corner of the box around any other shape.
 */
sealed interface PhotoEditorHandle {
    data class End(val index: Int) : PhotoEditorHandle
    data class Corner(val corner: BoxCorner) : PhotoEditorHandle
}

enum class BoxCorner {
    TopLeft, TopRight, BottomLeft, BottomRight;

    /** The corner that stays put while this one is dragged. */
    val opposite: BoxCorner
        get() = when (this) {
            TopLeft -> BottomRight
            TopRight -> BottomLeft
            BottomLeft -> TopRight
            BottomRight -> TopLeft
        }

    fun point(box: Rect): Offset = when (this) {
        TopLeft -> box.topLeft
        TopRight -> box.topRight
        BottomLeft -> box.bottomLeft
        BottomRight -> box.bottomRight
    }
}

/**
 * Selection geometry in dp, for a photo drawn at [imageSize] (dp). Shapes are
 * stored as fractions of the photo, so every function converts between the two.
 */
class PhotoEditorSelection(val imageSize: Size) {
    private val unit: Float get() = min(imageSize.width, imageSize.height)

    fun viewPoint(point: AnnotationPoint): Offset =
        Offset(point.x.toFloat() * imageSize.width, point.y.toFloat() * imageSize.height)

    fun normalized(point: Offset): AnnotationPoint =
        AnnotationPoint(x = (point.x / max(1f, imageSize.width)).toDouble(), y = (point.y / max(1f, imageSize.height)).toDouble())

    /** The box around a shape. */
    fun bounds(shape: AnnotationShape): Rect {
        val points = shape.points.map(::viewPoint)
        val first = points.firstOrNull() ?: return Rect.Zero
        if (shape.type == AnnotationShape.Kind.Text) {
            val size = AnnotationRenderer.textSize(shape, unit)
            return Rect(first, Size(size.width, size.height))
        }
        return Rect(points.minOf { it.x }, points.minOf { it.y }, points.maxOf { it.x }, points.maxOf { it.y })
    }

    /** The handles to show on a selected shape. */
    fun handles(shape: AnnotationShape): List<Pair<PhotoEditorHandle, Offset>> = when (shape.type) {
        AnnotationShape.Kind.Line, AnnotationShape.Kind.Arrow ->
            shape.points.take(2).mapIndexed { index, point -> PhotoEditorHandle.End(index) to viewPoint(point) }
        else -> {
            val box = bounds(shape)
            BoxCorner.entries.map { PhotoEditorHandle.Corner(it) to it.point(box) }
        }
    }

    /** The handle within reach of [location], if any. */
    fun handle(shape: AnnotationShape, location: Offset, reach: Float = 26f): PhotoEditorHandle? =
        handles(shape)
            .map { (handle, point) -> handle to hypot(point.x - location.x, point.y - location.y) }
            .filter { it.second <= reach }
            .minByOrNull { it.second }?.first

    /** [original] with [handle] dragged to [location]. */
    fun resized(original: AnnotationShape, handle: PhotoEditorHandle, location: Offset): AnnotationShape = when {
        handle is PhotoEditorHandle.End && handle.index in original.points.indices ->
            original.copy(points = original.points.toMutableList().also { it[handle.index] = normalized(location) })
        handle is PhotoEditorHandle.Corner && (original.type == AnnotationShape.Kind.Rectangle ||
            original.type == AnnotationShape.Kind.Ellipse) -> {
            // Stored as two opposite corners: keep the fixed one, move the other.
            val fixed = handle.corner.opposite.point(bounds(original))
            original.copy(points = listOf(normalized(fixed), normalized(location)))
        }
        handle is PhotoEditorHandle.Corner && original.type == AnnotationShape.Kind.Draw ->
            original.copy(points = scaled(original, handle.corner, location))
        handle is PhotoEditorHandle.Corner && original.type == AnnotationShape.Kind.Text ->
            resizedText(original, handle.corner, location)
        else -> original
    }

    /** Scales a freehand stroke inside its box, keeping the opposite corner fixed. */
    private fun scaled(shape: AnnotationShape, corner: BoxCorner, location: Offset): List<AnnotationPoint> {
        val box = bounds(shape)
        val anchor = corner.opposite.point(box)
        val from = corner.point(box)
        val sx = factor(moved = location.x - anchor.x, original = from.x - anchor.x)
        val sy = factor(moved = location.y - anchor.y, original = from.y - anchor.y)
        return shape.points.map { point ->
            val p = viewPoint(point)
            normalized(Offset(anchor.x + (p.x - anchor.x) * sx, anchor.y + (p.y - anchor.y) * sy))
        }
    }

    /** Resizes text by its font size, keeping the opposite corner of its box in place. */
    private fun resizedText(shape: AnnotationShape, corner: BoxCorner, location: Offset): AnnotationShape {
        val box = bounds(shape)
        val fontSize = shape.fontSize
        if (box.width <= 0 || fontSize == null) return shape
        val anchor = corner.opposite.point(box)
        val scale = max(MINIMUM_SIDE, abs(location.x - anchor.x)) / box.width
        var resized = shape.copy(fontSize = min(0.2, max(0.01, fontSize * scale)))
        val size = AnnotationRenderer.textSize(resized, unit)
        // The text is anchored at its top-left, so place that corner so the
        // opposite corner doesn't move.
        val origin = when (corner.opposite) {
            BoxCorner.TopLeft -> anchor
            BoxCorner.TopRight -> Offset(anchor.x - size.width, anchor.y)
            BoxCorner.BottomLeft -> Offset(anchor.x, anchor.y - size.height)
            BoxCorner.BottomRight -> Offset(anchor.x - size.width, anchor.y - size.height)
        }
        resized = resized.copy(points = listOf(normalized(origin)))
        return resized
    }

    private companion object {
        /** Shapes smaller than this can't be resized any further. */
        const val MINIMUM_SIDE = 12f

        /** How much a side stretched, never collapsing to nothing. */
        fun factor(moved: Float, original: Float): Float {
            if (abs(original) <= 0.5f) return 1f
            val factor = moved / original
            val minimum = MINIMUM_SIDE / abs(original)
            return if (abs(factor) < minimum) (if (factor < 0) -minimum else minimum) else factor
        }
    }
}
