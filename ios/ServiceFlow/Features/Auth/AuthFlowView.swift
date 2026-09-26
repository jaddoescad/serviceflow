import ServiceFlowCore
import SwiftUI

/// Signed-out screens: sign in, create an account, reset a password.
struct AuthFlowView: View {
    enum Step: Equatable {
        case signIn
        case signUp
        case verify(email: String, purpose: CodePurpose)
        case setPassword(purpose: CodePurpose)
        case forgot
    }

    enum CodePurpose: Equatable { case signUp, reset }

    @Environment(AppModel.self) private var model
    @State private var step: Step = .signIn
    @State private var email = ""

    var body: some View {
        Group {
            switch step {
            case .signIn:
                SignInView(email: $email, onCreateAccount: { step = .signUp }, onForgot: { step = .forgot })
            case .signUp:
                SignUpView(email: $email, onBack: { step = .signIn }, onCodeSent: { step = .verify(email: $0, purpose: .signUp) })
            case .forgot:
                ForgotPasswordView(email: $email, onBack: { step = .signIn }, onCodeSent: { step = .verify(email: $0, purpose: .reset) })
            case let .verify(address, purpose):
                VerifyCodeView(email: address, purpose: purpose, onBack: { step = purpose == .signUp ? .signUp : .forgot },
                               onVerified: { step = .setPassword(purpose: purpose) })
            case let .setPassword(purpose):
                SetPasswordView(purpose: purpose)
            }
        }
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.2), value: step)
    }
}

// MARK: - Sign in

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Binding var email: String
    var onCreateAccount: () -> Void
    var onForgot: () -> Void

    @State private var password = ""
    @State private var error: String?
    @State private var loading = false
    @FocusState private var focus: Field?

    enum Field { case email, password }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.trimmingCharacters(in: .whitespaces).isEmpty && !loading
    }

    var body: some View {
        AuthPage {
            AuthLabel(text: "Email Address")
            AuthTextField(placeholder: "name@company.com", text: $email, content: .emailAddress, keyboard: .emailAddress) {
                focus = .password
            }
            .focused($focus, equals: .email)
            .padding(.bottom, 18)

            AuthLabel(text: "Password")
            AuthPasswordField(text: $password, onSubmit: submit)
                .focused($focus, equals: .password)

            AuthErrorSlot(message: error)

            AuthPrimaryButton(title: "Log In", busyTitle: "Signing In...", busy: loading, enabled: canSubmit, action: submit)

            HStack {
                Spacer()
                AuthLinkButton(title: "Forgot password?", action: onForgot)
                Spacer()
            }
            .padding(.top, 10)

            VStack(spacing: 4) {
                Text("New to ServiceFlow?").text(14, .semibold, AuthPalette.inkMuted)
                AuthLinkButton(title: "Create an account", action: onCreateAccount)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 18)
        }
        .onChange(of: email) { _, _ in error = nil }
        .onChange(of: password) { _, _ in error = nil }
    }

    private func submit() {
        guard canSubmit, let api = model.api else {
            if !loading { error = "Enter your email and password." }
            return
        }
        error = nil
        loading = true
        Task {
            do {
                try await api.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            } catch {
                self.error = AuthMessage.from(error)
            }
            loading = false
        }
    }
}

// MARK: - Create account

struct SignUpView: View {
    @Environment(AppModel.self) private var model
    @Binding var email: String
    var onBack: () -> Void
    var onCodeSent: (String) -> Void

    @State private var name = ""
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        AuthPage(showsLogo: false, onBack: onBack) {
            AuthTitle(title: "Create your account",
                      subtitle: "Start a company, or join your team with an invite code. We'll email you a code to confirm it's you.")
            AuthLabel(text: "Your name")
            AuthTextField(placeholder: "First and last name", text: $name, content: .name, capitalization: .words)
                .padding(.bottom, 18)
            AuthLabel(text: "Email Address")
            AuthTextField(placeholder: "name@company.com", text: $email, content: .emailAddress, keyboard: .emailAddress,
                          submitLabel: .send, onSubmit: submit)
            AuthErrorSlot(message: error)
            AuthPrimaryButton(title: "Send code", busyTitle: "Sending...", busy: loading, enabled: !loading, action: submit)
            Text("By creating an account you agree to use ServiceFlow for your company's work records.")
                .text(12.5, .medium, AuthPalette.inkMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        }
        .onChange(of: name) { _, _ in error = nil }
        .onChange(of: email) { _, _ in error = nil }
    }

    private func submit() {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let problem = AccountValidation.name(name) ?? AccountValidation.email(address) {
            error = problem
            return
        }
        guard let api = model.api else { return }
        loading = true
        Task {
            do {
                try await api.sendSignUpCode(email: address, name: name.trimmingCharacters(in: .whitespacesAndNewlines))
                onCodeSent(address)
            } catch {
                self.error = AuthMessage.from(error)
            }
            loading = false
        }
    }
}

// MARK: - Forgot password

struct ForgotPasswordView: View {
    @Environment(AppModel.self) private var model
    @Binding var email: String
    var onBack: () -> Void
    var onCodeSent: (String) -> Void

    @State private var error: String?
    @State private var loading = false

    var body: some View {
        AuthPage(showsLogo: false, onBack: onBack) {
            AuthTitle(title: "Reset your password", subtitle: "We'll email you a 6-digit code to set a new password.")
            AuthLabel(text: "Email Address")
            AuthTextField(placeholder: "name@company.com", text: $email, content: .emailAddress, keyboard: .emailAddress,
                          submitLabel: .send, onSubmit: submit)
            AuthErrorSlot(message: error)
            AuthPrimaryButton(title: "Send code", busyTitle: "Sending...", busy: loading, enabled: !loading, action: submit)
        }
        .onChange(of: email) { _, _ in error = nil }
    }

    private func submit() {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let problem = AccountValidation.email(address) {
            error = problem
            return
        }
        guard let api = model.api else { return }
        loading = true
        Task {
            do {
                try await api.sendPasswordResetCode(email: address)
                onCodeSent(address)
            } catch {
                self.error = AuthMessage.from(error)
            }
            loading = false
        }
    }
}

// MARK: - Verify code

struct VerifyCodeView: View {
    @Environment(AppModel.self) private var model
    var email: String
    var purpose: AuthFlowView.CodePurpose
    var onBack: () -> Void
    var onVerified: () -> Void

    @State private var code = ""
    @State private var error: String?
    @State private var loading = false
    @State private var resendNote: String?

    var body: some View {
        AuthPage(showsLogo: false, onBack: onBack) {
            AuthTitle(title: "Check your email", subtitle: "Enter the 6-digit code we sent to \(email).")
            CodeField(code: $code, onComplete: verify)
            AuthErrorSlot(message: error)
            AuthPrimaryButton(title: "Continue", busyTitle: "Checking...", busy: loading, enabled: code.count == 6, action: verify)
            HStack {
                Spacer()
                AuthLinkButton(title: "Send a new code", action: resend)
                Spacer()
            }
            .padding(.top, 10)
            if let resendNote {
                Text(resendNote).text(13.5, .semibold, AuthPalette.inkMuted).frame(maxWidth: .infinity)
            }
        }
        .onChange(of: code) { _, _ in error = nil }
    }

    private func verify() {
        guard code.count == 6, !loading, let api = model.api else { return }
        loading = true
        // Keep these screens up after the code signs the person in, until a
        // password is set.
        model.holdAuthFlow = true
        Task {
            do {
                switch purpose {
                case .signUp: try await api.verifyEmailCode(email: email, code: code)
                case .reset: try await api.verifyPasswordResetCode(email: email, code: code)
                }
                onVerified()
            } catch {
                model.holdAuthFlow = false
                self.error = AuthMessage.from(error)
            }
            loading = false
        }
    }

    private func resend() {
        guard let api = model.api else { return }
        resendNote = nil
        Task {
            do {
                switch purpose {
                case .signUp: try await api.sendSignInCode(email: email)
                case .reset: try await api.sendPasswordResetCode(email: email)
                }
                resendNote = "A new code is on its way."
            } catch {
                self.error = AuthMessage.from(error)
            }
        }
    }
}

// MARK: - Set password

struct SetPasswordView: View {
    @Environment(AppModel.self) private var model
    var purpose: AuthFlowView.CodePurpose

    @State private var password = ""
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        AuthPage(showsLogo: false) {
            AuthTitle(title: purpose == .signUp ? "Choose a password" : "Set a new password",
                      subtitle: "You'll use it with your email to sign in. Use at least 8 characters.")
            AuthLabel(text: "Password")
            AuthPasswordField(placeholder: "New password", text: $password, content: .newPassword, onSubmit: save)
            AuthErrorSlot(message: error)
            AuthPrimaryButton(title: "Save password", busyTitle: "Saving...", busy: loading, enabled: !password.isEmpty, action: save)
        }
        .onChange(of: password) { _, _ in error = nil }
    }

    private func save() {
        if let problem = AccountValidation.password(password) {
            error = problem
            return
        }
        guard let api = model.api else { return }
        loading = true
        Task {
            do {
                try await api.updateAccount(password: password)
                await model.finishAuthFlow()
            } catch {
                self.error = AuthMessage.from(error)
            }
            loading = false
        }
    }
}
