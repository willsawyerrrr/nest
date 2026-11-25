import Foundation

/// The transaction a review notification asks about.
enum ReviewNotification {
    /// The payload's `transactionId`, lower-cased, when it is a uuid.
    static func transactionID(_ userInfo: [AnyHashable: Any]) -> String? {
        guard let id = userInfo["transactionId"] as? String, UUID(uuidString: id) != nil else {
            return nil
        }
        return id.lowercased()
    }
}

/// What the expanded review notification shows of its transaction.
struct ReviewNotificationSummary: Equatable, Sendable {
    /// `Parent › Child`, or `Uncategorised`.
    let category: String
    let reviewed: Bool
    /// Whether a member flagged the category wrong and it awaits a fix.
    let flaggedWrong: Bool
}

/// Reads a review notification's transaction over plain `SupabaseAPI` calls, so
/// the notification content extension can run it outside the app.
struct ReviewNotificationLoader: Sendable {
    var api: SupabaseAPI = .live

    /// The transaction's current Up category and review state. Throws
    /// `NestError(.notFound)` when the member cannot see the transaction.
    func summary(transactionID: String) async throws -> ReviewNotificationSummary {
        async let transactions = api.select(
            LedgerTransaction.self, filters: [.eq("id", transactionID)], limit: 1)
        async let categories = api.select(UpCategory.self)
        guard let transaction = try await transactions.first else { throw NestError(.notFound) }
        let reviewed = transaction.reviewedAt != nil
        return ReviewNotificationSummary(
            category: UpCategories.label(try await categories, transaction.externalCategory)
                ?? "Uncategorised",
            reviewed: reviewed,
            flaggedWrong: !reviewed && transaction.categoryFlaggedWrongAt != nil)
    }
}
