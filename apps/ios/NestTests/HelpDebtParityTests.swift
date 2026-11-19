import Foundation
import Testing

@testable import Nest

/// Holds the native HELP debt screen to the PWA: `help-debt-parity.json` carries rows, what
/// `HelpDebtScreen` shows for each member, and the cents a typed balance saves as.
@Suite struct HelpDebtParityTests {
    struct Listed: Decodable, Equatable {
        let id: String
        let name: String
        let balance: String
        let input: String
    }

    struct Typed: Decodable {
        let text: String
        let cents: Int
    }

    struct Fixture: Decodable {
        let rows: HelpDebtRows
        let expected: [Listed]
        let typed: [Typed]
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "help-debt-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test func theRowsListWhatThePWAList() {
        let listed = HelpDebtPresentation(rows: Self.fixture.rows).rows.map {
            Listed(
                id: $0.id, name: $0.name, balance: $0.balanceLabel,
                input: HelpDebtPresentation.input($0.storedCents))
        }
        #expect(listed == Self.fixture.expected)
    }

    @Test func aTypedBalanceSavesWhatThePWASaves() {
        for typed in Self.fixture.typed {
            #expect(HelpDebtPresentation.cents(fromDollars: typed.text) == typed.cents, "\(typed.text)")
        }
    }
}
