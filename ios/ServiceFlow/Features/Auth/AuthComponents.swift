import SwiftUI

/// Scrolling, top-aligned auth page with the logo.
struct AuthPage<Content: View>: View {
    var showsLogo = true
    var onBack: (() -> Void)?
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                if let onBack {
                    HStack {
                        Button(action: onBack) {
                            Image(systemName: "chevron.left").font(.system(size: 22, weight: .semibold))
                                .foregroundStyle(AuthPalette.ink).frame(width: 38, height: 38, alignment: .leading)
                        }
                        .accessibilityLabel("Back")
                        Spacer()
                    }
                    .padding(.bottom, 8)
                }
                if showsLogo {
                    Image("Logo").resizable().scaledToFit()
                        .frame(maxWidth: 230, maxHeight: 147)
                        .padding(.bottom, 28)
                        .accessibilityLabel("ServiceFlow")
                }
                VStack(alignment: .leading, spacing: 0) { content }
                    .frame(maxWidth: 420)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 28)
            .padding(.vertical, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .background(Color.white.ignoresSafeArea())
    }
}

struct AuthTitle: View {
    var title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).text(24, .black, AuthPalette.ink, tracking: -0.4)
            if let subtitle {
                Text(subtitle).text(15, .medium, AuthPalette.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 22)
    }
}

struct AuthLabel: View {
    var text: String
    var body: some View {
        Text(text).text(15, .bold, AuthPalette.brandDeep).padding(.bottom, 8)
    }
}

/// A 52pt bordered text field.
struct AuthTextField: View {
    var placeholder: String
    @Binding var text: String
    var content: UITextContentType?
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .never
    var submitLabel: SubmitLabel = .next
    var onSubmit: () -> Void = {}

    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundColor(AuthPalette.placeholder))
            .font(.app(16, .medium))
            .foregroundStyle(AuthPalette.ink)
            .textContentType(content)
            .keyboardType(keyboard)
            .textInputAutocapitalization(capitalization)
            .autocorrectionDisabled()
            .submitLabel(submitLabel)
            .onSubmit(onSubmit)
            .padding(.horizontal, 16)
            .frame(height: 52)
            .bordered(10, border: AuthPalette.fieldBorder)
    }
}

/// Password field with a Show/Hide toggle.
struct AuthPasswordField: View {
    var placeholder = "Password"
    @Binding var text: String
    var content: UITextContentType = .password
    var submitLabel: SubmitLabel = .done
    var onSubmit: () -> Void = {}
    @State private var visible = false

    var body: some View {
        HStack(spacing: 0) {
            Group {
                if visible {
                    TextField("", text: $text, prompt: Text(placeholder).foregroundColor(AuthPalette.placeholder))
                } else {
                    SecureField("", text: $text, prompt: Text(placeholder).foregroundColor(AuthPalette.placeholder))
                }
            }
            .font(.app(16, .medium))
            .foregroundStyle(AuthPalette.ink)
            .textContentType(content)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(submitLabel)
            .onSubmit(onSubmit)
            .frame(maxHeight: .infinity)

            Button(visible ? "Hide" : "Show") { visible.toggle() }
                .font(.app(15, .heavy))
                .foregroundStyle(AuthPalette.brand)
                .padding(.horizontal, 16)
                .frame(maxHeight: .infinity)
        }
        .padding(.leading, 16)
        .frame(height: 52)
        .bordered(10, border: AuthPalette.fieldBorder)
    }
}

/// Fixed-height error slot so the layout never jumps.
struct AuthErrorSlot: View {
    var message: String?
    var body: some View {
        Text(message ?? " ")
            .text(14, .bold, AuthPalette.danger)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
            .opacity(message == nil ? 0 : 1)
            .accessibilityHidden(message == nil)
    }
}

struct AuthPrimaryButtonStyle: ButtonStyle {
    var enabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.app(17, .heavy))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                enabled ? (configuration.isPressed ? AuthPalette.brandDeep : AuthPalette.brand) : AuthPalette.disabled,
                in: RoundedRectangle(cornerRadius: 10)
            )
            .offset(y: enabled && configuration.isPressed ? 1 : 0)
    }
}

struct AuthPrimaryButton: View {
    var title: String
    var busyTitle: String
    var busy: Bool
    var enabled: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) { Text(busy ? busyTitle : title) }
            .buttonStyle(AuthPrimaryButtonStyle(enabled: enabled && !busy))
            .disabled(!enabled || busy)
    }
}

struct AuthLinkButton: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.app(15, .heavy))
            .foregroundStyle(AuthPalette.brand)
            .frame(minHeight: 44)
    }
}

/// Six-digit code entry.
struct CodeField: View {
    @Binding var code: String
    var onComplete: () -> Void

    var body: some View {
        TextField("", text: $code, prompt: Text("123456").foregroundColor(AuthPalette.placeholder))
            .font(.system(size: 28, weight: .heavy, design: .rounded).monospacedDigit())
            .tracking(8)
            .multilineTextAlignment(.center)
            .foregroundStyle(AuthPalette.ink)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .padding(.horizontal, 16)
            .frame(height: 60)
            .bordered(10, border: AuthPalette.fieldBorder)
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
