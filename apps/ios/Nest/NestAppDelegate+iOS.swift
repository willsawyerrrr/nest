import SwiftUI
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
        UNUserNotificationCenter.current().setNotificationCategories(NotificationActions.categories)
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

    /// Acts on the member's response: opens the screen a tapped notification (or
    /// its link action) names, sets a gift candidate aside from its dismiss
    /// action, or marks a transaction reviewed or flags its category wrong from
    /// its review actions, then completes on the main thread.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let outcome = NotificationResponse(
            actionIdentifier: response.actionIdentifier,
            userInfo: response.notification.request.content.userInfo)
        Task { @MainActor in
            switch outcome {
            case .open(let destination): NotificationRouter.shared.open(destination)
            case .dismissGiftCandidate(let id):
                try? await GiftCandidateDismisser().dismiss(transactionID: id)
            case .markReviewed(let id):
                try? await TransactionReviewMarker().markReviewed(transactionID: id)
            case .flagWrongCategory(let id):
                try? await TransactionReviewMarker().flagWrongCategory(transactionID: id)
            case .ignore: break
            }
            completionHandler()
        }
    }
}

/// The platform's `UIApplicationDelegateAdaptor` / `NSApplicationDelegateAdaptor`,
/// specialised to `NestAppDelegate` so `NestApp` attaches it with no
/// platform-specific syntax.
typealias PlatformAppDelegateAdaptor = UIApplicationDelegateAdaptor<NestAppDelegate>
