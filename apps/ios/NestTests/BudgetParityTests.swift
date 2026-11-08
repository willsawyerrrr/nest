import Foundation
import Testing

@testable import Nest

/// Holds the native Budget and Allowance screens to the PWA's figures:
/// `budget-parity.json` carries a household's rows and the figures the PWA's
/// Budget code produces from them. The screen's own assembly
/// (`BudgetRows.input`) feeds the bundled engine, and the result must equal them.
@Suite struct BudgetParityTests {
    struct Fixture: Decodable, Sendable {
        var name: String
        var now: String
        var rows: BudgetRows
        var expected: EngineParityTests.JSONValue
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "budget-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private static func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let input = fixture.rows.input(now: Self.date(fixture.now))
            let output = try await engine.call(.budgetOverview, json: JSONEncoder().encode(input))
            #expect(
                try JSONDecoder().decode(EngineParityTests.JSONValue.self, from: output)
                    == fixture.expected, "\(fixture.name)")
        }
    }

    @Test func thePresentationListsTheSameSubtotalsAndSplitsTheAllowance() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        let fixture = Self.fixtures[0]
        let now = Self.date(fixture.now)
        let overview = try await engine.budgetOverview(fixture.rows.input(now: now))
        let content = BudgetContent(
            rows: fixture.rows, overview: overview, currentMemberID: "m1", now: now)
        let presentation = BudgetPresentation(content: content)

        #expect(presentation.groups.map(\.subtotalCents) == [110_769, 5_000, 48_692, 30_000, 23_077])
        // Coffee is drawn from Ada's allowance, so it is on her Allowance screen.
        #expect(presentation.groups[2].lines.map(\.name) == ["Gym"])
        #expect(presentation.drawnLines.map(\.name) == ["Coffee"])
        #expect(presentation.ownAllowance?.drawnCents == 40_00)
        #expect(presentation.ownAllowance?.remainingCents == 110_00)
        #expect(presentation.allowances.last?.drawnCents == nil)
        #expect(presentation.temporaryItems.map(\.isActive) == [true, false])
    }
}
