import Observation
import ServiceFlowCore
import Supabase
import SwiftUI

/// Everything that belongs to the signed-in person. Created at sign-in and
/// discarded at sign-out, so nothing leaks from one account to the next.
@MainActor
@Observable
final class SessionContext {
    private struct Profile: Codable {
        var fullName: String?
        var email: String?
    }

    /// One-time prompts and answers, remembered per person.
    private enum Flag {
        static let askedNotifications = "askedNotifications"
        static let activeCompany = "activeCompany"
        static func answeredOverBudget(_ jobId: String) -> String { "overBudget:\(jobId)" }
    }

    let user: CrewMember
    let accountCreatedAt: Date
    let api: ServiceFlowAPI
    let config: AppConfig
    let storage: UserStorage
    let tracker: TimeTracker
    /// Nil when the build has no media Worker configured.
    let uploads: MediaUploadQueue?
    let mediaClient: MediaClient?
    let notifications: NotificationService
    let location: LocationService

    private(set) var memberships: [CompanyMembership]
    /// The company being shown; a person invited by several switches in More.
    private(set) var activeCompanyId: String?
    /// Changes when the company changes, so every screen reloads for it.
    private(set) var companyGeneration = 0
    /// Scheduled and active jobs with coordinates, for the map and on-site checks.
    private(set) var mappedProjects: [Project] = []
    private(set) var assignedJobIds: [String] = []
    private(set) var locationAuthorization: LocationAuthorization

    /// Navigation: the selected tab and each tab's navigation stack.
    var activeTab: MainTab = .clock
    var paths: [MainTab: NavigationPath] = [:]

    @ObservationIgnored private var loops: [Task<Void, Never>] = []
    @ObservationIgnored private let membershipStore: JSONFileStore<[CompanyMembership]>
    @ObservationIgnored private let flagsStore: JSONFileStore<[String: String]>
    @ObservationIgnored private var started = false

    init(user authUser: User, api: ServiceFlowAPI, config: AppConfig, notifications: NotificationService, location: LocationService) {
        let userId = authUser.id.uuidString.lowercased()
        let storage = UserStorage(userId: userId, root: UserStorage.defaultRoot())
        let profileStore: JSONFileStore<Profile> = storage.store("profile")
        let metadataName = authUser.userMetadata["full_name"]?.stringValue ?? authUser.userMetadata["name"]?.stringValue
        let name = DisplayName.resolve(profileName: profileStore.load()?.fullName, metadataName: metadataName, email: authUser.email)

        user = CrewMember(id: userId, email: authUser.email, name: name)
        accountCreatedAt = authUser.createdAt
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
        mediaClient = config.mediaURL.map { MediaClient(baseURL: $0, token: { [api] in try await api.accessToken() }) }
        uploads = mediaClient.map { Self.makeUploadQueue(client: $0, storage: storage, uploaderName: name, api: api) }

        connectPlatformCallbacks()
        Task { await self.refreshProfile(into: profileStore) }
    }

    private static func makeUploadQueue(client: MediaClient, storage: UserStorage, uploaderName: String,
                                        api: ServiceFlowAPI) -> MediaUploadQueue {
        let queue = MediaUploadQueue(client: client, storage: storage, uploaderName: uploaderName)
        // Notes and drawings go up right after the photo, through the same
        // save path as edits to existing photos.
        queue.saveDetails = { remote, item in
            _ = try await savePhotoEdits(
                api: api, projectId: item.projectId, mediaId: remote.id,
                description: item.note, annotations: item.annotations,
                expected: PhotoRevisions(details: item.savedDetailsRevision?.uuidString.lowercased(),
                                         annotations: item.savedAnnotationsRevision?.uuidString.lowercased()),
                next: (item.detailsRevision ?? UUID(), item.annotationsRevision ?? UUID())
            )
        }
        return queue
    }

    private func connectPlatformCallbacks() {
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
            self?.showClockIn()
        }
    }

    var displayName: String { user.name }

    var activeCompany: CompanyMembership? {
        memberships.first { $0.orgId == activeCompanyId } ?? memberships.first
    }

    /// Owners, admins and managers of the company being shown.
    var isManager: Bool { activeCompany?.isManager ?? false }

    // MARK: Lifecycle

    func start(memberships loaded: [CompanyMembership]) {
        // Offline, the last known memberships stay in place.
        if !loaded.isEmpty {
            memberships = loaded
            membershipStore.save(loaded)
        }
        let remembered = activeCompanyId ?? flag(Flag.activeCompany)
        activeCompanyId = memberships.contains { $0.orgId == remembered } ? remembered : memberships.first?.orgId
        api.activeOrgId = activeCompanyId
        guard !started else { return }
        started = true
        tracker.projects = mappedProjects
        Task { await refreshProjects() }
        Task { await notifications.registerForPushIfAuthorized() }
        didBecomeActive()
    }

    func stop() {
        stopLoops()
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
            await captureForegroundFix()
        }
    }

    func didEnterBackground() {
        stopLoops()
        location.stopWatching()
        // Finish pending uploads of time and location while iOS allows it.
        let task = UIApplication.shared.beginBackgroundTask(withName: "ServiceFlowSync")
        Task {
            await tracker.appDidEnterBackground()
            UIApplication.shared.endBackgroundTask(task)
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

    // MARK: Foreground loops

    private func startLoops() {
        guard loops.isEmpty else { return }
        loops = [
            repeating(every: 45) { [weak self] in await self?.tracker.refresh() },
            repeating(every: 60) { [weak self] in await self?.refreshAssignments() },
            repeating(every: TrackingConstants.foregroundHeartbeat) { [weak self] in await self?.captureForegroundFix() },
        ]
    }

    private func stopLoops() {
        loops.forEach { $0.cancel() }
        loops = []
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

    /// One fresh fix for the running shift (the heartbeat, and on returning to the app).
    private func captureForegroundFix() async {
        guard tracker.activeShift != nil, location.authorization.isAuthorized,
              let point = await location.currentPoint(timeout: TrackingConstants.clockInLocationTimeout) else { return }
        await tracker.handleForegroundFix(point)
    }

    // MARK: Data

    private func refreshProfile(into store: JSONFileStore<Profile>) async {
        guard let row = try? await api.profile(userId: user.id) else { return }
        store.save(Profile(fullName: row["full_name"]?.nonEmptyString, email: row["email"]?.nonEmptyString))
    }

    /// Shows another of the person's companies.
    func selectCompany(_ orgId: String) {
        guard orgId != activeCompany?.orgId, memberships.contains(where: { $0.orgId == orgId }) else { return }
        activeCompanyId = orgId
        api.activeOrgId = orgId
        setFlag(Flag.activeCompany, orgId)
        paths = [:]
        mappedProjects = []
        assignedJobIds = []
        companyGeneration += 1
        Task {
            await refreshProjects()
            await refreshAssignments()
        }
    }

    private func refreshProjects() async {
        guard let projects = try? await api.mappedProjects() else { return }
        mappedProjects = projects
        tracker.projects = projects
    }

    private func refreshAssignments() async {
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
        if flag(Flag.askedNotifications) == nil {
            setFlag(Flag.askedNotifications, "1")
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

    /// Hours over budget when the job went over and the person hasn't been
    /// asked about it yet; nil otherwise.
    func overBudgetHours(jobId: String) async -> Double? {
        guard flag(Flag.answeredOverBudget(jobId)) == nil,
              let progress = try? await api.budgets(jobIds: [jobId])[jobId],
              let percent = progress.percentUsed, let used = progress.hoursUsed, percent > 100, used > 0 else { return nil }
        return max(0, used - used * 100 / percent)
    }

    /// Records the answer (nil reason = skipped); asked once per job.
    func answerOverBudget(jobId: String, reason: String?, note: String?, hoursOver: Double) async {
        setFlag(Flag.answeredOverBudget(jobId), ISODate.string(Date()))
        guard let reason else { return }
        await tracker.submitOverBudgetReason(jobId: jobId, reason: reason, note: note, minutesOver: Int((hoursOver * 60).rounded()))
    }

    private func flag(_ key: String) -> String? { flagsStore.load()?[key] }

    private func setFlag(_ key: String, _ value: String) {
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
