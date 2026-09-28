import SwiftUI

/// Where the camera's parts sit for the current mode, in full-screen points.
struct CameraLayout {
    let size: CGSize
    let insets: EdgeInsets
    let mode: CameraMode

    static let shutterDiameter: CGFloat = 80
    static let previewCornerRadius: CGFloat = 30

    /// The drawer's collapsed height, including the home-indicator area.
    var drawerCollapsed: CGFloat { 104 + insets.bottom }
    /// Almost the whole screen when pulled up.
    var drawerExpanded: CGFloat { size.height - 60 }

    var previewTop: CGFloat { insets.top + 10 }
    var modeCenterY: CGFloat { size.height - drawerCollapsed - 34 }
    var shutterCenterY: CGFloat { modeCenterY - 17 - 22 - Self.shutterDiameter / 2 }

    /// Photo: the preview ends above the shutter. Video: it runs behind the
    /// controls down to the drawer.
    var previewHeight: CGFloat {
        let bottom = mode == .photo ? photoPreviewBottom : size.height - drawerCollapsed + 30
        return max(200, bottom - previewTop)
    }

    /// Lower in video mode, where the preview is taller.
    var zoomCenterY: CGFloat {
        previewTop + (photoPreviewBottom - previewTop) * (mode == .photo ? 0.6 : 0.7)
    }

    /// Close button and the right-hand icon column start level with each other.
    var topControlsY: CGFloat { previewTop + 38 }

    private var photoPreviewBottom: CGFloat { shutterCenterY - Self.shutterDiameter / 2 - 16 }
}
