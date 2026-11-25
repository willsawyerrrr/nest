import UIKit
import UserNotifications

extension NestApp {
    /// The share extension posts a notification that opens Nest when tapped,
    /// and Nest's own alerts arrive over APNs, both of which need the member's
    /// permission, asked for when the app launches. Once it is granted the app
    /// registers for remote notifications.
    func requestNotificationAuthorization() {
        Task {
            let center = UNUserNotificationCenter.current()
            guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }
}
