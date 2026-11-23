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

/// What the review notification's category picker offers for one transaction.
struct RecategoriseChoices: Equatable, Sendable {
    let groups: [UpCategoryGroup]
    /// The transaction's Up category, nil when uncategorised.
    let currentID: String?
    /// `Parent › Child`, or `Uncategorised`.
    let currentLabel: String
    let categorisable: Bool
}

/// Changes a transaction's Up category from its review notification, with the
/// writes the review screen makes, over plain `SupabaseAPI` calls so the
/// notification content extension can run it outside the app.
struct NotificationRecategoriser: Sendable {
    var api: SupabaseAPI = .live

    /// The categories to offer and the transaction's current one. Throws
    /// `NestError(.notFound)` when the member cannot see the transaction.
    func choices(transactionID: String) async throws -> RecategoriseChoices {
        async let transactions = api.select(
            LedgerTransaction.self, filters: [.eq("id", transactionID)], limit: 1)
        async let categories = api.select(UpCategory.self)
        guard let transaction = try await transactions.first else { throw NestError(.notFound) }
        let all = try await categories
        return RecategoriseChoices(
            groups: UpCategories.groups(all),
            currentID: transaction.externalCategory,
            currentLabel: UpCategories.label(all, transaction.externalCategory) ?? "Uncategorised",
            categorisable: transaction.isCategorizable == true)
    }

    /// Marks the transaction reviewed, leaving its note, setting its Up
    /// category through `up-categorise` first when `category` changes it. Any
    /// failed change, `save_failed` included, leaves it unreviewed, as on the
    /// review screen.
    func review(transactionID: String, category: ReviewCategory) async -> ReviewOutcome {
        if case .set(let categoryID) = category {
            do {
                let _: SupabaseAPI.Ignored = try await api.invoke(
                    "up-categorise",
                    body: UpCategoriseBody(transactionId: transactionID, categoryId: categoryID))
            } catch {
                return .failed(code: (error as? NestError)?.upstreamCode)
            }
        }
        do {
            try await api.call(
                "review_transaction", params: ReviewTransactionParams(transactionId: transactionID))
        } catch {
            return .failed(code: nil)
        }
        return .saved
    }
}
