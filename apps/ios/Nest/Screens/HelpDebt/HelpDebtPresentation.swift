import Foundation

/// One member's standing HELP balance as listed.
struct HelpDebtRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    /// The stored balance; `nil` for a member with no row.
    let storedCents: Int?

    /// The balance shown; `0` for a member with no row.
    var balanceCents: Int { storedCents ?? 0 }

    /// `$12,345.67`.
    var balanceLabel: String { MoneyFormat.cents(balanceCents) }
}

/// Pure presentation of the HELP debt screen, mirroring `HelpDebtScreen`.
struct HelpDebtPresentation: Equatable, Sendable {
    static let title = "HELP debt"
    static let intro =
        "Each member’s outstanding HELP/HECS balance. It drives the compulsory repayment on the Tax tab and counts against household net worth as a liability."
    static let saveError = "Could not save this HELP balance. Please try again."

    let rows: [HelpDebtRow]

    init(rows source: HelpDebtRows) {
        rows = source.members.map { member in
            HelpDebtRow(
                id: member.id, name: member.name,
                storedCents: source.helpDebts.first { $0.memberId == member.id }?.balanceCents)
        }
    }

    /// The editor's starting text: `12,345.67`, as the PWA's `MoneyInput` shows it; empty
    /// for a member with no row.
    static func input(_ cents: Int?) -> String {
        guard let cents else { return "" }
        return (Decimal(cents) / 100).formatted(
            .number.precision(.fractionLength(2)).locale(Locale(identifier: "en_AU")))
    }

    /// Integer cents from typed dollars; empty, unreadable or negative input saves as zero,
    /// as the PWA's `MoneyInput` (`min={0}`) and `dollarsToCents(…) ?? 0` do.
    static func cents(fromDollars text: String) -> Int {
        TaxPresentation.cents(fromDollars: text)
    }
}
