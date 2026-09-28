import SwiftUI

/// Covers the preview until the first live frame: the last frame blurred
/// (like the system camera refocusing), or a Retry button if it failed.
struct CameraPreviewPlaceholder: View {
    let camera: CameraModel

    var body: some View {
        VStack(spacing: 12) {
            if camera.previewFailed {
                Image(systemName: "camera").font(.system(size: 26)).foregroundStyle(.white)
                Text("Camera preview unavailable").font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                Button("Retry Camera", action: camera.retryPreview)
                    .buttonStyle(.borderedProminent)
                    .tint(.white)
                    .foregroundStyle(.black)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            if let frame = camera.frozenFrame, !camera.previewFailed {
                Image(uiImage: frame).resizable().scaledToFill().blur(radius: 22, opaque: true).clipped()
            } else {
                Color.black
            }
        }
        .allowsHitTesting(camera.previewFailed)
    }
}

/// Shown instead of the preview until camera access is allowed. The system
/// prompt comes first; Settings is offered only once it was declined.
struct CameraPermissionCard: View {
    let permission: CameraPermission
    let onAllow: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill").font(.system(size: 38)).foregroundStyle(.white)
            Text("Camera access needed").font(.title3.weight(.bold)).foregroundStyle(.white)
            Text("ServiceFlow needs camera access to capture project photos and videos.")
                .font(.subheadline).foregroundStyle(.white.opacity(0.72)).multilineTextAlignment(.center)
            Button(permission == .notDetermined ? "Allow Camera" : "Open Settings") {
                if permission == .notDetermined {
                    onAllow()
                } else if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundStyle(.black)
            .padding(.top, 8)
        }
        .padding(.horizontal, 36)
    }
}

struct CameraUnavailableView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "camera").font(.system(size: 36)).foregroundStyle(.white)
            Text("No camera is available on this device.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.8))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
