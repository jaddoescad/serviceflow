import ServiceFlowCore
import SwiftUI

@main
struct ServiceFlowApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.light)
                .onAppear { appDelegate.model = model }
        }
        .onChange(of: scenePhase) { _, phase in model.scenePhaseChanged(phase) }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    weak var model: AppModel?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            guard let model, let api = model.api, model.session != nil else { return }
            await api.registerPushToken(deviceToken: token, appVersion: model.config?.appVersion ?? "0")
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.phase {
            case .booting:
                ZStack {
                    Color.white.ignoresSafeArea()
                    ProgressView().tint(Palette.teal)
                }
            case .signedOut:
                AuthFlowView()
            case .onboarding:
                OnboardingView()
            case .maintenance:
                MaintenanceView()
            case .main:
                if let session = model.session {
                    MainShell()
                        .environment(session)
                        .environment(session.tracker)
                }
            case .misconfigured:
                MessageScreen(title: "ServiceFlow isn't set up",
                              message: "This build is missing its server configuration. Install the version from the App Store.")
            }
        }
        .animation(.default, value: model.phase)
    }
}

/// Centred title and body on white (maintenance, configuration errors).
struct MessageScreen<Footer: View>: View {
    var title: String
    var message: String
    @ViewBuilder var footer: Footer

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()
            VStack(spacing: 0) {
                Text(title).text(22, .black, Palette.ink).multilineTextAlignment(.center)
                Text(message).text(15, .regular, Palette.muted).lineSpacing(5).multilineTextAlignment(.center).padding(.top, 12)
                footer
            }
            .padding(.horizontal, 32)
        }
    }
}

extension MessageScreen where Footer == EmptyView {
    init(title: String, message: String) {
        self.init(title: title, message: message) { EmptyView() }
    }
}

struct MaintenanceView: View {
    @Environment(AppModel.self) private var model
    @State private var checking = false

    var body: some View {
        MessageScreen(
            title: "Database upgrade in progress",
            message: "ServiceFlow is temporarily paused while your jobs and time records are verified. Please try again shortly."
        ) {
            VStack(spacing: 12) {
                Button {
                    checking = true
                    Task {
                        await model.refreshAccount()
                        checking = false
                    }
                } label: {
                    ZStack {
                        Text("Try Again").opacity(checking ? 0 : 1)
                        if checking { ProgressView().tint(.white) }
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Palette.green)
                .disabled(checking)
                Button("Sign Out") { Task { await model.signOut() } }
                    .tint(Palette.muted)
            }
            .padding(.top, 28)
        }
    }
}
