import ServiceFlowCore
import UIKit
import UserNotifications

/// Local shift reminders, notification permission and APNs registration.
///
/// Permission is never requested at launch or sign-in: it is asked once, right
/// after a person's first successful clock-in, so the "Still clocked in?"
/// reminders make sense when the prompt appears.
final class NotificationService: NSObject, ShiftReminderScheduling, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let clockOutCategory = "ottawa-painters-clock-out-prompt"
    static let switchCategory = "ottawa-painters-switch-project-prompt"
    static let reminderHours = [8, 10]
    private static let reminderPrefix = "serviceflow-active-shift-"

    private let center = UNUserNotificationCenter.current()
    /// A notification action asked to clock out.
    var onClockOutAction: (() -> Void)?
    /// A notification body tap; the message to show on Clock In.
    var onReminderTap: ((String) -> Void)?

    override init() {
        super.init()
        center.delegate = self
        registerCategories()
    }

    private func registerCategories() {
        let clockOut = UNNotificationAction(identifier: "clock_out", title: "Clock Out", options: [.foreground])
        let switchJob = UNNotificationAction(identifier: "switch_project", title: "Switch Job", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.clockOutCategory, actions: [clockOut], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.switchCategory, actions: [switchJob, clockOut], intentIdentifiers: []),
        ])
    }

    // MARK: Permission

    func isAuthorized() async -> Bool {
        let settings = await center.notificationSettings()
        return [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
    }

    /// Asks once, only if the person has never answered.
    func requestIfUndetermined() async -> Bool {
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return await isAuthorized() }
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted { await MainActor.run { UIApplication.shared.registerForRemoteNotifications() } }
        return granted
    }

    /// Registers for pushes when already allowed (never prompts).
    func registerForPushIfAuthorized() async {
        guard await isAuthorized() else { return }
        await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
    }

    // MARK: ShiftReminderScheduling

    func scheduleReminders(for shift: TimeEntry, now: Date) {
        cancelReminders()
        let name = shift.project.name
        for hours in Self.reminderHours {
            let target = shift.originalStartedAt.addingTimeInterval(TimeInterval(hours * 3600))
            let seconds = target.timeIntervalSince(now)
            // An overdue reminder is not re-sent every time the app launches.
            guard seconds > 0 else { continue }
            let content = UNMutableNotificationContent()
            content.title = "Still clocked in?"
            content.body = "Your shift at \(name) has been running for \(hours) hours. Clock out if you are finished."
            content.sound = .default
            content.categoryIdentifier = Self.clockOutCategory
            content.userInfo = ["type": "active_shift_reminder", "hours": hours, "shiftLocalId": shift.localId]
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(60, seconds.rounded(.up)), repeats: false)
            // The id names the shift, so each shift's reminders are distinct.
            center.add(UNNotificationRequest(identifier: "\(Self.reminderPrefix)\(hours)h-\(shift.localId)", content: content, trigger: trigger))
        }
    }

    func cancelReminders() {
        center.getPendingNotificationRequests { requests in
            let ids = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) }
            self.center.removePendingNotificationRequests(withIdentifiers: ids)
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let type = info["type"] as? String
        let hours = info["hours"] as? Int
        let action = response.actionIdentifier
        await MainActor.run {
            switch action {
            case "clock_out":
                onClockOutAction?()
            case UNNotificationDefaultActionIdentifier:
                if type == "active_shift_reminder" {
                    let after = hours.map { " after \($0) hours" } ?? ""
                    onReminderTap?("You are still clocked in\(after). Clock out if you are finished.")
                }
            default:
                break
            }
        }
    }
}
