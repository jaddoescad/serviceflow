import Observation
import ServiceFlowCore
import Supabase
import SwiftUI

/// Root state: who is signed in and which top-level screen shows.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case booting
        case signedOut
        /// Signed in but not a member of any company yet.
        case onboarding
        case maintenance
        case main
        case misconfigured
    }

    private(set) var phase: Phase = .booting
    private(set) var session: SessionContext?
    /// Set while a sign-up flow still has to choose a password; keeps the
    /// auth screens up after the email code signs the person in.
    var holdAuthFlow = false

    let api: ServiceFlowAPI?
    let config: AppConfig?
    let notifications = NotificationService()
    let location = LocationService()
    @ObservationIgnored private var authTask: Task<Void, Never>?
    @ObservationIgnored private var currentUserId: String?

    init() {
        config = AppConfig.current
        api = config.map(ServiceFlowAPI.init(config:))
        guard api != nil else {
            phase = .misconfigured
            return
        }
        authTask = Task { [weak self] in await self?.watchAuth() }
    }

    private func watchAuth() async {
        guard let api else { return }
        for await (event, authSession) in api.client.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .userUpdated:
                // A stored session opens the app offline; an expired one is
                // refreshed in the background, and a failed refresh signs out.
                if let authSession {
                    await signedIn(authSession.user)
                } else {
                    await signedOut()
                }
            case .signedOut, .userDeleted:
                await signedOut()
            default:
                break
            }
        }
    }

    private func signedIn(_ user: User) async {
        guard let api, let config else { return }
        let userId = user.id.uuidString.lowercased()
        // Token refreshes also arrive here; only a different person gets a new session.
        if currentUserId != userId {
            session?.stop()
            currentUserId = userId
            session = SessionContext(user: user, api: api, config: config, notifications: notifications, location: location)
        }
        await refreshAccount()
    }

    private func signedOut() async {
        session?.stop()
        session = nil
        currentUserId = nil
        holdAuthFlow = false
        phase = .signedOut
    }

    /// Reloads memberships and the maintenance flag, and picks the screen.
    func refreshAccount() async {
        guard let api, let session else { return }
        guard !holdAuthFlow else {
            phase = .signedOut
            return
        }
        async let maintenance = api.maintenanceMode()
        // Companies that invited this email are joined before anything loads.
        _ = try? await api.acceptMyInvitations()
        // Nil when offline: carry on with the memberships cached on the device.
        let loaded = try? await api.memberships(userId: session.user.id)
        if await maintenance {
            phase = .maintenance
        } else if loaded?.isEmpty == true {
            phase = .onboarding
        } else {
            phase = .main
            session.start(memberships: loaded ?? [])
        }
    }

    /// Called once the sign-up flow has set a password.
    func finishAuthFlow() async {
        holdAuthFlow = false
        await refreshAccount()
    }

    func signOut() async {
        if let session { await session.prepareForSignOut() }
        await api?.signOut()
        await signedOut()
    }

    func accountDeleted() async {
        if let session { await session.eraseLocalData() }
        await api?.signOut()
        await signedOut()
    }

    // MARK: Scene lifecycle

    func scenePhaseChanged(_ phase: ScenePhase) {
        guard let session, self.phase == .main else { return }
        switch phase {
        case .active: session.didBecomeActive()
        case .background: session.didEnterBackground()
        default: break
        }
    }
}
