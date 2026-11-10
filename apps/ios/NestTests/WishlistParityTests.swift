import Foundation
import Testing

@testable import Nest

/// Holds the native Wishlist to the PWA: `wishlist-parity.json` carries rows and,
/// for each sort choice, the rows the PWA lists. The screen's presentation must
/// list the same order, owners and amounts.
@Suite struct WishlistParityTests {
    struct Listed: Decodable, Equatable {
        let id: String
        let name: String
        let ownerName: String?
        let note: String?
        let amount: String
    }

    struct Fixture: Decodable {
        struct Expected: Decodable {
            let titleAsc: [Listed]
            let titleDesc: [Listed]
            let amountAsc: [Listed]
            let amountDesc: [Listed]
        }
        let rows: WishlistRows
        let expected: Expected
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "wishlist-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    private func listed(_ key: WishlistSortKey, _ direction: WishlistSortDirection) -> [Listed] {
        WishlistPresentation(
            rows: Self.fixture.rows, sort: WishlistSort(key: key, direction: direction)
        ).rows.map {
            Listed(
                id: $0.id, name: $0.name, ownerName: $0.ownerName, note: $0.note,
                amount: MoneyFormat.cents($0.amountCents))
        }
    }

    @Test func everySortListsWhatThePWAList() {
        let expected = Self.fixture.expected
        #expect(listed(.title, .asc) == expected.titleAsc)
        #expect(listed(.title, .desc) == expected.titleDesc)
        #expect(listed(.amount, .asc) == expected.amountAsc)
        #expect(listed(.amount, .desc) == expected.amountDesc)
    }
}
