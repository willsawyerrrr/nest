import Foundation

/// Every row the Gifts screen reads, in the order the PWA's hooks read them.
struct GiftsRows: Codable, Sendable, Equatable {
    var recipients: [GiftRecipient] = []
    var occasions: [GiftOccasion] = []
    var budgets: [GiftBudget] = []
    var purchases: [GiftPurchase] = []
    var discretionaryBudgets: [GiftDiscretionaryBudget] = []
    var transactions: [GiftTransaction] = []
    var dismissals: [GiftTransactionDismissal] = []
    var members: [Member] = []

    /// The Up category the gift inbox is built from.
    static let transactionCategory = "gifts-and-charity"

    /// Purchases and transactions are the tables row-level security withholds
    /// from a member (a purchase for their own gift, a transaction claimed as
    /// one), and what it withholds changes without the device being told, so
    /// both skip the row cache: only a fresh read is ever shown.
    static var sources: [TableSource<GiftsRows>] {
        [
            .table(GiftRecipient.self, order: [Order(column: "name")]) { $0.recipients = $1 },
            .table(
                GiftOccasion.self,
                order: [Order(column: "occasion_date"), Order(column: "name")]
            ) { $0.occasions = $1 },
            .table(GiftBudget.self) { $0.budgets = $1 },
            .table(GiftPurchase.self, order: [Order(column: "purchased_on")], cached: false) {
                $0.purchases = $1
            },
            .table(GiftDiscretionaryBudget.self) { $0.discretionaryBudgets = $1 },
            .table(
                GiftTransaction.self,
                filters: [.eq("external_category", transactionCategory)],
                order: [Order(column: "posted_at", ascending: false)], cached: false
            ) { $0.transactions = $1 },
            .table(GiftTransactionDismissal.self) { $0.dismissals = $1 },
            .table(Member.self) { $0.members = $1 },
        ]
    }

    /// The household's single ad hoc buffer row, or nil before its first edit.
    var discretionaryBudget: GiftDiscretionaryBudget? { discretionaryBudgets.first }

    /// The rows the signed-in member may see, whatever the device was handed.
    ///
    /// Row-level security already withholds a purchase for the member's own gift
    /// (a budget for a recipient linked to them, or an ad hoc purchase tagged to
    /// that recipient) and any transaction claimed as one. This drops them again
    /// here, with the dismissals pointing at them, so nothing the server would
    /// hide can reach the view model, the figures or the presentation, even
    /// through a stale response.
    func visible(to memberID: String?) -> GiftsRows {
        guard let memberID else { return self }
        let ownRecipients = Set(recipients.filter { $0.memberId == memberID }.map(\.id))
        let ownBudgets = Set(budgets.filter { ownRecipients.contains($0.recipientId) }.map(\.id))
        var rows = self
        let hidden = purchases.filter {
            $0.giftBudgetId.map(ownBudgets.contains) == true
                || $0.recipientId.map(ownRecipients.contains) == true
        }
        let hiddenTransactions = Set(hidden.compactMap(\.transactionId))
        let hiddenIDs = Set(hidden.map(\.id))
        rows.purchases = purchases.filter { !hiddenIDs.contains($0.id) }
        rows.transactions = transactions.filter { !hiddenTransactions.contains($0.id) }
        rows.dismissals = dismissals.filter { !hiddenTransactions.contains($0.transactionId) }
        return rows
    }

    /// Budget ids whose gift is for `memberID`: their spend is hidden from them.
    func hiddenBudgetIDs(for memberID: String?) -> Set<String> {
        guard let memberID else { return [] }
        let own = Set(recipients.filter { $0.memberId == memberID }.map(\.id))
        return Set(budgets.filter { own.contains($0.recipientId) }.map(\.id))
    }
}
