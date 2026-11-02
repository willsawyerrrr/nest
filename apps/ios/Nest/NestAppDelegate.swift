#if os(iOS) && !targetEnvironment(macCatalyst)
import UIKit
import UserNotifications

/// Receives the APNs device token and the member's taps on notifications, which
/// SwiftUI's `App` lifecycle has no hook for.
final class NestAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = DeviceToken.hex(deviceToken)
        Task { await PushRegistrar.shared.didReceive(token: token) }
    }

    /// Shows a notification that arrives while the app is open.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// Opens the page a tapped notification names in the web view.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        guard let url = NotificationRoute.url(from: userInfo, base: WebApp.url) else { return }
        await NotificationRouter.shared.open(url)
    }
}
#endif
