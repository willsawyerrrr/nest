import Foundation

/// One transaction as the list shows it: the review screen's row, and whose it is.
struct TransactionListRow: Equatable, Sendable, Identifiable {
    let review: ReviewRow
    /// The account owner's name, or `Joint`.
    let attribution: String
    let isTransfer: Bool
    var id: String { review.id }
}

/// One choice in a filter menu.
struct FilterOption: Equatable, Hashable, Sendable {
    let value: String
    let label: String
}

/// A filter menu's choices under an optional section heading.
struct FilterOptionGroup: Equatable, Sendable, Identifiable {
    let name: String?
    let options: [FilterOption]
    var id: String { name ?? "" }
}

/// The transactions list's rows and filter choices, mirroring the PWA's
/// `lib/transactionList.ts` and `TransactionListScreen`.
struct TransactionListPresentation: Equatable, Sendable {
    let rows: [TransactionListRow]
    /// The review form's category groups.
    let groups: [UpCategoryGroup]
    let accountOptions: [FilterOption]
    let categoryOptions: [FilterOptionGroup]
    /// Whether an older page may remain.
    let hasMore: Bool

    static let kindOptions = [
        FilterOption(value: "expense", label: "Expense"),
        FilterOption(value: "income", label: "Income"),
        FilterOption(value: "transfer", label: "Transfer"),
    ]

    static let statusOptions = [
        FilterOption(value: "pending", label: "Pending"),
        FilterOption(value: "settled", label: "Settled"),
    ]

    init(rows source: TransactionListRows, hasMore: Bool, calendar: Calendar = .current) {
        let accounts = source.accounts.compactMap { account in
            account.id.map { FilterOption(value: $0, label: accountLabel(account.name ?? "")) }
        }
        let names = Dictionary(
            accounts.map { ($0.value, $0.label) }, uniquingKeysWith: { first, _ in first })
        let deducted = Set(source.deductions.compactMap(\.transactionId))
        rows = source.transactions.map { transaction in
            TransactionListRow(
                review: TransactionReviewPresentation.row(
                    transaction, categories: source.categories,
                    accountName: names[transaction.accountId],
                    hasDeduction: deducted.contains(transaction.id), calendar: calendar),
                attribution: Self.attribution(source.members, transaction),
                isTransfer: transaction.kind == "transfer")
        }
        groups = UpCategories.groups(source.categories)
        accountOptions = accounts
        categoryOptions = Self.categoryOptions(source.categories)
        self.hasMore = hasMore
    }

    /// Who a transaction belongs to: its account owner's name, or `Joint` for a
    /// joint account's, naming the partner who made it where Up records one.
    static func attribution(_ members: [Member], _ transaction: LedgerTransaction) -> String {
        if let memberID = transaction.memberId {
            return members.first { $0.id == memberID }?.name ?? "Unknown"
        }
        if let name = transaction.performingCustomerName, !name.isEmpty {
            return "Joint · \(name)"
        }
        return "Joint"
    }

    /// The category filter's choices: `Uncategorised`, then each Up parent
    /// category (matching all of its children) followed by its children, both
    /// alphabetical.
    static func categoryOptions(_ categories: [UpCategory]) -> [FilterOptionGroup] {
        let byName: (UpCategory, UpCategory) -> Bool = {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        let parents = categories.filter { $0.parentId == nil }.sorted(by: byName)
        return [
            FilterOptionGroup(
                name: nil,
                options: [FilterOption(value: TransactionFilters.uncategorised, label: "Uncategorised")])
        ]
            + parents.map { parent in
                FilterOptionGroup(
                    name: parent.name,
                    options: [FilterOption(value: parent.id, label: "All \(parent.name)")]
                        + categories.filter { $0.parentId == parent.id }.sorted(by: byName).map {
                            FilterOption(value: $0.id, label: $0.name)
                        })
            }
    }
}
