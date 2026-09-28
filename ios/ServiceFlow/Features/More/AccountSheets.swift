import ServiceFlowCore
import SwiftUI

/// In-app account deletion (App Store guideline 5.1.1(v)).
struct DeleteAccountView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var onDeleted: () -> Void

    @State private var confirmation = ""
    @State private var request = RequestState()

    private var confirmed: Bool { confirmation.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE" }

    var body: some View {
        Form {
            Section {
                bullet("Your login is removed and you can't sign in again.")
                bullet("You leave every company you belong to, and your devices and location history are deleted.")
                bullet("Time entries and photos you recorded stay with your company for payroll and job records, shown as \u{201C}Deleted user\u{201D}.")
                bullet("If you're the last admin of a company with other members, make someone else an admin first.")
            } header: {
                Text("What happens")
            }
            Section {
                TextField("DELETE", text: $confirmation)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            } header: {
                Text("Type DELETE to confirm")
            } footer: {
                AuthErrorText(message: request.error)
            }
            AuthPrimaryButton(title: "Delete Account", busy: request.isRunning, enabled: confirmed, role: .destructive, action: delete)
        }
        .navigationTitle("Delete Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }.disabled(request.isRunning)
            }
        }
        .interactiveDismissDisabled(request.isRunning)
    }

    private func bullet(_ text: String) -> some View {
        Label(text, systemImage: "circle.fill")
            .labelStyle(BulletLabelStyle())
    }

    private func delete() {
        guard confirmed, let api = model.api else { return }
        request.run {
            switch try await api.deleteAccount() {
            case .deleted:
                dismiss()
                onDeleted()
            case .blocked(let message), .failed(let message):
                request.error = message
            }
        }
    }
}

private struct BulletLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            configuration.icon.font(.system(size: 6)).foregroundStyle(.secondary)
            configuration.title.font(.subheadline)
        }
    }
}

/// Invites people to the company by email. They join automatically the next
/// time they sign in to ServiceFlow with that address.
struct InviteCrewView: View {
    @Environment(SessionContext.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var role: CompanyMembership.Role = .crew
    @State private var invited: PendingInvitation?
    @State private var pending: [PendingInvitation] = []
    @State private var request = RequestState()

    private var company: CompanyMembership? { session.activeCompany }
    private var canInviteAdmins: Bool { company.map { $0.role == .owner || $0.role == .admin } ?? false }

    var body: some View {
        Form {
            Section {
                TextField("Email address", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .onSubmit(invite)
                Picker("Role", selection: $role) {
                    Text("Crew").tag(CompanyMembership.Role.crew)
                    Text("Manager").tag(CompanyMembership.Role.manager)
                    if canInviteAdmins { Text("Admin").tag(CompanyMembership.Role.admin) }
                }
            } footer: {
                AuthFooter(error: request.error,
                           hint: "They join \(company?.name ?? "your company") when they sign in to ServiceFlow with this email.")
            }

            AuthPrimaryButton(title: "Send Invite", busy: request.isRunning,
                              enabled: AccountValidation.email(email) == nil, action: invite)

            if let invited {
                Section {
                    ShareLink(item: shareText(for: invited)) {
                        Label("Let \(invited.email) Know", systemImage: "square.and.arrow.up")
                    }
                } footer: {
                    Text("Invited \(invited.email). Send them a message so they know to install ServiceFlow.")
                }
            }

            if !pending.isEmpty {
                Section("Waiting to join") {
                    ForEach(pending) { invitation in
                        LabeledContent(invitation.email, value: invitation.role.label)
                            .swipeActions {
                                Button("Cancel Invite", role: .destructive) { revoke(invitation) }
                            }
                    }
                }
            }
        }
        .navigationTitle("Invite Crew")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
        .tint(Palette.teal)
        .task { await loadPending() }
        .onChange(of: email) { _, _ in request.error = nil }
    }

    private func shareText(for invitation: PendingInvitation) -> String {
        "You're invited to join \(company?.name ?? "our company") on ServiceFlow. Install the app and sign in with \(invitation.email)."
    }

    private func invite() {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let problem = AccountValidation.email(address) {
            request.error = problem
            return
        }
        guard let orgId = company?.orgId else { return }
        let api = session.api
        let role = role
        request.run {
            let result = try await api.invite(email: address, role: role, orgId: orgId)
            invited = PendingInvitation(row: result)
            email = ""
            await loadPending()
        }
    }

    private func revoke(_ invitation: PendingInvitation) {
        let api = session.api
        request.run {
            try await api.revokeInvitation(id: invitation.id)
            await loadPending()
        }
    }

    private func loadPending() async {
        guard let orgId = company?.orgId else { return }
        if let list = try? await session.api.pendingInvitations(orgId: orgId) { pending = list }
    }
}
