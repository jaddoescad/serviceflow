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
        case invite, delete
        var id: String { rawValue }
    }

    var body: some View {
        List {
            Section("Signed in as") {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.displayName).font(.headline)
                    if let email = session.user.email {
                        Text(email).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
            }

            Section {
                if session.memberships.count > 1 {
                    // Invited by more than one company: pick the one to show.
                    Picker("Company", selection: Binding(
                        get: { session.activeCompany?.orgId ?? "" },
                        set: { session.selectCompany($0) }
                    )) {
                        ForEach(session.memberships) { membership in
                            Text(membership.name).tag(membership.orgId)
                        }
                    }
                } else if let company = session.activeCompany {
                    LabeledContent("Company", value: company.name)
                }
                if let company = session.activeCompany {
                    LabeledContent("Role", value: company.role.label)
                }
                if session.isManager {
                    Button { sheet = .invite } label: { Label("Invite Crew", systemImage: "person.badge.plus") }
                }
            } header: {
                Text("Company")
            }

            Section {
                LabeledContent("Status") {
                    HStack(spacing: 6) {
                        Circle().fill(tracker.activeShift != nil ? Palette.teal : Palette.muted).frame(width: 8, height: 8)
                        Text(locationTitle)
                    }
                }
                if let shift = tracker.activeShift {
                    LabeledContent("Last location", value: diagnosticTime(shift.lastLocation?.capturedAt))
                    LabeledContent("Access", value: session.locationAuthorization.isAuthorized ? "While using the app" : "Not allowed")
                }
                if pendingChanges > 0 {
                    LabeledContent("Waiting to sync", value: pendingChanges == 1 ? "1 time change" : "\(pendingChanges) time changes")
                }
            } header: {
                Text("Location")
            } footer: {
                Text("ServiceFlow records your location when you clock in, when you clock out, and while the app is open during a shift.")
            }

            Section {
                Button("Sign Out") {
                    if tracker.activeShift != nil { confirmSignOut = true } else { signOut() }
                }
                Button("Delete Account", role: .destructive) { sheet = .delete }
            } footer: {
                Text("ServiceFlow \(session.config.appVersion) (\(session.config.buildNumber))")
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
        }
        .navigationTitle("More")
        .tint(Palette.teal)
        .task(id: tracker.activeShift?.localId) { pendingChanges = await tracker.pendingCommandCount() }
        .refreshable {
            await model.refreshAccount()
            pendingChanges = await tracker.pendingCommandCount()
        }
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
            NavigationStack {
                switch sheet {
                case .invite:
                    InviteCrewView()
                case .delete:
                    DeleteAccountView(onDeleted: { Task { await model.accountDeleted() } })
                }
            }
            .environment(session)
        }
    }

    private var locationTitle: String {
        guard tracker.activeShift != nil else { return "Off while clocked out" }
        guard session.locationAuthorization.isAuthorized else { return "Not recorded" }
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
