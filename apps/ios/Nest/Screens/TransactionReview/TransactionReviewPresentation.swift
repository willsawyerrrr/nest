import Foundation

/// One transaction as the review screen lists it.
struct ReviewRow: Equatable, Sendable, Identifiable {
    let transaction: LedgerTransaction
    /// Description, falling back to a generic label for an unnamed one.
    let title: String
    /// Account and local date, e.g. `Spending · 20 Nov 2026`.
    let meta: String
    /// `Parent › Child`, or `Uncategorised`.
    let category: String
    let pending: Bool
    let reviewed: Bool
    let categorisable: Bool
    /// Whether the transaction already sits in the Gifts inbox's category.
    let isGift: Bool
    let upNote: String?
    let upMessage: String?
    let deepLink: URL?
    /// Whether a deduction was already created from the transaction.
    let hasDeduction: Bool
    var id: String { transaction.id }

    /// The deduction form's prefill, offered for an outflow with no deduction yet.
    var deductionDraft: TransactionDeductionDraft? {
        transaction.amountCents < 0 && !hasDeduction
            ? TransactionDeductionDraft(transaction: transaction) : nil
    }
}

/// The review screen's figures and copy, mirroring the PWA's
/// `lib/transactionReview.ts` and `TransactionReviewScreen`.
struct TransactionReviewPresentation: Equatable, Sendable {
    /// The category "It's a gift" files a transaction under.
    static let giftCategory = GiftsRows.transactionCategory

    /// Every row, the focused transaction first when the list does not hold it.
    let rows: [ReviewRow]
    /// The focused transaction's id, which starts expanded.
    let focusedID: String?
    let groups: [UpCategoryGroup]
    /// Whether the list reached its page size, so older transactions wait.
    let isCapped: Bool

    init(rows source: TransactionReviewRows, calendar: Calendar = .current) {
        let names = Dictionary(
            source.accounts.compactMap { account in
                account.id.map { ($0, accountLabel(account.name ?? "")) }
            }, uniquingKeysWith: { first, _ in first })
        let focused = source.focused.first
        let deducted = Set(source.deductions.compactMap(\.transactionId))
        var transactions = source.transactions
        if let focused, !transactions.contains(where: { $0.id == focused.id }) {
            transactions.insert(focused, at: 0)
        }
        rows = transactions.map {
            Self.row(
                $0, categories: source.categories, accountName: names[$0.accountId],
                hasDeduction: deducted.contains($0.id), calendar: calendar)
        }
        focusedID = focused?.id
        groups = UpCategories.groups(source.categories)
        isCapped = source.transactions.count >= TransactionReviewRows.pageSize
    }

    static func row(
        _ transaction: LedgerTransaction, categories: [UpCategory], accountName: String?,
        hasDeduction: Bool = false, calendar: Calendar = .current
    ) -> ReviewRow {
        let date = BudgetPresentation.date(
            GiftsPresentation.localDate(transaction.postedAt, calendar: calendar))
        return ReviewRow(
            transaction: transaction,
            title: transaction.description.isEmpty ? "Card purchase" : transaction.description,
            meta: [accountName, date].compactMap { $0 }.joined(separator: " · "),
            category: UpCategories.label(categories, transaction.externalCategory) ?? "Uncategorised",
            pending: transaction.status == "pending",
            reviewed: transaction.reviewedAt != nil,
            categorisable: transaction.isCategorizable == true,
            isGift: transaction.externalCategory == giftCategory,
            upNote: transaction.upNote.flatMap { $0.isEmpty ? nil : $0 },
            upMessage: transaction.upMessage.flatMap { $0.isEmpty ? nil : $0 },
            deepLink: transaction.deepLinkUrl.flatMap(URL.init(string:)),
            hasDeduction: hasDeduction)
    }
}
