import ServiceFlowCore
import SwiftUI

/// Shown to a signed-in person who doesn't belong to a company yet.
struct OnboardingView: View {
    enum Step { case choose, create, join }

    @Environment(AppModel.self) private var model
    @State private var step: Step = .choose
    @State private var showDelete = false

    var body: some View {
        Group {
            switch step {
            case .choose: choose
            case .create: CreateCompanyView(onBack: { step = .choose })
            case .join: JoinCompanyView(onBack: { step = .choose }, onJoined: { Task { await model.refreshAccount() } })
            }
        }
        .animation(.easeInOut(duration: 0.2), value: step)
        .sheet(isPresented: $showDelete) {
            DeleteAccountView(onDeleted: { Task { await model.accountDeleted() } })
        }
    }

    private var choose: some View {
        AuthPage {
            AuthTitle(title: "Welcome to ServiceFlow",
                      subtitle: "Track time, photos and job progress with your crew. Start by creating your company or joining one.")
            OnboardingChoice(icon: "building.2.fill", title: "Create a company",
                             detail: "For owners and managers. You can invite your crew next.") { step = .create }
                .padding(.bottom, 12)
            OnboardingChoice(icon: "person.badge.key.fill", title: "Join with an invite code",
                             detail: "Your manager gives you an 8-character code.") { step = .join }

            HStack(spacing: 18) {
                Spacer()
                AuthLinkButton(title: "Sign out") { Task { await model.signOut() } }
                AuthLinkButton(title: "Delete account") { showDelete = true }
                Spacer()
            }
            .padding(.top, 28)
        }
    }
}

private struct OnboardingChoice: View {
    var icon: String
    var title: String
    var detail: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(AuthPalette.brand)
                    .frame(width: 46, height: 46)
                    .background(Color(hex: 0xe9f3ee), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).text(16, .heavy, AuthPalette.ink)
                    Text(detail).text(13, .medium, AuthPalette.inkMuted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .padding(16)
            .bordered(14, border: AuthPalette.fieldBorder)
        }
        .buttonStyle(.pressable(opacity: 0.8))
    }
}

struct CreateCompanyView: View {
    @Environment(AppModel.self) private var model
    var onBack: () -> Void

    @State private var name = ""
    @State private var trade = ""
    @State private var error: String?
    @State private var loading = false

    static let trades = ["Painting", "Cleaning", "Landscaping", "Construction", "Electrical", "Plumbing", "HVAC",
                         "Roofing", "Flooring", "Handyman", "Other"]

    var body: some View {
        AuthPage(showsLogo: false, onBack: onBack) {
            AuthTitle(title: "Create your company", subtitle: "You'll be its owner. You can change these details later on the web.")
            AuthLabel(text: "Company name")
            AuthTextField(placeholder: "e.g. Northside Renovations", text: $name, content: .organizationName,
                          capitalization: .words, submitLabel: .done)
                .padding(.bottom, 18)
            AuthLabel(text: "Trade")
            Menu {
                ForEach(Self.trades, id: \.self) { option in
                    Button(option) { trade = option }
                }
            } label: {
                HStack {
                    Text(trade.isEmpty ? "Choose your trade" : trade)
                        .font(.app(16, .medium))
                        .foregroundStyle(trade.isEmpty ? AuthPalette.placeholder : AuthPalette.ink)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AuthPalette.placeholder)
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .bordered(10, border: AuthPalette.fieldBorder)
            }
            AuthErrorSlot(message: error)
            AuthPrimaryButton(title: "Create company", busyTitle: "Creating...", busy: loading, enabled: !loading, action: create)
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
    var onBack: () -> Void
    var onJoined: () -> Void

    @State private var code = ""
    @State private var error: String?
    @State private var joined: String?
    @State private var loading = false

    var body: some View {
        AuthPage(showsLogo: false, onBack: onBack) {
            AuthTitle(title: "Join your team", subtitle: "Enter the 8-character invite code from your manager.")
            TextField("", text: $code, prompt: Text("ABCD-EFGH").foregroundColor(AuthPalette.placeholder))
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .tracking(4)
                .multilineTextAlignment(.center)
                .foregroundStyle(AuthPalette.ink)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .submitLabel(.join)
                .onSubmit(join)
                .frame(height: 60)
                .bordered(10, border: AuthPalette.fieldBorder)
                .onChange(of: code) { _, value in
                    let formatted = InviteCode.display(value)
                    if formatted != value { code = formatted }
                    error = nil
                }
            AuthErrorSlot(message: error)
            if let joined {
                Text("You joined \(joined).").text(15, .bold, AuthPalette.brandDeep).padding(.bottom, 12)
            }
            AuthPrimaryButton(title: "Join company", busyTitle: "Joining...", busy: loading,
                              enabled: InviteCode.isComplete(code), action: join)
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
