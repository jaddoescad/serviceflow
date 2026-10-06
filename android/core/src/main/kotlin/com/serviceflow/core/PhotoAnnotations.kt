package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

/**
 * Drawings on a photo, stored separately from the image so they can be edited
 * later. Same format as the web admin's annotation editor
 * (`web/src/lib/photo-annotations.ts`): coordinates are fractions (0…1) of the
 * image size; widths and font sizes are fractions of the image's shorter side.
 */
@Serializable
data class AnnotationDocument(
    val version: Int = 1,
    val shapes: List<AnnotationShape> = emptyList(),
) {
    val isEmpty: Boolean get() = shapes.isEmpty()

    /** Drops shapes the server would reject. */
    fun sanitized(): AnnotationDocument =
        AnnotationDocument(shapes = shapes.mapNotNull { it.sanitized() }.take(maxShapes))

    companion object {
        const val maxShapes = 200
    }
}

/** `AnnotationPoint(x, y)` clamps to the image (decoding does not, as in Swift). */
@ConsistentCopyVisibility
@Serializable
data class AnnotationPoint private constructor(val x: Double, val y: Double) {
    companion object {
        // Inside the companion this call resolves to the private constructor.
        operator fun invoke(x: Double, y: Double): AnnotationPoint = AnnotationPoint(min(1.0, max(0.0, x)), min(1.0, max(0.0, y)))
    }
}

@Serializable
data class AnnotationShape(
    /** Lowercase UUID. */
    val id: String = UUID.randomUUID().toString().lowercase(),
    val type: Kind,
    val points: List<AnnotationPoint>,
    /** `#rrggbb`. */
    val color: String,
    /** Stroke width as a fraction of the image's shorter side (0.001…0.05). */
    val width: Double,
    val text: String? = null,
    /** Font size as a fraction of the image's shorter side (0.01…0.2). */
    val fontSize: Double? = null,
) {
    @Serializable
    enum class Kind(val rawValue: String) {
        @SerialName("arrow") Arrow("arrow"),
        @SerialName("line") Line("line"),
        @SerialName("rectangle") Rectangle("rectangle"),
        @SerialName("ellipse") Ellipse("ellipse"),
        @SerialName("draw") Draw("draw"),
        @SerialName("text") Text("text");

        companion object {
            fun fromRaw(value: String?): Kind? = entries.firstOrNull { it.rawValue == value }
        }
    }

    /** The shape clamped to the server's rules, or null when it can't be saved. */
    fun sanitized(): AnnotationShape? {
        var shape = copy(id = id.lowercase(), width = min(0.05, max(0.001, width)))
        if (!Regex("^#[0-9a-fA-F]{6}$").containsMatchIn(shape.color)) return null
        when (type) {
            Kind.Text -> {
                val trimmed = text?.trim()
                if (points.size != 1 || trimmed.isNullOrEmpty()) return null
                shape = shape.copy(text = trimmed.take(1000), fontSize = min(0.2, max(0.01, fontSize ?: 0.05)))
            }
            Kind.Draw -> {
                if (points.size < 2) return null
                shape = shape.copy(points = points.take(2000), text = null, fontSize = null)
            }
            else -> {
                if (points.size != 2) return null
                shape = shape.copy(text = null, fontSize = null)
            }
        }
        return shape
    }
}
