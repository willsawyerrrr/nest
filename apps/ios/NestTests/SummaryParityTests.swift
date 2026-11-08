import Foundation
import Testing

@testable import Nest

/// Holds the native Summary to the PWA's figures: `summary-parity.json` carries
/// a household's rows and the figures the PWA's `summariseHousehold` produces
/// from them. The screen's own assembly (`SummaryRows.input`) feeds the bundled
/// engine, and the result must equal them.
@Suite struct SummaryParityTests {
    struct Fixture: Decodable, Sendable {
        var name: String
        var now: String
        var rows: SummaryRows
        var expected: EngineParityTests.JSONValue
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "summary-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private static func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let input = fixture.rows.input(now: Self.date(fixture.now))
            let output = try await engine.call(.summariseHousehold, json: JSONEncoder().encode(input))
            #expect(
                try JSONDecoder().decode(EngineParityTests.JSONValue.self, from: output)
                    == fixture.expected, "\(fixture.name)")
        }
    }

    @Test func formatsTheInstantTheEngineParses() {
        #expect(SummaryRows.iso(Self.date("2026-12-01T00:00:00Z")) == "2026-12-01T00:00:00Z")
    }

    @Test func picksTheFinancialYearInUTC() {
        #expect(FinancialYear.containing(Self.date("2026-06-30T23:59:59Z")) == 2026)
        #expect(FinancialYear.containing(Self.date("2026-07-01T00:00:00Z")) == 2027)
        #expect(FinancialYear.containing(Self.date("2026-12-01T00:00:00Z")) == 2027)
    }
}
