import Foundation
import Testing

@testable import Nest

@Suite struct NotificationsPresentationTests {
    private func preference(_ trigger: NotificationTrigger, enabled: Bool) -> NotificationPreference {
        NotificationPreference(
            createdAt: "", enabled: enabled, householdId: "h", id: "p-\(trigger.rawValue)",
            memberId: "m", trigger: trigger, updatedAt: "")
    }

    private func result(
        devices: Int, sent: Int, pruned: Int = 0, failed: Int = 0,
        failures: [PushTestResult.Failure]? = nil
    ) -> PushTestResult {
        PushTestResult(
            devices: devices, sent: sent, pruned: pruned, failed: failed, failures: failures)
    }

    @Test func listsSixTriggersInOrderWithoutUpDisconnected() {
        let rows = NotificationsPresentation.toggles(for: [])
        #expect(
            rows.map(\.trigger) == [
                .bufferNegative, .goalEtaSlipped, .temporaryItemExpiring, .fyBoundary,
                .giftPurchaseUnassigned, .giftCandidateNew,
            ])
        #expect(rows.first?.label == "Buffer goes negative")
    }

    @Test func anAbsentRowMeansOn() {
        #expect(NotificationsPresentation.toggles(for: []).allSatisfy { $0.enabled })
    }

    @Test func aStoredChoiceAppliesAndAnOverrideWins() {
        let stored = [preference(.fyBoundary, enabled: false)]
        let rows = NotificationsPresentation.toggles(for: stored)
        #expect(rows.first { $0.trigger == .fyBoundary }?.enabled == false)
        let overridden = NotificationsPresentation.toggles(for: stored, overrides: [.fyBoundary: true])
        #expect(overridden.first { $0.trigger == .fyBoundary }?.enabled == true)
    }

    @Test func describesNoDevices() {
        #expect(
            NotificationsPresentation.describe(result(devices: 0, sent: 0))
                == "No devices are registered for notifications.")
    }

    @Test func describesASend() {
        #expect(NotificationsPresentation.describe(result(devices: 1, sent: 1)) == "Sent to 1 device.")
        #expect(NotificationsPresentation.describe(result(devices: 2, sent: 2)) == "Sent to 2 devices.")
    }

    @Test func describesPrunedAndFailedDevices() {
        let text = NotificationsPresentation.describe(
            result(
                devices: 4, sent: 0, pruned: 1, failed: 2,
                failures: [
                    .init(channel: "apns", reason: "Unregistered"),
                    .init(channel: "apns", reason: "Unregistered"),
                    .init(channel: "web", reason: "Gone"),
                ]))
        #expect(
            text
                == "Reached no devices. Removed 1 device that had unsubscribed. Could not reach 2 devices (Unregistered, Gone)."
        )
    }

    @Test func describesFailuresWithoutReasons() {
        #expect(
            NotificationsPresentation.describe(result(devices: 2, sent: 1, failed: 1))
                == "Sent to 1 device. Could not reach 1 device.")
    }
}
