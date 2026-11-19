import Foundation

/// Every row the HELP debt screen reads.
struct HelpDebtRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var helpDebts: [HelpDebt] = []

    /// Members ordered by name and every member's standing HELP debt, as the PWA reads them.
    static let sources: [TableSource<HelpDebtRows>] = [
        .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
        .table(HelpDebt.self) { $0.helpDebts = $1 },
    ]

    /// The household a balance belongs to (every member row shares it).
    var householdID: String? { members.first?.householdId }
}

/// A `help_debt` upsert body: one member's standing balance, keyed by member.
struct HelpDebtUpsert: Encodable, Equatable, Sendable {
    let householdID: String
    let memberID: String
    let balanceCents: Int

    static let onConflict = "member_id"

    enum CodingKeys: String, CodingKey {
        case householdID = "household_id"
        case memberID = "member_id"
        case balanceCents = "balance_cents"
    }
}
