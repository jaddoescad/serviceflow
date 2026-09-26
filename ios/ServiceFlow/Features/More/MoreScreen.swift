import ServiceFlowCore
import SwiftUI

struct MoreScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionContext.self) private var session
    @Environment(TimeTracker.self) private var tracker

    @State private var pendingChanges = 0
    @State private var confirmSignOut = false
    @State private var sheet: Sheet?

    enum Sheet: String, Identifiable {
        case invite, join, delete
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("SERVICEFLOW").text(11.5, .heavy, Palette.teal, tracking: 1.4).padding(.bottom, 3)
                Text("More").text(28, .black, Palette.ink, tracking: -0.6).padding(.bottom, 16)

                card {
                    label("Signed in as")
                    Text(session.displayName).text(16, .heavy, Palette.ink)
                    if let email = session.user.email {
                        Text(email).text(14, .semibold, Palette.muted).padding(.top, 2)
                    }
                }

                card {
                    label(session.memberships.count > 1 ? "Companies" : "Company")
                    ForEach(session.memberships) { membership in
                        HStack(alignment: .firstTextBaseline) {
                            Text(membership.name).text(16, .bold, Palette.ink)
                            Spacer()
                            Text(membership.role.label).text(12.5, .heavy, Palette.muted)
                        }
                        .padding(.top, membership.id == session.memberships.first?.id ? 0 : 8)
                    }
                    HStack(spacing: 16) {
                        if session.isManager {
                            smallButton("Invite crew", icon: "person.badge.plus") { sheet = .invite }
                        }
                        smallButton("Join another company", icon: "person.2") { sheet = .join }
                    }
                    .padding(.top, 12)
                }

                card { locationCard }

                Button {
                    if tracker.activeShift != nil { confirmSignOut = true } else { signOut() }
                } label: {
                    Text("Sign out").text(16, .black, .white).frame(maxWidth: .infinity, minHeight: 54)
                        .background(Palette.green, in: RoundedRectangle(cornerRadius: 18))
                }
                .buttonStyle(.pressable(opacity: 0.9))
                .padding(.top, 12)

                Button("Delete account") { sheet = .delete }
                    .font(.app(15, .heavy))
                    .foregroundStyle(Palette.red)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .padding(.top, 8)

                Text("ServiceFlow \(session.config.appVersion) (\(session.config.buildNumber))")
                    .text(12, .semibold, Palette.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
            .padding(24)
            .padding(.top, 12)
        }
        .background(Color.white)
        .task(id: tracker.activeShift?.localId) { pendingChanges = await tracker.pendingCommandCount() }
        .confirmationDialog("You're still clocked in", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Clock Out and Sign Out", role: .destructive) {
                Task {
                    await session.clockOut(reason: .manual)
                    signOut()
                }
            }
            Button("Sign Out, Stay Clocked In") { signOut() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your shift keeps running if you only sign out. It's saved on this phone and continues when you sign back in.")
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .invite: InviteCrewView()
            case .join:
                JoinCompanyView(onBack: { self.sheet = nil }, onJoined: {
                    Task {
                        await model.refreshAccount()
                        self.sheet = nil
                    }
                })
            case .delete: DeleteAccountView(onDeleted: { Task { await model.accountDeleted() } })
            }
        }
    }

    @ViewBuilder private var locationCard: some View {
        label("Location")
        HStack(spacing: 9) {
            Circle().fill(tracker.activeShift != nil ? Palette.teal : Palette.muted).frame(width: 10, height: 10)
            Text(locationTitle).text(15, .black, Palette.ink)
        }
        .padding(.bottom, 8)
        if let shift = tracker.activeShift {
            diagnostic("Last location: \(diagnosticTime(shift.lastLocation?.capturedAt))")
            diagnostic(session.locationAuthorization.isAuthorized ? "Location access: Active shifts only" : "Location access: Not enabled")
            diagnostic("Location updates while ServiceFlow is open.")
        } else {
            diagnostic("ServiceFlow records your location when you clock in, when you clock out, and while the app is open during a shift.")
        }
        if pendingChanges > 0 {
            diagnostic(pendingChanges == 1 ? "1 time change waiting to sync" : "\(pendingChanges) time changes waiting to sync")
        }
    }

    private var locationTitle: String {
        guard tracker.activeShift != nil else { return "Off while clocked out" }
        guard session.locationAuthorization.isAuthorized else { return "Not recorded for this shift" }
        switch tracker.locationStatus?.mode {
        case .painting?: return "On site"
        case .travel?: return "Away from job site"
        default: return "Waiting for location"
        }
    }

    private func diagnosticTime(_ date: Date?) -> String {
        guard let date else { return "Not received yet" }
        return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    private func signOut() {
        Task { await model.signOut() }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .bordered(18, background: Palette.surface)
            .padding(.bottom, 18)
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased()).text(11.5, .heavy, Palette.muted, tracking: 1.2).padding(.bottom, 6)
    }

    private func diagnostic(_ text: String) -> some View {
        Text(text).text(12.5, .semibold, Palette.muted).padding(.top, 4).fixedSize(horizontal: false, vertical: true)
    }

    private func smallButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon).font(.app(13.5, .heavy)).foregroundStyle(Palette.teal)
        }
        .buttonStyle(.pressable)
    }
}

extension CompanyMembership.Role {
    var label: String {
        switch self {
        case .owner: return "Owner"
        case .admin: return "Admin"
        case .manager: return "Manager"
        case .crew: return "Crew"
        }
    }
}
