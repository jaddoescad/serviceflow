import Foundation

/// Build-time configuration, from `Config/App.xcconfig` through Info.plist.
struct AppConfig {
    let supabaseURL: URL
    let supabaseKey: String
    let mediaURL: URL?
    let locationTrackingEnabled: Bool
    let appVersion: String
    let buildNumber: String

    static let current: AppConfig? = {
        let info = Bundle.main.infoDictionary ?? [:]
        func value(_ key: String) -> String? {
            guard let raw = info[key] as? String else { return nil }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty || trimmed.hasPrefix("$(") ? nil : trimmed
        }
        guard let urlString = value("ServiceFlowSupabaseURL"), let url = URL(string: urlString),
              let key = value("ServiceFlowSupabaseKey") else { return nil }
        let media = value("ServiceFlowMediaURL").flatMap { URL(string: $0.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) }
        return AppConfig(
            supabaseURL: url,
            supabaseKey: key,
            mediaURL: media,
            locationTrackingEnabled: value("ServiceFlowLocationTracking")?.uppercased() != "NO",
            appVersion: value("CFBundleShortVersionString") ?? "0",
            buildNumber: value("CFBundleVersion") ?? "0"
        )
    }()
}
