import ServiceFlowCore
import SwiftUI

/// Shown to a signed-in person who doesn't belong to a company yet.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var showDelete = false
    @State private var checking = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    AuthLogo()
                } footer: {
                    Text("Track time, photos and job progress with your crew.")
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)

                Section {
                    NavigationLink(value: "create") {
                        choice("Create a company", detail: "For owners and managers. Invite your crew next.", icon: "building.2.fill")
                    }
                }

                Section {
                    Button {
                        checking = true
                        Task {
                            await model.refreshAccount()
                            checking = false
                        }
                    } label: {
                        HStack {
                            Text("Check Again")
                            if checking { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(checking)
                } header: {
                    Text("Joining your team?")
                } footer: {
                    Text("Ask your company to invite \(model.session?.user.email ?? "your email"). You'll join as soon as they do.")
                }

                Section {
                    Button("Sign Out") { Task { await model.signOut() } }
                    Button("Delete Account", role: .destructive) { showDelete = true }
                }
            }
            .navigationTitle("Welcome")
            .navigationDestination(for: String.self) { _ in CreateCompanyView() }
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
    @State private var request = RequestState()

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
                AuthFooter(error: request.error, hint: "You'll be the owner. You can change these details later.")
            }
            AuthPrimaryButton(title: "Create Company", busy: request.isRunning, enabled: true, action: create)
        }
        .onChange(of: name) { _, _ in request.error = nil }
    }

    private func create() {
        let companyName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = AccountValidation.companyName(companyName) {
            request.error = problem
            return
        }
        guard let api = model.api else { return }
        let chosenTrade = trade.isEmpty ? nil : trade
        request.run {
            _ = try await api.createCompany(name: companyName, trade: chosenTrade)
            await model.refreshAccount()
        }
    }
}
