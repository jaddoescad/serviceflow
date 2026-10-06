package com.serviceflow.app.features.camera

import java.util.Locale
import kotlin.math.abs

/**
 * Zoom as people see it: `.5x`, `1x`, `2x`, where 1× is the wide lens. CameraX
 * ratios are already relative to the wide lens; a phone with an ultra-wide
 * reports a minimum below 1 (often 0.5–0.6).
 */
data class CameraZoom(
    val info: CameraDeviceInfo? = null,
    /** The camera's zoom ratio. */
    val raw: Float = 1f,
) {
    val rawPerDisplay: Float get() = info?.rawPerDisplay ?: 1f
    val display: Float get() = raw / maxOf(rawPerDisplay, 0.01f)

    /**
     * Steps this lens can reach; 1× is always offered. `.5x` is offered when
     * there's an ultra-wide, and goes as wide as it reaches.
     */
    val availableSteps: List<Float>
        get() {
            val info = info ?: return listOf(1f)
            return STEPS.filter { step ->
                when {
                    step == 1f -> true
                    step < 1f -> info.minZoom < 0.95f * info.rawPerDisplay
                    else -> step * info.rawPerDisplay <= info.maxZoom + 0.001f
                }
            }
        }

    /** The step closest to the current zoom. */
    val activeStep: Float get() = availableSteps.minByOrNull { abs(it - display) } ?: 1f

    fun raw(step: Float): Float = step * rawPerDisplay

    /** `.5x`, `1x`, `2x`; the active step shows the live value while pinching (`1.4x`). */
    fun label(step: Float): String {
        if (step == activeStep && abs(step - display) > 0.05f) {
            val value = String.format(Locale.US, "%.1f", display)
            return (if (value.startsWith("0")) value.drop(1) else value) + "x"
        }
        return if (step == 0.5f) ".5x" else "${step.toInt()}x"
    }

    companion object {
        val STEPS = listOf(0.5f, 1f, 2f)
    }
}
