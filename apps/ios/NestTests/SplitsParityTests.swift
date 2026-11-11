import Foundation
import Testing

@testable import Nest

/// Holds the native Pay splits screen to the PWA's figures: `splits-parity.json`
/// carries a household's rows and the routing, rounding, drift and grouping the
/// PWA's Splits code produces from them. The screen's own assembly
/// (`SplitsRows.input`) feeds the bundled engine and `SplitsPresentation`, and
/// the result must equal them.
@Suite struct SplitsParityTests {
    struct ExpectedRow: Decodable, Equatable {
        var accountId: String
        var label: String
        var exactCents: Int
        var roundedCents: Int
        var configuredCents: Int?
        var needsUpdate: Bool
        var lines: [PaySplitRoutes.Line]
    }

    struct Expected: Decodable {
        var payAccountId: String?
        var routes: PaySplitRoutes
        var recommended: [ExpectedRow]
        var stays: [ExpectedRow]
    }

    struct Fixture: Decodable, Sendable {
        var name: String
        var rows: SplitsRows
        var expected: Expected
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "splits-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private static func expectedRows(_ rows: [SplitRow]) -> [ExpectedRow] {
        rows.map {
            ExpectedRow(
                accountId: $0.id, label: $0.label, exactCents: $0.exactCents,
                roundedCents: $0.roundedCents, configuredCents: $0.configuredCents,
                needsUpdate: $0.needsUpdate, lines: $0.lines)
        }
    }

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let routes = try await engine.paySplitRoutes(fixture.rows.input)
            #expect(routes == fixture.expected.routes, "\(fixture.name)")

            let presentation = SplitsPresentation(
                content: SplitsContent(rows: fixture.rows, routes: routes))
            #expect(presentation.payAccountId == fixture.expected.payAccountId)
            #expect(
                Self.expectedRows(presentation.recommended) == fixture.expected.recommended,
                "\(fixture.name)")
            #expect(
                Self.expectedRows(presentation.stays) == fixture.expected.stays, "\(fixture.name)")
        }
    }

    @Test func theFirstHouseholdFlagsDriftAndOffersTheChooser() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        let rows = Self.fixtures[0].rows
        let presentation = SplitsPresentation(
            content: SplitsContent(rows: rows, routes: try await engine.paySplitRoutes(rows.input)))
        #expect(presentation.rowsToUpdate == 2)
        #expect(presentation.staysTitle == "Stays in your pay account")
        #expect(presentation.spendingAccounts.map(\.label) == ["Bills", "Spending"])
        #expect(presentation.unassignedCents == 6_000)
        // The super-linked account never appears as a split target.
        #expect(!presentation.recommended.contains { $0.label == "Super" })
    }
}
