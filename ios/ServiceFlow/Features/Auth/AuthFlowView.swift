import ServiceFlowCore
import SwiftUI

/// Signed-out screens: sign in, create an account, reset a password.
struct AuthFlowView: View {
    enum Step: Hashable {
        case signUp
        case forgot
        case verify(email: String, purpose: CodePurpose)
        case setPassword(purpose: CodePurpose)
    }

    enum CodePurpose: Hashable { case signUp, reset }

    @State private var path: [Step] = []
    @State private var email = ""

    var body: some View {
        NavigationStack(path: $path) {
            SignInView(email: $email, onCreateAccount: { path.append(.signUp) }, onForgot: { path.append(.forgot) })
                .navigationDestination(for: Step.self) { step in
                    switch step {
                    case .signUp:
                        SignUpView(email: $email) { path.append(.verify(email: $0, purpose: .signUp)) }
                    case .forgot:
                        ForgotPasswordView(email: $email) { path.append(.verify(email: $0, purpose: .reset)) }
                    case let .verify(address, purpose):
                        VerifyCodeView(email: address, purpose: purpose) { path.append(.setPassword(purpose: purpose)) }
                    case let .setPassword(purpose):
                        SetPasswordView(purpose: purpose).navigationBarBackButtonHidden()
                    }
                }
        }
        .tint(AuthPalette.brand)
    }
}

// MARK: - Sign in

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Binding var email: String
    var onCreateAccount: () -> Void
    var onForgot: () -> Void

    @State private var password = ""
    @State private var request = RequestState()
    @FocusState private var focus: Field?

    enum Field { case email, password }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        AuthForm(title: nil) {
            Section {
                AuthLogo()
            }
            .listRowBackground(Color.clear)

            Section {
                AuthTextField(placeholder: "Email", text: $email, content: .emailAddress, keyboard: .emailAddress) {
                    focus = .password
                }
                .focused($focus, equals: .email)
                AuthPasswordField(text: $password, onSubmit: submit)
                    .focused($focus, equals: .password)
            } footer: {
                AuthErrorText(message: request.error)
            }

            AuthPrimaryButton(title: "Log In", busy: request.isRunning, enabled: canSubmit, action: submit)

            Section {
                Button("Forgot password?", action: onForgot)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }

            Section {
                Button("Create an Account", action: onCreateAccount)
                    .frame(maxWidth: .infinity)
            } header: {
                Text("New to ServiceFlow?")
            }
        }
        .onChange(of: email) { _, _ in request.error = nil }
        .onChange(of: password) { _, _ in request.error = nil }
    }

    private func submit() {
        guard canSubmit else {
            request.error = "Enter your email and password."
            return
        }
        guard let api = model.api else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        // The password is sent as typed; only the email is trimmed.
        request.run { try await api.signIn(email: address, password: password) }
    }
}

// MARK: - Create account

struct SignUpView: View {
    @Environment(AppModel.self) private var model
    @Binding var email: String
    var onCodeSent: (String) -> Void

    @State private var name = ""
    @State private var request = RequestState()

    var body: some View {
        AuthForm(title: "Create Account") {
            Section {
                AuthTextField(placeholder: "Your name", text: $name, content: .name, capitalization: .words)
                AuthTextField(placeholder: "Email", text: $email, content: .emailAddress, keyboard: .emailAddress,
                              submitLabel: .send, onSubmit: submit)
            } header: {
                Text("Start a company, or join your team with an invite code.")
                    .textCase(nil)
            } footer: {
                AuthFooter(error: request.error, hint: "We'll email you a 6-digit code to confirm it's you.")
            }
            AuthPrimaryButton(title: "Send Code", busy: request.isRunning, enabled: true, action: submit)
        }
        .onChange(of: name) { _, _ in request.error = nil }
        .onChange(of: email) { _, _ in request.error = nil }
    }

    private func submit() {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let fullName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = AccountValidation.name(fullName) ?? AccountValidation.email(address) {
            request.error = problem
            return
        }
        guard let api = model.api else { return }
        request.run {
            try await api.sendSignUpCode(email: address, name: fullName)
            onCodeSent(address)
        }
    }
}

// MARK: - Forgot password

struct ForgotPasswordView: View {
    @Environment(AppModel.self) private var model
    @Binding var email: String
    var onCodeSent: (String) -> Void

    @State private var request = RequestState()

    var body: some View {
        AuthForm(title: "Reset Password") {
            Section {
                AuthTextField(placeholder: "Email", text: $email, content: .emailAddress, keyboard: .emailAddress,
                              submitLabel: .send, onSubmit: submit)
            } footer: {
                AuthFooter(error: request.error, hint: "We'll email you a 6-digit code to set a new password.")
            }
            AuthPrimaryButton(title: "Send Code", busy: request.isRunning, enabled: true, action: submit)
        }
        .onChange(of: email) { _, _ in request.error = nil }
    }

    private func submit() {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let problem = AccountValidation.email(address) {
            request.error = problem
            return
        }
        guard let api = model.api else { return }
        request.run {
            try await api.sendPasswordResetCode(email: address)
            onCodeSent(address)
        }
    }
}

// MARK: - Verify code

struct VerifyCodeView: View {
    @Environment(AppModel.self) private var model
    var email: String
    var purpose: AuthFlowView.CodePurpose
    var onVerified: () -> Void

    @State private var code = ""
    @State private var request = RequestState()
    @State private var resendNote: String?

    var body: some View {
        AuthForm(title: "Check Your Email") {
            Section {
                CodeField(code: $code, onComplete: verify)
            } header: {
                Text("Enter the 6-digit code sent to \(email).").textCase(nil)
            } footer: {
                AuthFooter(error: request.error, hint: resendNote)
            }
            AuthPrimaryButton(title: "Continue", busy: request.isRunning, enabled: code.count == 6, action: verify)
            Section {
                Button("Send a New Code", action: resend).frame(maxWidth: .infinity)
            }
        }
        .onChange(of: code) { _, _ in request.error = nil }
    }

    private func verify() {
        guard code.count == 6, let api = model.api else { return }
        let code = code
        request.run {
            // Keep these screens up after the code signs the person in, until
            // a password is set.
            model.holdAuthFlow = true
            do {
                switch purpose {
                case .signUp: try await api.verifyEmailCode(email: email, code: code)
                case .reset: try await api.verifyPasswordResetCode(email: email, code: code)
                }
            } catch {
                model.holdAuthFlow = false
                throw error
            }
            onVerified()
        }
    }

    private func resend() {
        guard let api = model.api else { return }
        resendNote = nil
        request.run {
            switch purpose {
            case .signUp: try await api.sendSignInCode(email: email)
            case .reset: try await api.sendPasswordResetCode(email: email)
            }
            resendNote = "A new code is on its way."
        }
    }
}

// MARK: - Set password

struct SetPasswordView: View {
    @Environment(AppModel.self) private var model
    var purpose: AuthFlowView.CodePurpose

    @State private var password = ""
    @State private var request = RequestState()

    var body: some View {
        AuthForm(title: purpose == .signUp ? "Choose a Password" : "New Password") {
            Section {
                AuthPasswordField(placeholder: "New password", text: $password, content: .newPassword, onSubmit: save)
            } footer: {
                AuthFooter(error: request.error, hint: "Use at least 8 characters. You'll sign in with your email and this password.")
            }
            AuthPrimaryButton(title: "Save Password", busy: request.isRunning, enabled: !password.isEmpty, action: save)
        }
        .onChange(of: password) { _, _ in request.error = nil }
    }

    private func save() {
        if let problem = AccountValidation.password(password) {
            request.error = problem
            return
        }
        guard let api = model.api else { return }
        request.run {
            try await api.updateAccount(password: password)
            await model.finishAuthFlow()
        }
    }
}
