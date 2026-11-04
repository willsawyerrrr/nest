import Foundation
import UIKit
import UserNotifications

extension NestApp {
    /// The share extension posts a notification that opens Nest when tapped,
    /// and Nest's own alerts arrive over APNs, both of which need the member's
    /// permission, asked for when the app launches. Once it is granted the app
    /// registers for remote notifications — except under Mac Catalyst, which
    /// keys push differently and does not receive APNs.
    func requestNotificationAuthorization() {
        Task {
            let center = UNUserNotificationCenter.current()
            guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }
            guard !ProcessInfo.processInfo.isMacCatalystApp else { return }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }
}
