package com.serviceflow.app.features.photoeditor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.util.SizeF
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.AnnotationPoint
import com.serviceflow.core.AnnotationShape
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Draws photo annotations exactly as the web admin does
 * (`web/src/components/photo-annotation-surface.tsx`): points are fractions of
 * the image, stroke widths and font sizes are fractions of the image's
 * shorter side, arrows get a two-stroke head, and text is sans-serif with a
 * dark outline painted under the fill.
 */
object AnnotationRenderer {
    /** Draws [document] into [rect] (the image's frame) of [canvas]. */
    fun draw(document: AnnotationDocument, rect: RectF, canvas: Canvas) {
        for (shape in document.shapes) draw(shape, rect, canvas)
    }

    fun draw(shape: AnnotationShape, rect: RectF, canvas: Canvas) {
        if (rect.width() <= 0 || rect.height() <= 0) return
        val unit = min(rect.width(), rect.height())
        val lineWidth = shape.width.toFloat() * unit
        val color = annotationColor(shape.color)
        val points = shape.points.map { point(it, rect) }
        val first = points.firstOrNull() ?: return
        val scale = rect.width() / 1000

        if (shape.type == AnnotationShape.Kind.Text) {
            drawText(shape, first, unit, lineWidth, color, scale, canvas)
            return
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            this.color = color
            strokeWidth = lineWidth
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        canvas.drawPath(path(shape, points, lineWidth, scale), paint)
    }

    /** The stroked outline of a non-text shape. */
    fun path(shape: AnnotationShape, points: List<PointF>, lineWidth: Float, scale: Float): Path {
        val path = Path()
        val a = points.firstOrNull() ?: return path
        val b = points.getOrElse(1) { a }
        when (shape.type) {
            AnnotationShape.Kind.Rectangle ->
                path.addRect(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y), Path.Direction.CW)
            AnnotationShape.Kind.Ellipse ->
                path.addOval(RectF(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y)), Path.Direction.CW)
            AnnotationShape.Kind.Draw, AnnotationShape.Kind.Line, AnnotationShape.Kind.Arrow -> {
                path.moveTo(a.x, a.y)
                for (point in points.drop(1)) path.lineTo(point.x, point.y)
                if (shape.type == AnnotationShape.Kind.Arrow) {
                    val angle = atan2((b.y - a.y).toDouble(), (b.x - a.x).toDouble())
                    val size = max(12 * scale, lineWidth * 5)
                    path.moveTo(b.x - size * cos(angle - 0.5).toFloat(), b.y - size * sin(angle - 0.5).toFloat())
                    path.lineTo(b.x, b.y)
                    path.lineTo(b.x - size * cos(angle + 0.5).toFloat(), b.y - size * sin(angle + 0.5).toFloat())
                }
            }
            AnnotationShape.Kind.Text -> Unit
        }
        return path
    }

    fun point(point: AnnotationPoint, rect: RectF): PointF =
        PointF(rect.left + point.x.toFloat() * rect.width(), rect.top + point.y.toFloat() * rect.height())

    // MARK: Text

    fun textPaint(shape: AnnotationShape, unit: Float): Paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        typeface = Typeface.SANS_SERIF
        textSize = max(1f, (shape.fontSize ?: 0.035).toFloat() * unit)
    }

    /** Size of a text shape's box, top-left anchored. */
    fun textSize(shape: AnnotationShape, unit: Float): SizeF {
        val paint = textPaint(shape, unit)
        val lines = (shape.text ?: "").split("\n")
        val width = lines.maxOfOrNull { paint.measureText(it) } ?: 0f
        val height = paint.textSize * (1 + 1.2f * max(0, lines.size - 1)) + abs(paint.fontMetrics.descent)
        return SizeF(width, height)
    }

    private fun drawText(shape: AnnotationShape, origin: PointF, unit: Float, lineWidth: Float, color: Int,
                         scale: Float, canvas: Canvas) {
        val fill = textPaint(shape, unit).apply { this.color = color }
        val outline = textPaint(shape, unit).apply {
            style = Paint.Style.STROKE
            strokeWidth = max(1 * scale, lineWidth / 3)
            strokeJoin = Paint.Join.ROUND
            this.color = annotationColor("#111827")
        }
        // SVG `dominant-baseline: hanging` puts the top of the capitals at y.
        val capHeight = Rect().also { fill.getTextBounds("H", 0, 1, it) }.height()
        (shape.text ?: "").split("\n").forEachIndexed { index, line ->
            val baseline = origin.y + index * fill.textSize * 1.2f + capHeight
            canvas.drawText(line, origin.x, baseline, outline)
            canvas.drawText(line, origin.x, baseline, fill)
        }
    }

    // MARK: Compositing

    /** The image with its drawings burned in (for viewing, not uploading). */
    fun composite(image: Bitmap, document: AnnotationDocument): Bitmap {
        if (document.isEmpty) return image
        val result = image.copy(Bitmap.Config.ARGB_8888, true) ?: return image
        draw(document, RectF(0f, 0f, result.width.toFloat(), result.height.toFloat()), Canvas(result))
        return result
    }

    /** Where an image of `imageWidth`×`imageHeight` sits when aspect-fitted into [bounds]. */
    fun fittedRect(imageWidth: Float, imageHeight: Float, bounds: RectF): RectF {
        if (imageWidth <= 0 || imageHeight <= 0 || bounds.width() <= 0 || bounds.height() <= 0) return RectF()
        val scale = min(bounds.width() / imageWidth, bounds.height() / imageHeight)
        val width = imageWidth * scale
        val height = imageHeight * scale
        val left = bounds.centerX() - width / 2
        val top = bounds.centerY() - height / 2
        return RectF(left, top, left + width, top + height)
    }

    /** `#rrggbb`; anything else is yellow. */
    fun annotationColor(hex: String): Int {
        val digits = hex.removePrefix("#")
        val value = if (digits.length == 6) digits.toIntOrNull(16) else null
        return if (value == null) android.graphics.Color.rgb(230, 255, 0) else (0xff shl 24) or value
    }
}

/**
 * Renders an annotation document over an image-sized frame. Give it exactly
 * the image's frame (same size and position).
 */
@Composable
fun AnnotationOverlay(document: AnnotationDocument, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        drawIntoCanvas { canvas ->
            AnnotationRenderer.draw(document, RectF(0f, 0f, size.width, size.height), canvas.nativeCanvas)
        }
    }
}
