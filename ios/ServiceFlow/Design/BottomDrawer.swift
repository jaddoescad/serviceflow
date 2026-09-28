import SwiftUI

/// Where a `BottomDrawer` rests.
enum DrawerStop: CaseIterable {
    /// Just the grabber and the header row.
    case collapsed
    /// About half the space.
    case middle
    /// Nearly the whole space.
    case expanded

    /// The next stop when the grabber is tapped.
    var next: DrawerStop {
        switch self {
        case .collapsed: return .middle
        case .middle: return .expanded
        case .expanded: return .collapsed
        }
    }
}

/// An Apple Maps–style drawer at the bottom of its container. It follows the
/// finger and settles at the nearest of three stops. The header always drags;
/// the content drags the drawer until it's fully open, then scrolls, and
/// pulling down from the top of the content lowers it again.
///
/// Place it in a container that ends above the tab bar (it never covers it).
/// On wide screens it becomes a card on the leading side, like Maps on iPad.
struct BottomDrawer<Header: View, Content: View>: View {
    @Binding var stop: DrawerStop
    /// Height of the collapsed drawer: grabber plus header.
    let collapsedHeight: CGFloat
    /// Height of the space the drawer lives in.
    let availableHeight: CGFloat
    @ViewBuilder let header: Header
    @ViewBuilder let content: Content

    /// Drag distance so far (positive is down).
    @State private var dragOffset: CGFloat = 0
    @State private var contentAtTop = true
    /// Whether the current content drag is moving the drawer rather than scrolling.
    @State private var contentDragsDrawer = false

    static var cornerRadius: CGFloat { 16 }
    private static var settleAnimation: Animation { .spring(response: 0.34, dampingFraction: 0.86) }
    private static var scrollSpace: String { "BottomDrawer.scroll" }

    /// Resting height at `stop` for a container of `availableHeight`.
    static func height(at stop: DrawerStop, collapsed: CGFloat, available: CGFloat) -> CGFloat {
        let top = max(collapsed, available - 12)
        switch stop {
        case .collapsed: return collapsed
        case .middle: return min(top, max(collapsed + 120, available * 0.46))
        case .expanded: return top
        }
    }

    private func height(at stop: DrawerStop) -> CGFloat {
        Self.height(at: stop, collapsed: collapsedHeight, available: availableHeight)
    }

    /// Follows the finger, with a little resistance past the first and last stop.
    private var currentHeight: CGFloat {
        let proposed = height(at: stop) - dragOffset
        let low = height(at: .collapsed), high = height(at: .expanded)
        if proposed < low { return low - Self.rubberBand(low - proposed) }
        if proposed > high { return high + Self.rubberBand(proposed - high) }
        return proposed
    }

    var body: some View {
        GeometryReader { geometry in
            let wide = geometry.size.width > 600
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    grabber
                    header
                }
                .contentShape(Rectangle())
                .gesture(headerDrag)

                ScrollView {
                    VStack(spacing: 0) {
                        topMarker
                        content
                    }
                }
                .coordinateSpace(name: Self.scrollSpace)
                .scrollDisabled(stop != .expanded)
                .scrollBounceBehavior(.basedOnSize)
                .simultaneousGesture(contentDrag)
            }
            .frame(width: wide ? min(500, geometry.size.width - 24) : geometry.size.width,
                   height: max(0, currentHeight), alignment: .top)
            .background(.regularMaterial, in: shape(wide: wide))
            .clipShape(shape(wide: wide))
            .shadow(color: .black.opacity(0.1), radius: 8, y: -2)
            .padding(.leading, wide ? 12 : 0)
            .padding(.bottom, wide ? 12 : 0)
            .frame(width: geometry.size.width, height: geometry.size.height,
                   alignment: wide ? .bottomLeading : .bottom)
        }
    }

    private func shape(wide: Bool) -> UnevenRoundedRectangle {
        let radius = Self.cornerRadius
        return UnevenRoundedRectangle(topLeadingRadius: radius, bottomLeadingRadius: wide ? radius : 0,
                                      bottomTrailingRadius: wide ? radius : 0, topTrailingRadius: radius,
                                      style: .continuous)
    }

    private var grabber: some View {
        Capsule()
            .fill(.secondary.opacity(0.45))
            .frame(width: 36, height: 5)
            .frame(maxWidth: .infinity, minHeight: 20)
            .contentShape(Rectangle())
            .onTapGesture { settle(stop.next) }
            .accessibilityLabel(stop == .expanded ? "Collapse panel" : "Expand panel")
            .accessibilityAddTraits(.isButton)
    }

    /// Reports whether the content is scrolled to its top.
    private var topMarker: some View {
        GeometryReader { marker in
            Color.clear.preference(key: DrawerTopOffsetKey.self, value: marker.frame(in: .named(Self.scrollSpace)).minY)
        }
        .frame(height: 0)
        .onPreferenceChange(DrawerTopOffsetKey.self) { contentAtTop = $0 >= -1 }
    }

    // MARK: Gestures

    // Measured on the screen: the drawer grows under the finger, so its own
    // coordinates would cancel the movement out.
    private var headerDrag: some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .global)
            .onChanged { dragOffset = $0.translation.height }
            .onEnded(finish)
    }

    /// Below the top stop the content drags the drawer; at the top stop it
    /// scrolls, except a downward pull when the list is already at its top.
    private var contentDrag: some Gesture {
        DragGesture(minimumDistance: 6, coordinateSpace: .global)
            .onChanged { value in
                if !contentDragsDrawer {
                    let vertical = abs(value.translation.height) > abs(value.translation.width)
                    contentDragsDrawer = vertical && (stop != .expanded || (contentAtTop && value.translation.height > 0))
                }
                if contentDragsDrawer { dragOffset = value.translation.height }
            }
            .onEnded { value in
                if contentDragsDrawer { finish(value) }
                contentDragsDrawer = false
            }
    }

    private func finish(_ value: DragGesture.Value) {
        let projected = height(at: stop) - value.predictedEndTranslation.height
        let nearest = DrawerStop.allCases.min { abs(height(at: $0) - projected) < abs(height(at: $1) - projected) } ?? stop
        settle(nearest)
    }

    private func settle(_ target: DrawerStop) {
        withAnimation(Self.settleAnimation) {
            stop = target
            dragOffset = 0
        }
    }

    private static func rubberBand(_ distance: CGFloat) -> CGFloat {
        40 * (1 - 1 / (distance / 120 + 1))
    }
}

private struct DrawerTopOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat { 0 }
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
