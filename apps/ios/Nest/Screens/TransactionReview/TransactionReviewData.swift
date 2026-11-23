import Foundation

/// Every row the transaction review screen reads, as the PWA's
/// `useTransactionReview` and `useAccountDirectory` read them.
struct TransactionReviewRows: Codable, Sendable, Equatable {
    /// The unreviewed Up transactions awaiting review, newest first.
    var transactions: [LedgerTransaction] = []
    /// The transaction `?id=` names, reviewed or not; empty when none is named or visible.
    var focused: [LedgerTransaction] = []
    var categories: [UpCategory] = []
    var accounts: [AccountDirectoryEntry] = []
    /// The deductions created from a transaction, naming the transactions that already have one.
    var deductions: [Deduction] = []

    /// The most unreviewed transactions read at once, newest first.
    static let pageSize = 100

    /// The Up transactions awaiting review: unreviewed, and either categorisable or an
    /// incoming transfer from outside the household's own accounts (income of type
    /// Transfer), row-level security scoping them to the member's balance-visible
    /// accounts.
    static let awaitingReview: [Filter] = [
        .eq("source", "up"),
        .or("is_categorizable.eq.true,and(kind.eq.income,transaction_type.eq.Transfer)"),
        .isNull("reviewed_at"),
    ]

    /// The tables behind the screen. Transactions skip the row cache, as on
    /// Gifts: row-level security can withdraw one between reads, and a review
    /// made elsewhere must not linger. `focusID` adds a read of that one
    /// transaction when it is a uuid.
    static func sources(focusID: String?) -> [TableSource<TransactionReviewRows>] {
        var sources: [TableSource<TransactionReviewRows>] = [
            .table(
                LedgerTransaction.self,
                filters: awaitingReview,
                order: [Order(column: "posted_at", ascending: false)], limit: pageSize,
                cached: false
            ) { $0.transactions = $1 },
            .table(UpCategory.self) { $0.categories = $1 },
            .table(AccountDirectoryEntry.self, order: [Order(column: "name")]) { $0.accounts = $1 },
            .table(Deduction.self, filters: [.notNull("transaction_id")], cached: false) {
                $0.deductions = $1
            },
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
