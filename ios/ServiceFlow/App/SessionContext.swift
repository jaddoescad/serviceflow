import Observation
import ServiceFlowCore
import Supabase
import SwiftUI

/// Everything that belongs to the signed-in person. Created at sign-in and
/// discarded at sign-out, so nothing leaks from one account to the next.
@MainActor
@Observable
final class SessionContext {
    struct Profile: Codable {
        var fullName: String?
        var email: String?
    }

    let user: CrewMember
    let api: ServiceFlowAPI
    let config: AppConfig
    let storage: UserStorage
    let tracker: TimeTracker
    let uploads: MediaUploadQueue?
    let mediaClient: MediaClient?
    let notifications: NotificationService
    let location: LocationService

    private(set) var memberships: [CompanyMembership]
    /// Scheduled and active jobs with coordinates, for the map and on-site checks.
    private(set) var mappedProjects: [Project] = []
    private(set) var assignedJobIds: [String] = []
    private(set) var locationAuthorization: LocationAuthorization

    /// Navigation shared by the tabs.
    var activeTab: MainTab = .clock
    var path: [ProjectRoute] = []

    @ObservationIgnored private var loops: [Task<Void, Never>] = []
    @ObservationIgnored private let membershipStore: JSONFileStore<[CompanyMembership]>
    @ObservationIgnored private let flagsStore: JSONFileStore<[String: String]>
    @ObservationIgnored private var started = false

    init(user authUser: User, api: ServiceFlowAPI, config: AppConfig, notifications: NotificationService, location: LocationService) {
        let userId = authUser.id.uuidString.lowercased()
        let metadataName = authUser.userMetadata["full_name"]?.stringValue ?? authUser.userMetadata["name"]?.stringValue
        let storage = UserStorage(userId: userId, root: UserStorage.defaultRoot())
        let profileStore: JSONFileStore<Profile> = storage.store("profile")
        let profile = profileStore.load()
        let name = DisplayName.resolve(profileName: profile?.fullName, metadataName: metadataName, email: authUser.email)
        user = CrewMember(id: userId, email: authUser.email, name: name)
        self.api = api
        self.config = config
        self.storage = storage
        self.notifications = notifications
        self.location = location
        locationAuthorization = location.authorization
        membershipStore = storage.store("memberships")
        flagsStore = storage.store("flags")
        memberships = membershipStore.load() ?? []

        tracker = TimeTracker(
            user: user, storage: storage, backend: api, location: location, reminders: notifications,
            appVersion: config.appVersion, uploadsLocation: config.locationTrackingEnabled
        )
        if let mediaURL = config.mediaURL {
            let client = MediaClient(baseURL: mediaURL, token: { [api] in try await api.accessToken() })
            mediaClient = client
            uploads = MediaUploadQueue(client: client, storage: storage, uploaderName: name)
        } else {
            mediaClient = nil
            uploads = nil
        }

        location.onFix = { [weak self] point in
            Task { await self?.tracker.handleForegroundFix(point) }
        }
        location.onAuthorizationChange = { [weak self] status in
            Task { @MainActor in
                self?.locationAuthorization = status
                self?.updateWatching()
            }
        }
        notifications.onClockOutAction = { [weak self] in
            Task { await self?.tracker.clockOut(reason: .notification) }
        }
        notifications.onReminderTap = { [weak self] _ in
            self?.activeTab = .clock
            self?.path = []
        }
        Task { await self.loadProfile(profileStore: profileStore) }
    }

    var displayName: String { user.name }

    /// Owners, admins and managers of any of the person's companies.
    var isManager: Bool { memberships.contains(where: \.isManager) }
    var canViewTeamMap: Bool { isManager && config.locationTrackingEnabled }
    var companyName: String? { memberships.first?.name }

    // MARK: Lifecycle

    func start(memberships loaded: [CompanyMembership]) {
        if !loaded.isEmpty {
            memberships = loaded
            membershipStore.save(loaded)
        }
        guard !started else { return }
        started = true
        tracker.projects = mappedProjects
        Task { await refreshProjects() }
        Task { await notifications.registerForPushIfAuthorized() }
        didBecomeActive()
    }

    func stop() {
        loops.forEach { $0.cancel() }
        loops = []
        location.stopWatching()
        location.onFix = nil
        location.onAuthorizationChange = nil
        notifications.onClockOutAction = nil
        notifications.onReminderTap = nil
    }

    func didBecomeActive() {
        locationAuthorization = location.authorization
        startLoops()
        updateWatching()
        uploads?.resume()
        Task {
            await tracker.appDidBecomeActive()
            await refreshAssignments()
            if tracker.activeShift != nil, location.authorization.isAuthorized,
               let point = await location.currentPoint(timeout: TrackingConstants.clockInLocationTimeout) {
                await tracker.handleForegroundFix(point)
            }
        }
    }

    func didEnterBackground() {
        loops.forEach { $0.cancel() }
        loops = []
        location.stopWatching()
        // Finish pending uploads of time and location while iOS allows it.
        let task = UIApplication.shared.beginBackgroundTask(withName: "ServiceFlowSync")
        Task {
            await tracker.appDidEnterBackground()
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    private func startLoops() {
        guard loops.isEmpty else { return }
        loops = [
            repeating(every: 45) { [weak self] in await self?.tracker.refresh() },
            repeating(every: 60) { [weak self] in await self?.refreshAssignments() },
            repeating(every: TrackingConstants.foregroundHeartbeat) { [weak self] in
                guard let self, self.tracker.activeShift != nil, self.location.authorization.isAuthorized,
                      let point = await self.location.currentPoint(timeout: TrackingConstants.clockInLocationTimeout) else { return }
                await self.tracker.handleForegroundFix(point)
            },
        ]
    }

    private func repeating(every seconds: TimeInterval, _ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await work()
            }
        }
    }

    /// Foreground location updates run only during a shift.
    func updateWatching() {
        if tracker.activeShift != nil, UIApplication.shared.applicationState == .active {
            location.startWatching()
        } else {
            location.stopWatching()
        }
    }

    // MARK: Data

    private func loadProfile(profileStore: JSONFileStore<Profile>) async {
        guard let row = try? await api.profile(userId: user.id) else { return }
        profileStore.save(Profile(fullName: row["full_name"]?.nonEmptyString, email: row["email"]?.nonEmptyString))
    }

    func refreshProjects() async {
        guard let projects = try? await api.mappedProjects() else { return }
        mappedProjects = projects
        tracker.projects = projects
    }

    func refreshAssignments() async {
        if let ids = try? await api.assignedJobIds(userId: user.id) { assignedJobIds = ids }
    }

    // MARK: Clocking from the UI

    /// Clock in from a button; asks for notification permission once after
    /// the first successful clock-in so shift reminders can be delivered.
    @discardableResult
    func clockIn(_ project: Project) async throws -> TimeEntry {
        let shift = try await tracker.clockIn(project)
        locationAuthorization = location.authorization
        updateWatching()
        if flag("askedNotifications") == nil {
            setFlag("askedNotifications", "1")
            _ = await notifications.requestIfUndetermined()
        }
        return shift
    }

    @discardableResult
    func switchProject(to project: Project) async throws -> TimeEntry? {
        let shift = try await tracker.switchProject(to: project)
        updateWatching()
        return shift
    }

    @discardableResult
    func clockOut(reason: ClockOutReason) async -> TimeEntry? {
        let entry = await tracker.clockOut(reason: reason)
        updateWatching()
        return entry
    }

    // MARK: Over-budget prompt

    /// The job went over budget and the person hasn't been asked about it yet.
    func overBudgetHours(jobId: String) async -> Double? {
        guard flag("overBudget:\(jobId)") == nil,
              let progress = try? await api.budgets(jobIds: [jobId])[jobId],
              let percent = progress.percentUsed, let used = progress.hoursUsed, percent > 100, used > 0 else { return nil }
        return max(0, used - used * 100 / percent)
    }

    func answerOverBudget(jobId: String, reason: String?, note: String?, hoursOver: Double) async {
        setFlag("overBudget:\(jobId)", ISODate.string(Date()))
        guard let reason else { return }
        await tracker.submitOverBudgetReason(jobId: jobId, reason: reason, note: note, minutesOver: Int((hoursOver * 60).rounded()))
    }

    // MARK: Flags

    func flag(_ key: String) -> String? { flagsStore.load()?[key] }

    func setFlag(_ key: String, _ value: String) {
        var flags = flagsStore.load() ?? [:]
        flags[key] = value
        flagsStore.save(flags)
    }

    // MARK: Sign-out

    func prepareForSignOut() async {
        await tracker.flushCommands()
        await tracker.syncLocations()
        stop()
    }

    func eraseLocalData() async {
        stop()
        await tracker.eraseLocalData()
        storage.removeAll()
    }
}

enum MainTab: String, CaseIterable, Hashable {
    case clock, projects, timesheet, teamMap, more
}

/// A pushed Project Detail.
struct ProjectRoute: Hashable {
    enum Action: Hashable { case photos, camera }
    var project: Project
    var action: Action?
}
