import UIKit
import UserNotifications

/// Keeps the screen on and holds a background-task assertion while a run is in progress.
@MainActor
final class KeepAlive {
  private var task = UIBackgroundTaskIdentifier.invalid

  func begin() {
    UIApplication.shared.isIdleTimerDisabled = true
    renew()
  }

  /// Takes a fresh assertion so a brief lock lets the current generation finish.
  func renew() {
    endTask()
    task = UIApplication.shared.beginBackgroundTask(withName: "Nest Eval run") { [weak self] in
      Task { @MainActor in self?.endTask() }
    }
  }

  func end() {
    UIApplication.shared.isIdleTimerDisabled = false
    endTask()
  }

  private func endTask() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }
}

enum Notifier {
  /// Posts a local notification, asking for permission the first time.
  static func post(title: String, body: String) async {
    let center = UNUserNotificationCenter.current()
    guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    try? await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
  }
}
