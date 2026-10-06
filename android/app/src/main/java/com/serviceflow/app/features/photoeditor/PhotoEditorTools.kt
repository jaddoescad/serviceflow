package com.serviceflow.app.features.photoeditor

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Gesture
import androidx.compose.material.icons.filled.NorthWest
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.CropSquare
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import com.serviceflow.core.AnnotationPoint
import com.serviceflow.core.AnnotationShape
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** A drawing tool in the right-hand toolbar. */
enum class PhotoEditorTool(val label: String, val icon: ImageVector, val kind: AnnotationShape.Kind) {
    Draw("Draw", Icons.Filled.Gesture, AnnotationShape.Kind.Draw),
    /** Shown rotated, as a diagonal stroke. */
    Line("Line", Icons.Filled.Remove, AnnotationShape.Kind.Line),
    Arrow("Arrow", Icons.Filled.NorthWest, AnnotationShape.Kind.Arrow),
    Ellipse("Circle", Icons.Outlined.Circle, AnnotationShape.Kind.Ellipse),
    Rectangle("Rectangle", Icons.Outlined.CropSquare, AnnotationShape.Kind.Rectangle),
    Text("Text", Icons.Filled.TextFields, AnnotationShape.Kind.Text),
}

/**
 * Stroke and text size. Values are fractions of the image's shorter side, the
 * unit the web annotation format uses.
 */
enum class PhotoEditorBrush(val label: String, val width: Double, val fontSize: Double, /** Preview dot, dp. */ val dot: Float) {
    Small("S", 0.004, 0.035, 8f),
    Medium("M", 0.008, 0.05, 12f),
    Large("L", 0.014, 0.07, 16f),
    ExtraLarge("XL", 0.022, 0.1, 21f),
}

/** The colour choices, as `#rrggbb` (the web format). */
object PhotoEditorPalette {
    data class Choice(val hex: String, val name: String)

    val colors = listOf(
        Choice("#E5FF00", "Yellow"), Choice("#FF3B30", "Red"), Choice("#FF9500", "Orange"), Choice("#34C759", "Green"),
        Choice("#0A84FF", "Blue"), Choice("#FFFFFF", "White"), Choice("#000000", "Black"),
    )

    val defaultColor: String get() = colors[0].hex
}

/** Geometry helpers for drawing and hit-testing, in image coordinates. */
object PhotoEditorGeometry {
    /** Shortest distance from [point] to the segment [a]–[b]. */
    fun distance(point: Offset, a: Offset, b: Offset): Float {
        val dx = b.x - a.x
        val dy = b.y - a.y
        val lengthSquared = dx * dx + dy * dy
        if (lengthSquared <= 0) return hypot(point.x - a.x, point.y - a.y)
        val t = max(0f, min(1f, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
        return hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
    }

    /**
     * Ramer–Douglas–Peucker simplification of a freehand stroke, so strokes
     * stay small (the server accepts at most 2,000 points per shape).
     */
    fun simplify(points: List<AnnotationPoint>, tolerance: Double = 0.0015): List<AnnotationPoint> {
        if (points.size <= 2) return points
        val keep = BooleanArray(points.size)
        keep[0] = true
        keep[points.size - 1] = true
        val ranges = ArrayDeque(listOf(0 to points.size - 1))
        while (ranges.isNotEmpty()) {
            val (start, end) = ranges.removeLast()
            if (end <= start + 1) continue
            var furthestIndex = start
            var furthest = 0.0
            for (index in start + 1 until end) {
                val distance = perpendicularDistance(points[index], points[start], points[end])
                if (distance > furthest) {
                    furthest = distance
                    furthestIndex = index
                }
            }
            if (furthest > tolerance) {
                keep[furthestIndex] = true
                ranges.addLast(start to furthestIndex)
                ranges.addLast(furthestIndex to end)
            }
        }
        return points.filterIndexed { index, _ -> keep[index] }.take(2000)
    }

    private fun perpendicularDistance(p: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): Double {
        val dx = b.x - a.x
        val dy = b.y - a.y
        val length = sqrt(dx * dx + dy * dy)
        if (length <= 0) return sqrt((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y))
        return abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length
    }
}
