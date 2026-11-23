import Foundation
import UserNotifications

/// The actions a notification category offers, registered with the system at
/// launch so the payload's `aps.category` can name them.
enum NotificationActions {
    /// A gift candidate notification: link it to a gift, or set it aside.
    static let giftCandidateCategory = "gift_candidate"
    /// Opens the Gifts screen, where the candidate is linked to a recipient.
    static let linkGift = "link-gift"
    /// Marks the candidate "not a gift", as the Gifts screen does.
    static let dismissGiftCandidate = "dismiss-gift-candidate"
    /// A transaction review notification: confirm its Up category, or expand it
    /// to pick another in the notification content extension.
    static let transactionReviewCategory = "transaction_review"
    /// Marks the transaction reviewed, as the review screen's Looks right does.
    static let markReviewed = "mark-reviewed"

    static var categories: Set<UNNotificationCategory> {
        [
            UNNotificationCategory(
                identifier: giftCandidateCategory,
                actions: [
                    UNNotificationAction(
                        identifier: linkGift, title: "Link to a gift", options: [.foreground]),
                    UNNotificationAction(
                        identifier: dismissGiftCandidate, title: "Not a gift",
                        options: [.authenticationRequired]),
                ],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: transactionReviewCategory,
                actions: [
                    UNNotificationAction(
                        identifier: markReviewed, title: "Looks right",
                        options: [.authenticationRequired])
                ],
                intentIdentifiers: []
            ),
        ]
    }
}

/// What the app does for the member's response to a notification.
enum NotificationResponse: Equatable, Sendable {
    /// Open the screen the payload's `url` names.
    case open(NotificationDestination)
    /// Set the gift candidate transaction aside without opening the app.
    case dismissGiftCandidate(transactionID: String)
    /// Mark the transaction reviewed without opening the app.
    case markReviewed(transactionID: String)
    case ignore

    /// The response for the action the member chose. A tap and the link action
    /// open the payload's destination; the dismiss action needs the payload's
    /// non-empty `transactionId`, and the review action a uuid one.
    init(actionIdentifier: String, userInfo: [AnyHashable: Any]) {
        switch actionIdentifier {
        case NotificationActions.markReviewed:
            self = ReviewNotification.transactionID(userInfo).map(Self.markReviewed) ?? .ignore
        case NotificationActions.dismissGiftCandidate:
            if let id = userInfo["transactionId"] as? String, !id.isEmpty {
                self = .dismissGiftCandidate(transactionID: id)
            } else {
                self = .ignore
            }
        case UNNotificationDefaultActionIdentifier, NotificationActions.linkGift:
            self = NotificationDestination(userInfo: userInfo).map(Self.open) ?? .ignore
        default:
            self = .ignore
        }
    }
}

/// Sets a gift candidate aside from a notification, writing the dismissal the
/// Gifts screen writes.
struct GiftCandidateDismisser: Sendable {
    var data: NestData = .live

    /// Whether a dismissal was written: false when the signed-in member cannot
    /// see the transaction.
    @discardableResult
    func dismiss(transactionID: String) async throws -> Bool {
        var household: String?
        for try await snapshot in data.rows(
            LedgerTransaction.self, filters: [.eq("id", transactionID)], limit: 1, cached: false)
        {
            household = snapshot.rows.first?.householdId
        }
        guard let household else { return false }
        try await data.insert(
            GiftTransactionDismissal.self,
            values: GiftDismissalValues(householdId: household, transactionId: transactionID),
            also: ["transactions"])
        return true
    }
}

/// Marks a transaction reviewed from its notification with the review screen's
/// Looks right write, leaving its note and category.
struct TransactionReviewMarker: Sendable {
    var data: NestData = .live

    func markReviewed(transactionID: String) async throws {
        try await data.call(
            "review_transaction", params: ReviewTransactionParams(transactionId: transactionID),
            invalidating: ["transactions"])
    }
}
