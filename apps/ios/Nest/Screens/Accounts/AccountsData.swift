import Foundation

/// Every row the Accounts screen reads.
struct AccountsRows: Codable, Sendable, Equatable {
    var accounts: [AccountWithBalance] = []
    var members: [Member] = []

    /// The accounts and members ordered by name, as the PWA's hooks read them.
    static var sources: [TableSource<AccountsRows>] {
        [
            .table(AccountWithBalance.self, order: [Order(column: "name")]) { $0.accounts = $1 },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
        ]
    }
}
