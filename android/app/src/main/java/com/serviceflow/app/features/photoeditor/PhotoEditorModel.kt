package com.serviceflow.app.features.photoeditor

import android.graphics.Bitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import com.serviceflow.core.AnnotationDocument
import com.serviceflow.core.AnnotationPoint
import com.serviceflow.core.AnnotationShape
import java.util.Locale
import java.util.UUID
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * One markup session. The photo itself is never changed: the result is a set
 * of shapes (the web admin's annotation format) and a description.
 */
class PhotoEditorModel(image: Bitmap, annotations: AnnotationDocument, description: String) {
    /** Text being typed on the photo; `id` is set when editing an existing shape. */
    data class TextDraft(val id: String?, val point: AnnotationPoint, val text: String)

    val image: Bitmap = displayImage(image)
    var shapes by mutableStateOf(annotations.shapes)
        private set
    var description by mutableStateOf(description)

    var tool by mutableStateOf<PhotoEditorTool?>(PhotoEditorTool.Draw)
        private set
    var brush by mutableStateOf(PhotoEditorBrush.Medium)
        private set
    var color by mutableStateOf(PhotoEditorPalette.defaultColor)
        private set
    var selectedId by mutableStateOf<String?>(null)
    /** The shape being drawn right now (not yet in `shapes`). */
    var draft by mutableStateOf<AnnotationShape?>(null)
        private set
    var textDraft by mutableStateOf<TextDraft?>(null)

    private var undoStack by mutableStateOf<List<List<AnnotationShape>>>(emptyList())
    private var redoStack by mutableStateOf<List<List<AnnotationShape>>>(emptyList())
    private val initialShapes = annotations.shapes
    private val initialDescription = description

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()
    val hasChanges: Boolean get() = shapes != initialShapes || description != initialDescription

    /** What Save hands back. */
    val result: Pair<AnnotationDocument, String>
        get() = AnnotationDocument(shapes = shapes).sanitized() to description.trim()

    // MARK: History

    /** Records the current shapes so the next change can be undone. */
    fun checkpoint() {
        undoStack = (undoStack + listOf(shapes)).takeLast(HISTORY_LIMIT)
        redoStack = emptyList()
    }

    fun undo() {
        commitText()
        val previous = undoStack.lastOrNull() ?: return
        undoStack = undoStack.dropLast(1)
        redoStack = redoStack + listOf(shapes)
        shapes = previous
        selectedId = null
    }

    fun redo() {
        commitText()
        val next = redoStack.lastOrNull() ?: return
        redoStack = redoStack.dropLast(1)
        undoStack = undoStack + listOf(shapes)
        shapes = next
        selectedId = null
    }

    fun clearAll() {
        textDraft = null
        if (shapes.isEmpty()) return
        checkpoint()
        shapes = emptyList()
        selectedId = null
    }

    // MARK: Shapes

    fun add(shape: AnnotationShape) {
        val clean = shape.sanitized() ?: return
        if (shapes.size >= AnnotationDocument.maxShapes) return
        checkpoint()
        shapes = shapes + clean
    }

    fun replace(shape: AnnotationShape) {
        val index = shapes.indexOfFirst { it.id == shape.id }
        if (index < 0) return
        val clean = shape.sanitized()
        if (clean == null) {
            delete(shape.id)
            return
        }
        checkpoint()
        shapes = shapes.toMutableList().also { it[index] = clean }
    }

    fun delete(id: String) {
        val index = shapes.indexOfFirst { it.id == id }
        if (index < 0) return
        checkpoint()
        shapes = shapes.toMutableList().also { it.removeAt(index) }
        if (selectedId == id) selectedId = null
    }

    val selectedShape: AnnotationShape?
        get() = selectedId?.let { id -> shapes.firstOrNull { it.id == id } }

    /**
     * Moves [original] by a normalized offset. Call [checkpoint] once when
     * the drag starts, so the whole move is one undo step.
     */
    fun move(original: AnnotationShape, dx: Float, dy: Float) {
        update(original.copy(points = original.points.map { AnnotationPoint(x = it.x + dx, y = it.y + dy) }))
    }

    /** Replaces a shape while it's being dragged (no undo step of its own). */
    fun update(shape: AnnotationShape) {
        val index = shapes.indexOfFirst { it.id == shape.id }
        if (index < 0) return
        shapes = shapes.toMutableList().also { it[index] = shape }
    }

    /** A copy of the selected shape, nudged so both are visible, and selected. */
    fun duplicateSelection() {
        val selected = selectedShape ?: return
        val copy = selected.copy(
            id = UUID.randomUUID().toString().lowercase(),
            points = selected.points.map { AnnotationPoint(x = it.x + 0.03, y = it.y + 0.03) },
        )
        add(copy)
        selectedId = copy.id
    }

    /** Colour and size apply to what's selected as well as to what's drawn next. */
    fun chooseColor(hex: String) {
        color = hex
        selectedShape?.let { replace(it.copy(color = hex)) }
    }

    fun chooseBrush(newBrush: PhotoEditorBrush) {
        brush = newBrush
        val shape = selectedShape ?: return
        replace(if (shape.type == AnnotationShape.Kind.Text) shape.copy(fontSize = newBrush.fontSize) else shape.copy(width = newBrush.width))
    }

    /** Adds the current date and time as text near the bottom left. */
    fun addTimestamp(date: java.util.Date = java.util.Date()) {
        commitText()
        val pattern = android.text.format.DateFormat.getBestDateTimePattern(Locale.getDefault(), "yMMMdjmm")
        val text = java.text.SimpleDateFormat(pattern, Locale.getDefault()).format(date)
        add(AnnotationShape(type = AnnotationShape.Kind.Text, points = listOf(AnnotationPoint(x = 0.04, y = 0.9)),
                            color = color, width = brush.width, text = text, fontSize = brush.fontSize))
    }

    fun select(newTool: PhotoEditorTool) {
        commitText()
        selectedId = null
        // Tapping the active tool again turns drawing off (just select and move).
        tool = if (tool == newTool) null else newTool
    }

    // MARK: Drawing

    /** Starts or extends the shape under the finger. */
    fun continueDraft(start: AnnotationPoint, point: AnnotationPoint, tool: PhotoEditorTool) {
        if (draft == null) {
            commitText()
            draft = AnnotationShape(type = tool.kind, points = listOf(start, start), color = color, width = brush.width)
        }
        val shape = draft ?: return
        draft = if (tool == PhotoEditorTool.Draw) {
            // Skip points that are too close to add detail.
            val last = shape.points.last()
            if (hypot(last.x - point.x, last.y - point.y) > 0.002) shape.copy(points = shape.points + point) else shape
        } else {
            shape.copy(points = listOf(shape.points[0], point))
        }
    }

    /** Commits the shape being drawn; taps and tiny shapes are dropped. */
    fun finishDraft(imageSize: Size) {
        var shape = draft ?: return
        draft = null
        if (shape.type == AnnotationShape.Kind.Draw) {
            shape = shape.copy(points = PhotoEditorGeometry.simplify(shape.points))
            if (shape.points.size < 2) return
        } else {
            val a = shape.points[0]
            val b = shape.points[1]
            if (hypot((b.x - a.x) * imageSize.width, (b.y - a.y) * imageSize.height) <= 8) return
        }
        add(shape)
    }

    // MARK: Text

    /** Starts a new text at [point]; it's typed in the bottom panel. */
    fun beginText(point: AnnotationPoint) {
        commitText()
        selectedId = null
        textDraft = TextDraft(id = null, point = point, text = "")
    }

    /** Edits the selected text in the bottom panel. */
    fun editSelectedText() {
        val shape = selectedShape ?: return
        val origin = shape.points.firstOrNull() ?: return
        if (shape.type != AnnotationShape.Kind.Text) return
        commitText()
        textDraft = TextDraft(id = shape.id, point = origin, text = shape.text ?: "")
    }

    /** The text being typed, drawn on the photo as it will look. */
    val textPreview: AnnotationShape?
        get() {
            val edit = textDraft ?: return null
            val existing = edit.id?.let { id -> shapes.firstOrNull { it.id == id } }
            return AnnotationShape(
                id = edit.id ?: "draft", type = AnnotationShape.Kind.Text, points = listOf(edit.point),
                color = existing?.color ?: color, width = existing?.width ?: brush.width,
                text = if (edit.text.trim().isEmpty()) "Text" else edit.text,
                fontSize = existing?.fontSize ?: brush.fontSize,
            )
        }

    /** Saves the text being typed; clearing an existing text removes it. */
    fun commitText() {
        val edit = textDraft ?: return
        textDraft = null
        val text = edit.text.trim()
        val existing = edit.id?.let { id -> shapes.firstOrNull { it.id == id } }
        if (existing != null) {
            if (text.isEmpty()) delete(existing.id) else if (text != existing.text) replace(existing.copy(text = text))
        } else if (text.isNotEmpty()) {
            val shape = AnnotationShape(type = AnnotationShape.Kind.Text, points = listOf(edit.point), color = color,
                                        width = brush.width, text = text, fontSize = brush.fontSize)
            add(shape)
            selectedId = shape.id
        }
    }

    // MARK: Hit testing

    /** The topmost shape near a normalized point. */
    fun shapeAt(point: AnnotationPoint, imageSize: Size): AnnotationShape? {
        val unit = min(imageSize.width, imageSize.height)
        val tolerance = max(18f, unit * 0.03f)
        val target = Offset(point.x.toFloat() * imageSize.width, point.y.toFloat() * imageSize.height)
        return shapes.lastOrNull { shape ->
            val points = shape.points.map { Offset(it.x.toFloat() * imageSize.width, it.y.toFloat() * imageSize.height) }
            val first = points.firstOrNull() ?: return@lastOrNull false
            when (shape.type) {
                AnnotationShape.Kind.Text -> {
                    val size = AnnotationRenderer.textSize(shape, unit)
                    Rect(first, Size(size.width, size.height)).inflate(tolerance / 2).contains(target)
                }
                AnnotationShape.Kind.Rectangle, AnnotationShape.Kind.Ellipse -> {
                    if (points.size != 2) return@lastOrNull false
                    val box = Rect(min(points[0].x, points[1].x), min(points[0].y, points[1].y),
                                   max(points[0].x, points[1].x), max(points[0].y, points[1].y))
                    if (!box.inflate(tolerance).contains(target)) return@lastOrNull false
                    // Rectangles are picked by their outline, circles anywhere inside.
                    val inner = box.deflate(tolerance)
                    shape.type == AnnotationShape.Kind.Ellipse || inner.width <= 0 || inner.height <= 0 || !inner.contains(target)
                }
                else -> points.zipWithNext().any { (a, b) -> PhotoEditorGeometry.distance(target, a, b) <= tolerance }
            }
        }
    }

    private companion object {
        /** Longest side of the image kept for display; enough for any screen. */
        const val DISPLAY_MAX_SIDE = 2048f
        const val HISTORY_LIMIT = 40

        /**
         * A screen-sized copy of the photo (drawings are stored in fractions of
         * the image, so resolution doesn't matter).
         */
        fun displayImage(image: Bitmap): Bitmap {
            val factor = min(1f, DISPLAY_MAX_SIDE / max(max(image.width, image.height), 1))
            if (factor >= 1f) return image
            return Bitmap.createScaledBitmap(image, (image.width * factor).roundToInt().coerceAtLeast(1),
                                             (image.height * factor).roundToInt().coerceAtLeast(1), true)
        }
    }
}
