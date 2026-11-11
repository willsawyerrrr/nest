import Foundation
import Testing

@testable import Nest

/// Holds the native Net worth screen to the PWA's figures: `net-worth-parity.json`
/// carries a household's rows and the breakdown and projection the PWA's Net worth
/// tab computes from them. The screen's own assembly (`NetWorthRows.input`) feeds
/// the bundled engine, and the result must equal them.
@Suite struct NetWorthParityTests {
    struct Fixture: Decodable, Sendable {
        var name: String
        var now: String
        var horizon: ProjectionHorizon
        var rows: NetWorthRows
        var expected: NetWorthOutcome
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "net-worth-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let now = ISO8601DateFormatter().date(from: fixture.now)!
            let outcome = try await engine.netWorth(
                fixture.rows.input(horizon: fixture.horizon, now: now))
            #expect(outcome == fixture.expected, "\(fixture.name)")
        }
    }

    @Test func presentationLabelsTheFixtureFigures() {
        let fixture = Self.fixtures[0]
        let presentation = NetWorthPresentation(
            content: NetWorthContent(outcome: fixture.expected, baseline: nil, horizon: fixture.horizon))
        #expect(presentation.totalCents == fixture.expected.breakdown.totalCents)
        #expect(presentation.hasTogglable)
        #expect(presentation.rows.first?.year == "2026")
        #expect(presentation.rows.count == 11)
    }
}
