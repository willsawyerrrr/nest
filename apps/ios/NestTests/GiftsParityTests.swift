import Foundation
import Testing

@testable import Nest

/// Holds the native Gifts screen to the PWA's figures: `gifts-parity.json`
/// carries rows and what the PWA computes from them.
@Suite struct GiftsParityTests {
    struct Expected: Decodable, Sendable {
        var occasionGroups: [GiftGroup]
        var personGroups: [GiftGroup]
        var overall: GiftTotals
        var discretionary: GiftTotals
        var unassignedCents: Int
        var candidates: [GiftCandidate]
        var dismissed: [GiftCandidate]
        var linkChoices: [GiftLinkRecipient]
    }

    struct Fixture: Decodable, Sendable {
        var name: String
        var currentMemberId: String?
        var rows: GiftsRows
        var expected: Expected
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "gifts-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    @Test func presentationMatchesThePWAFigures() {
        for fixture in Self.fixtures {
            let presentation = GiftsContent(
                rows: fixture.rows, currentMemberID: fixture.currentMemberId
            ).presentation
            let expected = fixture.expected
            #expect(presentation.groups(by: .occasion) == expected.occasionGroups, "\(fixture.name)")
            #expect(presentation.groups(by: .person) == expected.personGroups, "\(fixture.name)")
            #expect(presentation.overall == expected.overall, "\(fixture.name)")
            #expect(presentation.discretionaryTotals == expected.discretionary)
            #expect(presentation.unassignedSpentCents == expected.unassignedCents)
            #expect(presentation.candidates == expected.candidates)
            #expect(presentation.dismissed == expected.dismissed)
            #expect(presentation.linkChoices == expected.linkChoices)
        }
    }
}
