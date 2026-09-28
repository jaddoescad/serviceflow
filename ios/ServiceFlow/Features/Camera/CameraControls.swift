import SwiftUI

// The camera's controls, drawn over the preview. White icons with a soft
// shadow so they stay readable on bright scenes.

private let recordRed = Color(hex: 0xd92d20)

private extension View {
    func cameraIconShadow() -> some View { shadow(color: .black.opacity(0.35), radius: 4) }
}

struct CameraCloseButton: View {
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white)
                .cameraIconShadow()
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .disabled(disabled)
        .accessibilityLabel("Close camera")
    }
}

/// Flip and flash, down the right edge.
struct CameraSideControls: View {
    let camera: CameraModel

    var body: some View {
        VStack(spacing: 22) {
            icon("arrow.triangle.2.circlepath", label: "Flip camera", enabled: camera.canFlip && !camera.isRecording, action: camera.flip)
            icon(flashSymbol, label: camera.flashOn ? "Turn flash off" : "Turn flash on",
                 enabled: camera.canUseFlash && !camera.isRecording, action: camera.toggleFlash)
        }
    }

    /// Video mode's flash is a torch, so it gets a flashlight icon.
    private var flashSymbol: String {
        switch camera.mode {
        case .photo: return camera.flashOn ? "bolt.fill" : "bolt.slash.fill"
        case .video: return camera.flashOn ? "flashlight.on.fill" : "flashlight.off.fill"
        }
    }

    private func icon(_ symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .cameraIconShadow()
                .frame(width: 48, height: 40)
                .contentShape(Rectangle())
                .contentTransition(.symbolEffect(.replace))
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

/// `.5x` / `1x` / `2x`, the current one as a white circle.
struct CameraZoomRail: View {
    let camera: CameraModel

    var body: some View {
        let zoom = camera.zoom
        VStack(spacing: 14) {
            ForEach(zoom.availableSteps.reversed(), id: \.self) { step in
                let active = step == zoom.activeStep
                Button { camera.zoom(to: step) } label: {
                    Text(zoom.label(for: step))
                        .font(.system(size: 13, weight: .bold).monospacedDigit())
                        .foregroundStyle(active ? .black : .white)
                        .shadow(color: active ? .clear : .black.opacity(0.4), radius: 3)
                        .frame(width: 34, height: 34)
                        .background(active ? Color.white : Color.clear, in: Circle())
                        .contentShape(Circle())
                }
                .accessibilityLabel("Zoom \(step == 0.5 ? "0.5" : String(Int(step)))x")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .animation(.easeOut(duration: 0.15), value: zoom.activeStep)
    }
}

/// Red timer while recording, then "Saving…" while the file is written.
struct CameraRecordingPill: View {
    let camera: CameraModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            let seconds = min(camera.recordingStartedAt.map { Int(context.date.timeIntervalSince($0)) } ?? 0, CameraModel.maxVideoSeconds)
            HStack(spacing: 7) {
                if camera.isFinalizing {
                    ProgressView().controlSize(.mini).tint(.white)
                    Text("Saving…")
                } else {
                    Circle().fill(Color.white).frame(width: 8, height: 8)
                    Text(String(format: "%02d:%02d", seconds / 60, seconds % 60))
                }
            }
            .font(.system(size: 15, weight: .bold).monospacedDigit())
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(recordRed, in: Capsule())
        }
        .accessibilityLabel("Recording")
    }
}

/// The shutter with the white Done pill to its right.
struct CameraShutterRow: View {
    let camera: CameraModel
    let closing: Bool
    let onShutter: () -> Void
    let onDone: () -> Void

    var body: some View {
        ZStack {
            Button(action: onShutter) { EmptyView() }
                .buttonStyle(CameraShutterStyle(mode: camera.mode, recording: camera.isRecording))
                .disabled(!camera.canShoot && !camera.isRecording)
                .accessibilityLabel(camera.isRecording ? "Stop recording" : (camera.mode == .video ? "Record video" : "Take photo"))

            Button(action: onDone) {
                Text("Done")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(width: 74, height: 46)
                    .background(Color.white, in: Capsule())
            }
            .buttonStyle(.pressable(opacity: 0.8))
            .disabled(closing || camera.isRecording)
            .opacity(camera.isRecording ? 0 : 1)
            .offset(x: 119)
            .accessibilityLabel("Done")
        }
    }
}

/// White ring: a white disc for photos, a red disc for video, a red square while recording.
private struct CameraShutterStyle: ButtonStyle {
    let mode: CameraMode
    let recording: Bool

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed && !recording
        ZStack {
            Circle().strokeBorder(Color.white, lineWidth: 4)
                .frame(width: CameraLayout.shutterDiameter, height: CameraLayout.shutterDiameter)
            if recording {
                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(recordRed).frame(width: 30, height: 30)
            } else {
                Circle()
                    .fill(mode == .photo ? Color.white : recordRed)
                    .frame(width: pressed ? 60 : 66, height: pressed ? 60 : 66)
            }
        }
        .frame(width: 84, height: 84)
        .contentShape(Circle())
        .animation(.easeOut(duration: 0.1), value: pressed)
        .animation(.spring(response: 0.25, dampingFraction: 0.8), value: recording)
        .animation(.easeOut(duration: 0.18), value: mode)
    }
}

/// Photo / Video. The labels slide so the selected one sits under the shutter.
struct CameraModeSwitcher: View {
    let camera: CameraModel
    let animation: Animation

    private static let labelWidth: CGFloat = 92

    var body: some View {
        HStack(spacing: 0) {
            label("Photo", mode: .photo)
            label("Video", mode: .video)
        }
        .offset(x: camera.mode == .photo ? Self.labelWidth / 2 : -Self.labelWidth / 2)
        .animation(animation, value: camera.mode)
        .opacity(camera.isRecording ? 0 : 1)
        .allowsHitTesting(!camera.isRecording)
    }

    private func label(_ title: String, mode: CameraMode) -> some View {
        let selected = camera.mode == mode
        return Button {
            withAnimation(animation) { camera.select(mode) }
        } label: {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(selected ? .black : .white)
                .padding(.horizontal, 16)
                .frame(height: 34)
                .background(selected ? Color.white : Color.clear, in: Capsule())
                .frame(width: Self.labelWidth)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title) mode")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The red banner for camera problems; "More" reveals technical details.
struct CameraNoticeBanner: View {
    let notice: CameraNotice
    let onDismiss: () -> Void
    @State private var expanded = false

    var body: some View {
        let expandable = notice.details != nil || notice.message.count > 80
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.white)
            VStack(alignment: .leading, spacing: 4) {
                Text(notice.message).font(.footnote.weight(.semibold)).foregroundStyle(.white)
                    .lineLimit(expanded ? nil : 2)
                if expanded, let details = notice.details {
                    Text(details).font(.caption2).foregroundStyle(.white.opacity(0.76)).textSelection(.enabled)
                }
            }
            Spacer(minLength: 0)
            if expandable {
                Button(expanded ? "Less" : "More") { expanded.toggle() }
                    .font(.caption.weight(.bold)).foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color(rgba: 160, 48, 36, 0.92), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 64)
        .onTapGesture(perform: onDismiss)
        .onChange(of: notice) { _, _ in expanded = false }
    }
}
