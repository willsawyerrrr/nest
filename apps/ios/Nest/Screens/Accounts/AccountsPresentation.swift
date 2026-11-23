import Foundation

extension AccountType {
    /// The human label, as the PWA's `accountTypeLabel`; `transaction` is Up's Spending account.
    var label: String {
        switch self {
        case .transaction: "Spending"
        case .savings: "Savings"
        case .offset: "Offset"
        case .credit: "Credit"
        case .homeLoan: "Home loan"
        case .other: "Other"
        }
    }

    /// Display order, as the PWA's `ACCOUNT_TYPE_ORDER`: everyday money, then debts, then the rest.
    static let displayOrder: [AccountType] = [.transaction, .savings, .offset, .credit, .homeLoan, .other]
}

extension LedgerSource {
    /// The human label, as the PWA's `ledgerSourceLabel`.
    var label: String {
        switch self {
        case .up: "Up"
        case .redbark: "Redbark"
        case .manual: "Manual"
        }
    }
}

/// One account as listed.
struct AccountListRow: Equatable, Identifiable, Sendable {
    let id: String
    /// The name without its leading emoji.
    let label: String
    /// The Up icon, when the name carries one.
    let emoji: String?
    /// The owner's name, or `Joint`.
    let owner: String
    let source: String
    let balanceCents: Int
    let isDeleted: Bool
    let isExcluded: Bool
}

/// A run of accounts of one type, with the sum of their balances.
struct AccountTypeGroup: Equatable, Identifiable, Sendable {
    let type: AccountType
    let rows: [AccountListRow]
    let totalCents: Int

    var id: AccountType { type }
    var label: String { type.label }
}

/// Pure presentation of the Accounts screen, mirroring the PWA's `AccountsScreen`.
struct AccountsPresentation: Equatable, Sendable {
    static let title = "Accounts"
    static let intro =
        "Every account you can see, with its owner and balance. Choose which count toward net worth on the Net worth tab."
    static let emptyMessage = "No accounts yet. Connect a bank on the Connections tab."

    /// The accounts grouped by type in display order, keeping name order within a
    /// group and omitting empty types; each total counts every balance in it.
    let groups: [AccountTypeGroup]

    init(rows: AccountsRows) {
        let listed = rows.accounts.compactMap { account -> (AccountType, AccountListRow)? in
            guard let id = account.id, let name = account.name, let type = account.type,
                let source = account.source
            else { return nil }
            let owner = account.ownerMemberId.map { id in
                rows.members.first { $0.id == id }?.name ?? "Unknown"
            }
            return (
                type,
                AccountListRow(
                    id: id, label: accountLabel(name), emoji: SplitsPresentation.emoji(of: name),
                    owner: owner ?? "Joint", source: source.label,
                    balanceCents: account.balanceCents ?? 0,
                    isDeleted: account.deletedFromSourceAt != nil,
                    isExcluded: account.excludeFromNetWorth ?? false))
        }
        groups = AccountType.displayOrder.compactMap { type in
            let inType = listed.filter { $0.0 == type }.map(\.1)
            guard !inType.isEmpty else { return nil }
            return AccountTypeGroup(
                type: type, rows: inType, totalCents: inType.reduce(0) { $0 + $1.balanceCents })
        }
    }
}
