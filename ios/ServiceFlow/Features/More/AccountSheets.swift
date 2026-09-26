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
        AuthPage(showsLogo: false, onBack: { dismiss() }) {
            AuthTitle(title: "Delete your account", subtitle: nil)
            VStack(alignment: .leading, spacing: 10) {
                bullet("Your login is removed and you can't sign in again.")
                bullet("You leave every company you belong to, and your devices and location history are deleted.")
                bullet("Time entries and photos you recorded stay with your company for payroll and job records, shown as \u{201C}Deleted user\u{201D}.")
                bullet("If you're the last admin of a company with other members, make someone else an admin first.")
            }
            .padding(.bottom, 22)
            AuthLabel(text: "Type DELETE to confirm")
            AuthTextField(placeholder: "DELETE", text: $confirmation, capitalization: .characters, submitLabel: .done)
            AuthErrorSlot(message: error)
            Button(action: delete) {
                Text(deleting ? "Deleting..." : "Delete account")
                    .font(.app(17, .heavy)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(confirmed && !deleting ? Palette.red : Color(hex: 0xe3b5ab), in: RoundedRectangle(cornerRadius: 10))
            }
            .disabled(!confirmed || deleting)
        }
        .interactiveDismissDisabled(deleting)
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•").text(15, .heavy, AuthPalette.inkMuted)
            Text(text).text(15, .medium, AuthPalette.inkMuted).fixedSize(horizontal: false, vertical: true)
        }
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
    private var canInviteAdmins: Bool {
        managedCompanies.first { $0.orgId == (companyId ?? managedCompanies.first?.orgId) }.map { $0.role == .owner || $0.role == .admin } ?? false
    }

    var body: some View {
        AuthPage(showsLogo: false, onBack: { dismiss() }) {
            AuthTitle(title: "Invite your crew",
                      subtitle: "Share the code. They create a ServiceFlow account, then tap Join with an invite code.")
            if managedCompanies.count > 1 {
                AuthLabel(text: "Company")
                Picker("Company", selection: Binding(get: { companyId ?? managedCompanies.first?.orgId ?? "" }, set: { companyId = $0 })) {
                    ForEach(managedCompanies) { Text($0.name).tag($0.orgId) }
                }
                .pickerStyle(.menu)
                .padding(.bottom, 12)
            }
            AuthLabel(text: "Role")
            Picker("Role", selection: $role) {
                Text("Crew").tag("crew")
                Text("Manager").tag("manager")
                if canInviteAdmins { Text("Admin").tag("admin") }
            }
            .pickerStyle(.segmented)
            .padding(.bottom, 18)

            if let code {
                VStack(spacing: 8) {
                    Text(code).font(.system(size: 34, weight: .heavy, design: .rounded)).tracking(4).foregroundStyle(AuthPalette.ink)
                        .textSelection(.enabled)
                    if let expires {
                        Text("Works once. Expires \(expires.formatted(date: .abbreviated, time: .omitted)).")
                            .text(13, .semibold, AuthPalette.inkMuted)
                    }
                    ShareLink(item: shareText(code)) {
                        Label("Share code", systemImage: "square.and.arrow.up").font(.app(15, .heavy)).foregroundStyle(AuthPalette.brand)
                    }
                    .padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .bordered(12, border: AuthPalette.fieldBorder, background: Color(hex: 0xf0f8f6))
                .padding(.bottom, 14)
            }
            AuthErrorSlot(message: error)
            AuthPrimaryButton(title: code == nil ? "Create invite code" : "Create another code", busyTitle: "Creating...",
                              busy: creating, enabled: !managedCompanies.isEmpty, action: create)
        }
    }

    private func shareText(_ code: String) -> String {
        let company = managedCompanies.first { $0.orgId == (companyId ?? managedCompanies.first?.orgId) }?.name ?? "our company"
        return "Join \(company) on ServiceFlow: install the app, create an account, then enter invite code \(code)."
    }

    private func create() {
        guard let orgId = companyId ?? managedCompanies.first?.orgId else { return }
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
