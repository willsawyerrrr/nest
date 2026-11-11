import Foundation

/// One trigger's switch as listed.
struct NotificationToggleRow: Equatable, Identifiable, Sendable {
    let trigger: NotificationTrigger
    let label: String
    let detail: String
    let enabled: Bool

    var id: NotificationTrigger { trigger }
}

/// The Notifications screen's copy and rows, as the PWA's `PushNotificationsCard`.
enum NotificationsPresentation {
    static let title = "Notifications"
    /// The native app registers its own device, so the device state is always `native`.
    static let deviceLabel = "On"
    static let deviceDetail =
        "The nest app delivers notifications to this device. Change what it may show in your device settings."
    static let sendTestLabel = "Send test notification"
    static let sectionLabel = "Notify me about"
    static let footnote = "These apply to every device you've turned on."
    static let testFailed = "Could not send the test notification. Try again."

    /// The triggers in the order the list shows them (`up_disconnected` is not offered).
    static let listed: [NotificationTrigger] = [
        .bufferNegative, .goalEtaSlipped, .temporaryItemExpiring, .fyBoundary,
        .giftPurchaseUnassigned, .giftCandidateNew,
    ]

    static func copy(_ trigger: NotificationTrigger) -> (label: String, detail: String) {
        switch trigger {
        case .bufferNegative:
            ("Buffer goes negative", "When this fortnight's plan spends more than comes in.")
        case .goalEtaSlipped:
            ("A savings goal slips", "When a dated goal falls behind its target date.")
        case .temporaryItemExpiring:
            ("A temporary item is ending", "About two weeks before a temporary item's end date.")
        case .fyBoundary:
            ("End of the financial year", "About two weeks before 30 June, to review your tax settings.")
        case .giftPurchaseUnassigned:
            (
                "A gift purchase needs assigning",
                "When a gift purchase is logged without a recipient or occasion."
            )
        case .giftCandidateNew:
            ("A new gift candidate arrives", "When your card syncs a new transaction as Gifts and Charity.")
        case .upDisconnected:
            (
                "Your Up connection needs reconnecting",
                "When Up rejects your personal access token and syncing stops."
            )
        }
    }

    /// Whether a trigger is on: an absent row means on. `overrides` holds
    /// choices still being saved.
    static func isEnabled(
        _ trigger: NotificationTrigger, in preferences: [NotificationPreference],
        overrides: [NotificationTrigger: Bool] = [:]
    ) -> Bool {
        overrides[trigger] ?? preferences.first { $0.trigger == trigger }?.enabled ?? true
    }

    static func toggles(
        for preferences: [NotificationPreference], overrides: [NotificationTrigger: Bool] = [:]
    ) -> [NotificationToggleRow] {
        listed.map { trigger in
            let text = copy(trigger)
            return NotificationToggleRow(
                trigger: trigger, label: text.label, detail: text.detail,
                enabled: isEnabled(trigger, in: preferences, overrides: overrides))
        }
    }

    /// The test send's counts as a sentence, as `describeTestResult`.
    static func describe(_ result: PushTestResult) -> String {
        if result.devices == 0 { return "No devices are registered for notifications." }
        var parts = [result.sent == 0 ? "Reached no devices." : "Sent to \(devices(result.sent))."]
        if result.pruned > 0 { parts.append("Removed \(devices(result.pruned)) that had unsubscribed.") }
        if result.failed > 0 {
            var reasons: [String] = []
            for reason in result.failures?.map(\.reason) ?? [] where !reasons.contains(reason) {
                reasons.append(reason)
            }
            let suffix = reasons.isEmpty ? "" : " (\(reasons.joined(separator: ", ")))"
            parts.append("Could not reach \(devices(result.failed))\(suffix).")
        }
        return parts.joined(separator: " ")
    }

    private static func devices(_ count: Int) -> String {
        "\(count) \(count == 1 ? "device" : "devices")"
    }
}
