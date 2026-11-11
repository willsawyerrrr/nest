import Foundation
import Testing

@testable import Nest

/// Holds the native Members screen to the PWA: `members-parity.json` carries rows and
/// what `TaxProfileList` shows for each member.
@Suite struct MembersParityTests {
    struct Listed: Decodable, Equatable {
        let id: String
        let name: String
        let residency: String
        let hospitalCover: Bool
        let dateOfBirth: String
    }

    struct Fixture: Decodable {
        let rows: MembersRows
        let expected: [Listed]
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "members-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test func theRowsListWhatThePWAList() {
        let listed = MembersPresentation(rows: Self.fixture.rows, financialYear: 2027).rows.map {
            Listed(
                id: $0.id, name: $0.name, residency: $0.residencyLabel,
                hospitalCover: $0.hasHospitalCover, dateOfBirth: $0.dateOfBirthLabel)
        }
        #expect(listed == Self.fixture.expected)
    }
}
