import ServiceFlowCore

enum MainTab: String, CaseIterable, Hashable {
    case clock, projects, timesheet, more
}

/// A pushed Project Detail.
struct ProjectRoute: Hashable {
    enum Action: Hashable { case photos, camera }
    var project: Project
    var action: Action?
}
