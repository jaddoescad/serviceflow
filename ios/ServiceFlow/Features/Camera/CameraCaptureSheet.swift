import ServiceFlowCore
import SwiftUI

/// The white drawer at the bottom of the camera: this opening's captures,
/// newest first, each with a note field, dictation and the photo editor.
/// It follows the finger and settles all the way down (grabber only), at one
/// row, or all the way up.
struct CameraCaptureSheet: View {
    let items: [PendingUpload]
    let collapsedHeight: CGFloat
    let expandedHeight: CGFloat
    let dictation: CameraDictation
    let onEdit: (PendingUpload) -> Void
    let onView: (PendingUpload) -> Void
    let onDictationBegin: () -> Void
    let onDictationEnd: () -> Void

    private enum Stop: CaseIterable { case minimized, peek, full }

    @State private var stop: Stop = .minimized
    @GestureState private var drag: CGFloat = 0

    private static let minimizedHeight: CGFloat = 34
    private static let settleAnimation = Animation.spring(response: 0.32, dampingFraction: 0.86)

    private func height(of stop: Stop) -> CGFloat {
        switch stop {
        case .minimized: return Self.minimizedHeight
        case .peek: return collapsedHeight
        case .full: return expandedHeight
        }
    }

    /// Follows the finger between the lowest and highest stop.
    private var height: CGFloat {
        min(expandedHeight, max(Self.minimizedHeight, height(of: stop) - drag))
    }

    var body: some View {
        VStack(spacing: 0) {
            grabber
            if items.isEmpty {
                Text("No shots yet")
                    .font(.subheadline)
                    .foregroundStyle(Color(hex: 0x6d7f7b))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                Spacer(minLength: 0)
            } else {
                list
            }
            if let error = dictation.error {
                Text(error).font(.footnote).foregroundStyle(Color(hex: 0xa5321f))
                    .padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height, alignment: .top)
        .clipped()
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 26, topTrailingRadius: 26, style: .continuous)
                .fill(Color(hex: 0xf6f7f6))
                .ignoresSafeArea(edges: .bottom)
        )
        // Anywhere on the drawer drags it, except while its list is scrollable.
        .gesture(stop == .full ? nil : dragGesture)
        .animation(.interactiveSpring(response: 0.28, dampingFraction: 0.86), value: drag)
        .onAppear { stop = items.isEmpty ? .minimized : .peek }
        .onChange(of: items.count) { old, new in
            // A new shot makes a pushed-down drawer peek so it can be noted.
            if new > old, stop == .minimized { settle(.peek) }
        }
    }

    private var grabber: some View {
        Capsule()
            .fill(Color(hex: 0xc8cccb))
            .frame(width: 40, height: 5)
            .frame(maxWidth: .infinity, minHeight: Self.minimizedHeight)
            .contentShape(Rectangle())
            .gesture(dragGesture)
            .onTapGesture { settle(stop == .full ? .peek : .full) }
            .accessibilityLabel(stop == .full ? "Collapse captures" : "Show all captures")
            .accessibilityAddTraits(.isButton)
    }

    private var list: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 14) {
                ForEach(items) { item in
                    CameraCaptureRow(item: item, dictation: dictation, onEdit: { onEdit(item) }, onView: { onView(item) },
                                     onDictationBegin: onDictationBegin, onDictationEnd: onDictationEnd)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollDisabled(stop != .full)
        .scrollDismissesKeyboard(.interactively)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .updating($drag) { value, state, _ in state = value.translation.height }
            .onEnded { value in
                // Settle at the stop nearest to where the flick would end.
                let projected = height(of: stop) - value.predictedEndTranslation.height
                let nearest = Stop.allCases.min { abs(height(of: $0) - projected) < abs(height(of: $1) - projected) }
                settle(nearest ?? stop)
            }
    }

    private func settle(_ target: Stop) {
        withAnimation(Self.settleAnimation) { stop = target }
    }
}
