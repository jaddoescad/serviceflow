import ServiceFlowCore
import SwiftUI

/// The logo shown above the sign-in form.
struct AuthLogo: View {
    var body: some View {
        Image("Logo").resizable().scaledToFit()
            .frame(maxWidth: 150, maxHeight: 96)
            .frame(maxWidth: .infinity)
            .padding(.top, 12)
            .padding(.bottom, 4)
            .accessibilityLabel("ServiceFlow")
    }
}

/// A native form page used by every signed-out screen.
struct AuthForm<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content

    var body: some View {
        Form { content }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(title ?? "")
            .navigationBarTitleDisplayMode(title == nil ? .inline : .large)
            .tint(AuthPalette.brand)
    }
}

/// A plain text field row.
struct AuthTextField: View {
    var placeholder: String
    @Binding var text: String
    var content: UITextContentType?
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .never
    var submitLabel: SubmitLabel = .next
    var onSubmit: () -> Void = {}

    var body: some View {
        TextField(placeholder, text: $text)
            .textContentType(content)
            .keyboardType(keyboard)
            .textInputAutocapitalization(capitalization)
            .autocorrectionDisabled()
            .submitLabel(submitLabel)
            .onSubmit(onSubmit)
    }
}

/// Password field with the standard reveal button.
struct AuthPasswordField: View {
    var placeholder = "Password"
    @Binding var text: String
    var content: UITextContentType = .password
    var submitLabel: SubmitLabel = .done
    var onSubmit: () -> Void = {}
    @State private var visible = false

    var body: some View {
        HStack {
            Group {
                if visible {
                    TextField(placeholder, text: $text)
                } else {
                    SecureField(placeholder, text: $text)
                }
            }
            .textContentType(content)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(submitLabel)
            .onSubmit(onSubmit)

            Button { visible.toggle() } label: {
                Image(systemName: visible ? "eye.slash" : "eye").foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(visible ? "Hide password" : "Show password")
        }
    }
}

/// A full-width prominent button in its own form section.
struct AuthPrimaryButton: View {
    var title: String
    var busy: Bool
    var enabled: Bool
    var role: ButtonRole?
    var action: () -> Void

    init(title: String, busy: Bool, enabled: Bool, role: ButtonRole? = nil, action: @escaping () -> Void) {
        self.title = title
        self.busy = busy
        self.enabled = enabled
        self.role = role
        self.action = action
    }

    var body: some View {
        Section {
            Button(role: role, action: action) {
                ZStack {
                    Text(title).opacity(busy ? 0 : 1)
                    if busy { ProgressView().tint(.white) }
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 30)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(role == .destructive ? Palette.red : AuthPalette.brand)
            .disabled(!enabled || busy)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }
}

/// A section footer that shows an error in red.
struct AuthErrorText: View {
    var message: String?
    var body: some View {
        if let message {
            Text(message).foregroundStyle(AuthPalette.danger)
        }
    }
}

/// A section footer: the error when there is one, else the hint.
struct AuthFooter: View {
    var error: String?
    var hint: String?

    var body: some View {
        if let error {
            AuthErrorText(message: error)
        } else if let hint {
            Text(hint)
        }
    }
}

/// Six-digit code entry.
struct CodeField: View {
    @Binding var code: String
    var onComplete: () -> Void

    var body: some View {
        TextField("123456", text: $code)
            .font(.system(.title, design: .rounded).monospacedDigit().weight(.semibold))
            .multilineTextAlignment(.center)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .onChange(of: code) { _, value in
                let digits = String(value.filter(\.isNumber).prefix(6))
                if digits != value { code = digits }
                if digits.count == 6 { onComplete() }
            }
    }
}

/// Maps Supabase auth errors to friendlier text.
enum AuthMessage {
    static func from(_ error: Error) -> String {
        // Server refusals already carry readable text (e.g. invite codes).
        if let error = error as? BackendError, case .server = error { return error.message }
        let text = error.localizedDescription
        let lower = text.lowercased()
        if lower.contains("invalid login credentials") { return "That email and password don't match." }
        if lower.contains("token has expired") || lower.contains("otp_expired") || lower.contains("invalid") && lower.contains("otp") {
            return "That code is wrong or has expired. Check the latest email, or send a new code."
        }
        if lower.contains("rate limit") || lower.contains("security purposes") {
            return "Too many attempts. Wait a minute and try again."
        }
        if lower.contains("signups not allowed") || lower.contains("user not found") {
            return "There's no ServiceFlow account for that email."
        }
        if (error as NSError).domain == NSURLErrorDomain { return "You're offline. Check your connection and try again." }
        return text
    }
}
