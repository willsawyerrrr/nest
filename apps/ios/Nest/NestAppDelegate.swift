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
    ///
    /// The completion-handler form is used throughout: UserNotifications calls
    /// these on a background queue, and an `async` method would complete from a
    /// background executor, which makes UIKit assert off the main thread.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        Task { @MainActor in completionHandler([.banner, .sound]) }
    }

    /// Opens the page a tapped notification names in the web view, then
    /// completes on the main thread.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let url = NotificationRoute.url(from: userInfo, base: WebApp.url)
        Task { @MainActor in
            if let url { NotificationRouter.shared.open(url) }
            completionHandler()
        }
    }
}
#endif
