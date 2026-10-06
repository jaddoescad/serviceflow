package com.serviceflow.app.features.camera

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Where the camera's parts sit for the current mode, in full-screen dp. */
class CameraLayout(
    val width: Dp,
    val height: Dp,
    val insetTop: Dp,
    val insetBottom: Dp,
    val mode: CameraMode,
) {
    /** The drawer's collapsed height, including the navigation-bar area. */
    val drawerCollapsed: Dp get() = 104.dp + insetBottom
    /** Almost the whole screen when pulled up. */
    val drawerExpanded: Dp get() = height - 60.dp

    val previewTop: Dp get() = insetTop + 10.dp
    val modeCenterY: Dp get() = height - drawerCollapsed - 34.dp
    val shutterCenterY: Dp get() = modeCenterY - 17.dp - 22.dp - SHUTTER_DIAMETER / 2

    /** Photo: the preview ends above the shutter. Video: it runs behind the controls down to the drawer. */
    val previewHeight: Dp
        get() {
            val bottom = if (mode == CameraMode.Photo) photoPreviewBottom else height - drawerCollapsed + 30.dp
            return maxOf(200.dp, bottom - previewTop)
        }

    /** Lower in video mode, where the preview is taller. */
    val zoomCenterY: Dp
        get() = previewTop + (photoPreviewBottom - previewTop) * (if (mode == CameraMode.Photo) 0.6f else 0.7f)

    /** Close button and the right-hand icon column start level with each other. */
    val topControlsY: Dp get() = previewTop + 38.dp

    private val photoPreviewBottom: Dp get() = shutterCenterY - SHUTTER_DIAMETER / 2 - 16.dp

    companion object {
        val SHUTTER_DIAMETER = 80.dp
        val PREVIEW_CORNER_RADIUS = 30.dp
    }
}
