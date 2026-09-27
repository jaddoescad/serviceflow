import ServiceFlowCore
import SwiftUI

/// The signed-in app: a custom tab bar over tab screens that all stay
/// mounted, so each keeps its scroll position and state. Project Detail is
/// pushed over the whole shell.
struct MainShell: View {
    @Environment(SessionContext.self) private var session

    private var tabs: [MainTab] {
        session.canViewTeamMap ? [.clock, .projects, .timesheet, .teamMap, .more] : [.clock, .projects, .timesheet, .more]
    }

    var body: some View {
        @Bindable var session = session
        NavigationStack(path: $session.path) {
            VStack(spacing: 0) {
                ZStack {
                    tab(.clock) { ClockInScreen(enabled: isEnabled(.clock)) }
                    tab(.projects) { JobsScreen(enabled: isEnabled(.projects)) }
                    tab(.timesheet) { TimesheetScreen() }
                    if session.canViewTeamMap {
                        tab(.teamMap) { TeamMapScreen(enabled: isEnabled(.teamMap)) }
                    }
                    tab(.more) { MoreScreen() }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                TabBar(tabs: tabs, active: $session.activeTab)
            }
            .background(Color.white)
            .ignoresSafeArea(.keyboard, edges: .bottom)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: ProjectRoute.self) { route in
                ProjectDetailScreen(route: route)
                    .toolbar(.hidden, for: .navigationBar)
            }
        }
        .onChange(of: session.canViewTeamMap) { _, canView in
            if !canView, session.activeTab == .teamMap { session.activeTab = .clock }
        }
    }

    private func isEnabled(_ tab: MainTab) -> Bool {
        session.activeTab == tab && session.path.isEmpty
    }

    private func tab<Content: View>(_ tab: MainTab, @ViewBuilder content: () -> Content) -> some View {
        let active = session.activeTab == tab
        return content()
            .opacity(active ? 1 : 0)
            .allowsHitTesting(active)
            .accessibilityHidden(!active)
    }
}

struct TabBar: View {
    var tabs: [MainTab]
    @Binding var active: MainTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.self) { tab in
                let selected = tab == active
                Button {
                    active = tab
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 22, weight: .medium))
                            .frame(height: 27)
                        Text(tab.title).font(.app(11, .bold)).tracking(0.1)
                    }
                    .foregroundStyle(selected ? Palette.green : Palette.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(.horizontal, 6)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(Color.white.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Palette.border).frame(height: 1) }
    }
}

extension MainTab {
    var title: String {
        switch self {
        case .clock: return "Clock In"
        case .projects: return "Jobs"
        case .timesheet: return "Timesheet"
        case .teamMap: return "Team Map"
        case .more: return "More"
        }
    }

    var icon: String {
        switch self {
        case .clock: return "clock"
        case .projects: return "folder.fill"
        case .timesheet: return "doc.text"
        case .teamMap: return "map"
        case .more: return "ellipsis"
        }
    }
}

/// Keeps the edge-swipe back gesture working with the navigation bar hidden.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}

extension SessionContext {
    /// Pushes Project Detail.
    func open(_ project: Project, action: ProjectRoute.Action? = nil) {
        path.append(ProjectRoute(project: project, action: action))
    }

    /// Shows the Clock In tab and pops back to it.
    func showClockIn() {
        activeTab = .clock
        path = []
    }
}
