import ServiceFlowCore
import SwiftUI

/// The signed-in app: the system tab bar with one navigation stack per tab.
/// Tabs keep their state while you switch between them.
struct MainShell: View {
    @Environment(SessionContext.self) private var session

    var body: some View {
        @Bindable var session = session
        TabView(selection: $session.activeTab) {
            tab(.clock) { ClockInScreen(enabled: isEnabled(.clock)) }
            tab(.projects) { JobsScreen(enabled: isEnabled(.projects)) }
            tab(.timesheet) { TimesheetScreen() }
            if session.canViewTeamMap {
                tab(.teamMap) { TeamMapScreen(enabled: isEnabled(.teamMap)) }
            }
            tab(.more) { MoreScreen() }
        }
        .tint(Palette.green)
        .onChange(of: session.canViewTeamMap) { _, canView in
            if !canView, session.activeTab == .teamMap { session.activeTab = .clock }
        }
    }

    private func isEnabled(_ tab: MainTab) -> Bool {
        session.activeTab == tab && (session.paths[tab]?.isEmpty ?? true)
    }

    private func tab<Content: View>(_ tab: MainTab, @ViewBuilder content: () -> Content) -> some View {
        stack(tab, content: content)
            .tabItem { Label(tab.title, systemImage: tab.icon) }
            .tag(tab)
    }

    private func stack<Content: View>(_ tab: MainTab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: Binding(
            get: { session.paths[tab] ?? NavigationPath() },
            set: { session.paths[tab] = $0 }
        )) {
            content()
                .navigationDestination(for: ProjectRoute.self) { route in
                    ProjectDetailScreen(route: route)
                }
        }
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

extension SessionContext {
    /// Pushes Project Detail on the current tab.
    func open(_ project: Project, action: ProjectRoute.Action? = nil) {
        var path = paths[activeTab] ?? NavigationPath()
        path.append(ProjectRoute(project: project, action: action))
        paths[activeTab] = path
    }

    /// Shows the Clock In tab at its root.
    func showClockIn() {
        paths = [:]
        activeTab = .clock
    }
}
