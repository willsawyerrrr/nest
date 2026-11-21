import Foundation

/// Every row the transaction review screen reads, as the PWA's
/// `useTransactionReview` and `useAccountDirectory` read them.
struct TransactionReviewRows: Codable, Sendable, Equatable {
    /// The unreviewed categorisable Up transactions, newest first.
    var transactions: [LedgerTransaction] = []
    /// The transaction `?id=` names, reviewed or not; empty when none is named or visible.
    var focused: [LedgerTransaction] = []
    var categories: [UpCategory] = []
    var accounts: [AccountDirectoryEntry] = []

    /// The most unreviewed transactions read at once, newest first.
    static let pageSize = 100

    /// The tables behind the screen. Transactions skip the row cache, as on
    /// Gifts: row-level security can withdraw one between reads, and a review
    /// made elsewhere must not linger. `focusID` adds a read of that one
    /// transaction when it is a uuid.
    static func sources(focusID: String?) -> [TableSource<TransactionReviewRows>] {
        var sources: [TableSource<TransactionReviewRows>] = [
            .table(
                LedgerTransaction.self,
                filters: [.eq("source", "up"), .eq("is_categorizable", "true"), .isNull("reviewed_at")],
                order: [Order(column: "posted_at", ascending: false)], limit: pageSize,
                cached: false
            ) { $0.transactions = $1 },
            .table(UpCategory.self) { $0.categories = $1 },
            .table(AccountDirectoryEntry.self, order: [Order(column: "name")]) { $0.accounts = $1 },
        ]
        if let focusID = validFocusID(focusID) {
            sources.append(
                .table(LedgerTransaction.self, filters: [.eq("id", focusID)], cached: false) {
                    $0.focused = $1
                })
        }
        return sources
    }

    /// `id` when it is a uuid, so a malformed link reads nothing.
    static func validFocusID(_ id: String?) -> String? {
        guard let id, UUID(uuidString: id) != nil else { return nil }
        return id.lowercased()
    }
}
