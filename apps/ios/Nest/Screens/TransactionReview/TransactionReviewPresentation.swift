import Foundation

/// One category picker group: a parent and its assignable children.
struct UpCategoryGroup: Equatable, Sendable, Identifiable {
    let name: String
    let items: [UpCategory]
    var id: String { name }
}

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
    var id: String { transaction.id }
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
        var transactions = source.transactions
        if let focused, !transactions.contains(where: { $0.id == focused.id }) {
            transactions.insert(focused, at: 0)
        }
        rows = transactions.map {
            Self.row($0, categories: source.categories, accountName: names[$0.accountId], calendar: calendar)
        }
        focusedID = focused?.id
        groups = Self.groups(source.categories)
        isCapped = source.transactions.count >= TransactionReviewRows.pageSize
    }

    static func row(
        _ transaction: LedgerTransaction, categories: [UpCategory], accountName: String?,
        calendar: Calendar = .current
    ) -> ReviewRow {
        let date = BudgetPresentation.date(
            GiftsPresentation.localDate(transaction.postedAt, calendar: calendar))
        return ReviewRow(
            transaction: transaction,
            title: transaction.description.isEmpty ? "Card purchase" : transaction.description,
            meta: [accountName, date].compactMap { $0 }.joined(separator: " · "),
            category: label(categories, transaction.externalCategory) ?? "Uncategorised",
            pending: transaction.status == "pending",
            reviewed: transaction.reviewedAt != nil,
            categorisable: transaction.isCategorizable == true,
            isGift: transaction.externalCategory == giftCategory,
            upNote: transaction.upNote.flatMap { $0.isEmpty ? nil : $0 },
            upMessage: transaction.upMessage.flatMap { $0.isEmpty ? nil : $0 },
            deepLink: transaction.deepLinkUrl.flatMap(URL.init(string:)))
    }

    /// Up's child categories grouped under their parents, both alphabetical,
    /// leaving out a parent with no children.
    static func groups(_ categories: [UpCategory]) -> [UpCategoryGroup] {
        let byName: (UpCategory, UpCategory) -> Bool = {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        return categories.filter { $0.parentId == nil }.sorted(by: byName).compactMap { parent in
            let items = categories.filter { $0.parentId == parent.id }.sorted(by: byName)
            return items.isEmpty ? nil : UpCategoryGroup(name: parent.name, items: items)
        }
    }

    /// `Parent › Child`, the child alone where its parent is unknown, the id
    /// where the category is unknown, or nil when uncategorised.
    static func label(_ categories: [UpCategory], _ id: String?) -> String? {
        guard let id else { return nil }
        guard let child = categories.first(where: { $0.id == id }) else { return id }
        guard let parent = categories.first(where: { $0.id == child.parentId }) else {
            return child.name
        }
        return "\(parent.name) › \(child.name)"
    }

    /// The picker's label for a chosen category: the child's name.
    static func pickerLabel(_ categories: [UpCategory], _ id: String?) -> String {
        guard let id else { return "Uncategorised" }
        return categories.first { $0.id == id }?.name ?? id
    }

    /// Nest's own copy for a failed review, per code; never the upstream text.
    static func errorMessage(_ code: String?) -> String {
        switch code {
        case "invalid_request": "Nest could not send that change. Try again."
        case "transaction_not_found": "Nest can no longer find this transaction."
        case "not_up_transaction": "Only an Up transaction can be recategorised."
        case "not_categorisable": "Up does not let this transaction be categorised."
        case "unknown_category": "Up does not have that category. Pick another."
        case "parent_category": "Pick a subcategory: Up assigns only those to a transaction."
        case "server_error": "Something went wrong. Try again."
        case "up_not_connected": "Connect Up in Connections to change a category."
        case "up_auth_failed": "Up rejected your token. Reconnect Up in Connections."
        case "up_rate_limited": "Up is busy right now. Try again in a minute."
        case "up_transaction_not_found": "Up has no such transaction for your token."
        case "up_rejected": "Up would not accept that category for this transaction."
        case "up_unavailable": "Up is unavailable right now. Try again shortly."
        case "save_failed": "Saved in Up, but Nest couldn't update its copy. Try again."
        default: "Could not save this review. Try again."
        }
    }

    /// Whether a failure is fixed in Connections, so its message links there.
    static func needsConnections(_ code: String?) -> Bool {
        code == "up_not_connected" || code == "up_auth_failed"
    }
}
