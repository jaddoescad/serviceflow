import ServiceFlowCore
import SwiftUI

/// Shown to a signed-in person who doesn't belong to a company yet.
struct OnboardingView: View {
    enum Step: Hashable { case create, join }

    @Environment(AppModel.self) private var model
    @State private var showDelete = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    AuthLogo()
                } footer: {
                    Text("Track time, photos and job progress with your crew. Start by creating your company or joining one.")
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)

                Section {
                    NavigationLink(value: Step.create) {
                        choice("Create a company", detail: "For owners and managers. Invite your crew next.", icon: "building.2.fill")
                    }
                    NavigationLink(value: Step.join) {
                        choice("Join with an invite code", detail: "Your manager gives you an 8-character code.", icon: "person.badge.key.fill")
                    }
                }

                Section {
                    Button("Sign Out") { Task { await model.signOut() } }
                    Button("Delete Account", role: .destructive) { showDelete = true }
                }
            }
            .navigationTitle("Welcome")
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .create: CreateCompanyView()
                case .join: JoinCompanyView(onJoined: { Task { await model.refreshAccount() } })
                }
            }
        }
        .tint(AuthPalette.brand)
        .sheet(isPresented: $showDelete) {
            NavigationStack {
                DeleteAccountView(onDeleted: { Task { await model.accountDeleted() } })
            }
        }
    }

    private func choice(_ title: String, detail: String, icon: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: icon).foregroundStyle(AuthPalette.brand)
        }
        .padding(.vertical, 4)
    }
}

struct CreateCompanyView: View {
    @Environment(AppModel.self) private var model

    @State private var name = ""
    @State private var trade = ""
    @State private var error: String?
    @State private var loading = false

    static let trades = ["Painting", "Cleaning", "Landscaping", "Construction", "Electrical", "Plumbing", "HVAC",
                         "Roofing", "Flooring", "Handyman", "Other"]

    var body: some View {
        AuthForm(title: "New Company") {
            Section {
                AuthTextField(placeholder: "Company name", text: $name, content: .organizationName, capitalization: .words,
                              submitLabel: .done)
                Picker("Trade", selection: $trade) {
                    Text("Choose…").tag("")
                    ForEach(Self.trades, id: \.self) { Text($0).tag($0) }
                }
            } footer: {
                if let error { AuthError(message: error) } else { Text("You'll be the owner. You can change these details later.") }
            }
            AuthPrimaryButton(title: "Create Company", busy: loading, enabled: !loading, action: create)
        }
        .onChange(of: name) { _, _ in error = nil }
    }

    private func create() {
        if let problem = AccountValidation.companyName(name) {
            error = problem
            return
        }
        guard let api = model.api else { return }
        loading = true
        Task {
            do {
                _ = try await api.createCompany(name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                                                trade: trade.isEmpty ? nil : trade)
                await model.refreshAccount()
            } catch {
                self.error = (error as? BackendError)?.message ?? AuthMessage.from(error)
            }
            loading = false
        }
    }
}

struct JoinCompanyView: View {
    @Environment(AppModel.self) private var model
    var onJoined: () -> Void

    @State private var code = ""
    @State private var error: String?
    @State private var joined: String?
    @State private var loading = false

    var body: some View {
        AuthForm(title: "Join a Company") {
            Section {
                TextField("ABCD-EFGH", text: $code)
                    .font(.system(.title2, design: .rounded).weight(.semibold))
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .submitLabel(.join)
                    .onSubmit(join)
                    .onChange(of: code) { _, value in
                        let formatted = InviteCode.display(value)
                        if formatted != value { code = formatted }
                        error = nil
                    }
            } header: {
                Text("Enter the 8-character invite code from your manager.").textCase(nil)
            } footer: {
                if let error { AuthError(message: error) } else if let joined { Text("You joined \(joined).") }
            }
            AuthPrimaryButton(title: "Join Company", busy: loading, enabled: InviteCode.isComplete(code), action: join)
        }
    }

    private func join() {
        guard InviteCode.isComplete(code), !loading, let api = model.api else {
            error = "Enter the 8-character code from your invitation."
            return
        }
        loading = true
        Task {
            do {
                let result = try await api.acceptInvitation(code: InviteCode.normalize(code))
                joined = result["name"]?.nonEmptyString ?? "the company"
                onJoined()
            } catch {
                self.error = (error as? BackendError)?.message ?? AuthMessage.from(error)
            }
            loading = false
        }
    }
}
