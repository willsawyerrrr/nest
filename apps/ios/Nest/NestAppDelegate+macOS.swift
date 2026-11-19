import AppKit
import SwiftUI
import UserNotifications

/// Receives the member's taps on notifications, which SwiftUI's `App`
/// lifecycle has no hook for. No push is registered on macOS.
final class NestAppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    /// Opens the screen a tapped notification names, then completes on the main
    /// thread.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let destination = NotificationDestination(userInfo: response.notification.request.content.userInfo)
        Task { @MainActor in
            if let destination { NotificationRouter.shared.open(destination) }
            completionHandler()
        }
    }
}

/// The platform's `UIApplicationDelegateAdaptor` / `NSApplicationDelegateAdaptor`,
/// specialised to `NestAppDelegate` so `NestApp` attaches it with no
/// platform-specific syntax.
typealias PlatformAppDelegateAdaptor = NSApplicationDelegateAdaptor<NestAppDelegate>
