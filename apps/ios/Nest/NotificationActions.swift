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
    /// A transaction review notification: confirm its Up category, or flag it
    /// wrong to fix in the app.
    static let transactionReviewCategory = "transaction_review"
    /// Marks the transaction reviewed, as the review screen's Looks right does.
    static let markReviewed = "mark-reviewed"
    /// Flags the Up category wrong, leaving the category and the transaction unreviewed.
    static let flagWrongCategory = "flag-wrong-category"

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
                        options: [.authenticationRequired]),
                    UNNotificationAction(
                        identifier: flagWrongCategory, title: "Wrong category",
                        options: [.authenticationRequired, .destructive]),
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
    /// Flag the transaction's Up category wrong without opening the app.
    case flagWrongCategory(transactionID: String)
    case ignore

    /// The response for the action the member chose. A tap and the link action
    /// open the payload's destination; the dismiss action needs the payload's
    /// non-empty `transactionId`, and the review actions a uuid one.
    init(actionIdentifier: String, userInfo: [AnyHashable: Any]) {
        switch actionIdentifier {
        case NotificationActions.markReviewed:
            self = ReviewNotification.transactionID(userInfo).map(Self.markReviewed) ?? .ignore
        case NotificationActions.flagWrongCategory:
            self = ReviewNotification.transactionID(userInfo).map(Self.flagWrongCategory) ?? .ignore
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

/// Answers a review notification's actions, leaving the transaction's note and
/// category.
struct TransactionReviewMarker: Sendable {
    var data: NestData = .live

    /// Marks the transaction reviewed with the review screen's Looks right write,
    /// which also clears a wrong-category flag.
    func markReviewed(transactionID: String) async throws {
        try await data.call(
            "review_transaction", params: ReviewTransactionParams(transactionId: transactionID),
            invalidating: ["transactions"])
    }

    /// Flags the Up category wrong, leaving the transaction awaiting review.
    func flagWrongCategory(transactionID: String) async throws {
        try await data.call(
            "flag_transaction_category",
            params: FlagTransactionCategoryParams(transactionId: transactionID),
            invalidating: ["transactions"])
    }
}
