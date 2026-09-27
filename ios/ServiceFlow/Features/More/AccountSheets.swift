import ServiceFlowCore
import SwiftUI

/// In-app account deletion (App Store guideline 5.1.1(v)).
struct DeleteAccountView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var onDeleted: () -> Void

    @State private var confirmation = ""
    @State private var error: String?
    @State private var deleting = false

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
                AuthError(message: error)
            }
            AuthPrimaryButton(title: "Delete Account", busy: deleting, enabled: confirmed, role: .destructive, action: delete)
        }
        .navigationTitle("Delete Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }.disabled(deleting)
            }
        }
        .interactiveDismissDisabled(deleting)
    }

    private func bullet(_ text: String) -> some View {
        Label(text, systemImage: "circle.fill")
            .labelStyle(BulletLabelStyle())
    }

    private func delete() {
        guard confirmed, let api = model.api else { return }
        deleting = true
        error = nil
        Task {
            do {
                switch try await api.deleteAccount() {
                case .deleted:
                    dismiss()
                    onDeleted()
                case .blocked(let message), .failed(let message):
                    error = message
                }
            } catch {
                self.error = (error as? BackendError)?.message ?? error.localizedDescription
            }
            deleting = false
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

/// Creates an invite code a crew member enters after signing up.
struct InviteCrewView: View {
    @Environment(SessionContext.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var companyId: String?
    @State private var role = "crew"
    @State private var code: String?
    @State private var expires: Date?
    @State private var error: String?
    @State private var creating = false

    private var managedCompanies: [CompanyMembership] { session.memberships.filter(\.isManager) }
    private var selectedCompany: CompanyMembership? {
        managedCompanies.first { $0.orgId == (companyId ?? managedCompanies.first?.orgId) }
    }
    private var canInviteAdmins: Bool { selectedCompany.map { $0.role == .owner || $0.role == .admin } ?? false }

    var body: some View {
        Form {
            Section {
                if managedCompanies.count > 1 {
                    Picker("Company", selection: Binding(get: { companyId ?? managedCompanies.first?.orgId ?? "" },
                                                         set: { companyId = $0 })) {
                        ForEach(managedCompanies) { Text($0.name).tag($0.orgId) }
                    }
                }
                Picker("Role", selection: $role) {
                    Text("Crew").tag("crew")
                    Text("Manager").tag("manager")
                    if canInviteAdmins { Text("Admin").tag("admin") }
                }
            } footer: {
                Text("They create a ServiceFlow account, then tap Join with an invite code.")
            }

            if let code {
                Section {
                    VStack(spacing: 6) {
                        Text(code)
                            .font(.system(size: 34, weight: .heavy, design: .rounded))
                            .tracking(4)
                            .textSelection(.enabled)
                        if let expires {
                            Text("Works once. Expires \(expires.formatted(date: .abbreviated, time: .omitted)).")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    ShareLink(item: shareText(code)) { Label("Share Code", systemImage: "square.and.arrow.up") }
                } header: {
                    Text("Invite code")
                }
            }

            Section {} footer: { AuthError(message: error) }

            AuthPrimaryButton(title: code == nil ? "Create Invite Code" : "Create Another Code", busy: creating,
                              enabled: !managedCompanies.isEmpty, action: create)
        }
        .navigationTitle("Invite Crew")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
        .tint(Palette.teal)
    }

    private func shareText(_ code: String) -> String {
        let company = selectedCompany?.name ?? "our company"
        return "Join \(company) on ServiceFlow: install the app, create an account, then enter invite code \(code)."
    }

    private func create() {
        guard let orgId = selectedCompany?.orgId else { return }
        creating = true
        error = nil
        Task {
            do {
                let result = try await session.api.createInvitation(role: role, email: nil, orgId: orgId)
                code = result["code"]?.nonEmptyString
                expires = result["expires_at"]?.dateValue
            } catch {
                self.error = (error as? BackendError)?.message ?? error.localizedDescription
            }
            creating = false
        }
    }
}
