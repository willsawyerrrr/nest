import Foundation
import Testing

@testable import Nest

/// Holds the native Breakdowns to the PWA's figures: `breakdowns-parity.json`
/// carries rows and the totals the PWA computes from them. The screen's own
/// assembly (`BreakdownsRows.input`) feeds the bundled engine, and the result must
/// equal them.
@Suite struct BreakdownsParityTests {
    struct Fixture: Decodable, Sendable {
        var name: String
        var rows: BreakdownsRows
        var expected: BreakdownRollups
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "breakdowns-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let rollups = try await engine.summariseBreakdowns(fixture.rows.input)
            #expect(rollups == fixture.expected, "\(fixture.name)")
        }
    }

    @Test func presentationShowsTheEngineTotals() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let content = BreakdownsContent(
                rows: fixture.rows, rollups: try await engine.summariseBreakdowns(fixture.rows.input))
            let presentation = BreakdownsPresentation(content: content)
            #expect(
                presentation.rows.map { [$0.annualCents, $0.fortnightlyCents] }
                    == fixture.expected.totals.map { [$0.annualCents, $0.fortnightlyCents] })
            for row in presentation.rows {
                let detail = try #require(presentation.detail(id: row.id))
                #expect(
                    detail.items.map(\.fortnightlyCents)
                        == fixture.rows.items.filter { $0.breakdownId == row.id }.map { item in
                            fixture.expected.items.first { $0.itemId == item.id }!.fortnightlyCents
                        })
            }
        }
    }
}
