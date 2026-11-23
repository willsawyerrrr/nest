import Foundation
import Testing

@testable import Nest

/// Holds the native Accounts screen to the PWA: `accounts-parity.json` carries rows and
/// the type groups the PWA lists. The screen's presentation must list the same groups,
/// totals, labels, owners, sources, balances and badges.
@Suite struct AccountsParityTests {
    struct Listed: Decodable, Equatable {
        let id: String
        let emoji: String?
        let label: String
        let owner: String
        let source: String
        let balance: String
        let deleted: Bool
        let excluded: Bool
    }

    struct Group: Decodable, Equatable {
        let label: String
        let total: String
        let accounts: [Listed]
    }

    struct Fixture: Decodable {
        let rows: AccountsRows
        let expected: [Group]
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "accounts-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test func listsWhatThePWALists() {
        let groups = AccountsPresentation(rows: Self.fixture.rows).groups.map { group in
            Group(
                label: group.label, total: MoneyFormat.cents(group.totalCents),
                accounts: group.rows.map {
                    Listed(
                        id: $0.id, emoji: $0.emoji, label: $0.label, owner: $0.owner,
                        source: $0.source, balance: MoneyFormat.cents($0.balanceCents),
                        deleted: $0.isDeleted, excluded: $0.isExcluded)
                })
        }
        #expect(groups == Self.fixture.expected)
    }
}
