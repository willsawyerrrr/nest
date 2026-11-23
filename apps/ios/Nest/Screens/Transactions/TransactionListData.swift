import Foundation

/// What narrows the transactions list, as the PWA's `TransactionFilters`; nil
/// leaves that dimension unfiltered.
struct TransactionFilters: Equatable, Hashable, Sendable {
    /// An account id.
    var account: String?
    /// The first local date included (`yyyy-MM-dd`).
    var from: String?
    /// The last local date included (`yyyy-MM-dd`).
    var to: String?
    /// `income`, `expense` or `transfer`.
    var kind: String?
    /// `pending` or `settled`.
    var status: String?
    /// An Up category id (a parent matches its children too), or `uncategorised`.
    var category: String?

    /// The category value matching transactions with no category.
    static let uncategorised = "none"

    /// Whether any filter narrows the list.
    var isActive: Bool { self != TransactionFilters() }

    /// The PostgREST filters for these, as the PWA's `useTransactionList` builds
    /// them: dates are local days compared against `posted_at` from local
    /// midnight, `to` including all of its day.
    func query(calendar: Calendar = .current) -> [Filter] {
        var filters: [Filter] = []
        if let account { filters.append(.eq("account_id", account)) }
        if let from, let start = Self.dayStart(from, offset: 0, calendar: calendar) {
            filters.append(.gte("posted_at", start))
        }
        if let to, let end = Self.dayStart(to, offset: 1, calendar: calendar) {
            filters.append(.lt("posted_at", end))
        }
        if let kind { filters.append(.eq("kind", kind)) }
        if let status { filters.append(.eq("status", status)) }
        if category == Self.uncategorised {
            filters.append(.isNull("external_category"))
        } else if let category {
            filters.append(
                .or("external_category.eq.\(category),external_parent_category.eq.\(category)"))
        }
        return filters
    }

    /// The UTC instant (`2026-11-19T13:00:00.000Z`) the local day `offset` days
    /// after `iso` begins, as the PWA's `localDayStart`.
    static func dayStart(_ iso: String, offset: Int, calendar: Calendar) -> String? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
            let day = calendar.date(
                from: DateComponents(year: parts[0], month: parts[1], day: parts[2] + offset))
        else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: day)
    }
}

/// Every row the transactions list reads, as the PWA's `TransactionsSection`.
struct TransactionListRows: Codable, Sendable, Equatable {
    /// The loaded pages of matching transactions, newest first.
    var transactions: [LedgerTransaction] = []
    var categories: [UpCategory] = []
    var accounts: [AccountDirectoryEntry] = []
    var members: [Member] = []
    /// The deductions created from a transaction, naming the transactions that already have one.
    var deductions: [Deduction] = []

    /// How many transactions a page holds.
    static let pageSize = 50

    /// Newest first by the date the payment was made, ties broken by id so pages never overlap.
    static let order = [
        Order(column: "posted_at", ascending: false), Order(column: "id", ascending: false),
    ]

    /// The tables behind the list, reading the first `pages` pages of
    /// transactions matching `filters`. Transactions and deductions skip the row
    /// cache, as on the review screen: row-level security can withdraw one between
    /// reads, and a review made elsewhere must not linger.
    static func sources(
        filters: TransactionFilters, pages: Int, calendar: Calendar = .current
    ) -> [TableSource<TransactionListRows>] {
        [
            .table(
                LedgerTransaction.self, filters: filters.query(calendar: calendar), order: order,
                limit: pages * pageSize, cached: false
            ) { $0.transactions = $1 },
            .table(UpCategory.self) { $0.categories = $1 },
            .table(AccountDirectoryEntry.self, order: [Order(column: "name")]) { $0.accounts = $1 },
            .table(Member.self) { $0.members = $1 },
            .table(Deduction.self, filters: [.notNull("transaction_id")], cached: false) {
                $0.deductions = $1
            },
        ]
    }
}
