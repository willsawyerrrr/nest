import Foundation
import Testing

@testable import Nest

/// Holds the native planning mode to the PWA's figures: `planning-parity.json`
/// carries a household's rows, a sandbox, and the figures the PWA's
/// `applyOverrides` and `summariseHousehold` produce from the real rows and the
/// sandboxed ones. The native layer applies the same sandbox, the bundled engine
/// computes each Summary, and both must equal them.
@Suite struct PlanningParityTests {
    struct Fixture: Decodable, Sendable {
        var name: String
        var now: String
        var rows: SummaryRows
        var state: PlanningState
        var expectedBaseline: EngineParityTests.JSONValue
        var expectedProposed: EngineParityTests.JSONValue
    }

    private final class BundleLocator {}

    static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "planning-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private func figures(_ rows: SummaryRows, now: String, engine: Engine) async throws
        -> EngineParityTests.JSONValue
    {
        let input = rows.input(now: ISO8601DateFormatter().date(from: now)!)
        let output = try await engine.call(.summariseHousehold, json: JSONEncoder().encode(input))
        return try JSONDecoder().decode(EngineParityTests.JSONValue.self, from: output)
    }

    @Test func sandboxedAndRealFiguresMatchThePWA() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            #expect(fixture.state.active)
            #expect(
                try await figures(fixture.rows, now: fixture.now, engine: engine)
                    == fixture.expectedBaseline, "\(fixture.name) baseline")
            #expect(
                try await figures(
                    fixture.rows.sandboxed(by: fixture.state), now: fixture.now, engine: engine)
                    == fixture.expectedProposed, "\(fixture.name) proposed")
        }
    }

    @Test func theSandboxEditsHidesAndAddsRows() {
        let fixture = Self.fixtures[0]
        let rows = fixture.rows.sandboxed(by: fixture.state)
        #expect(rows.inflows.first { $0.id == "i1" }?.amountCents == 180_000_00)
        #expect(!rows.inflows.contains { $0.id == "i3" })
        #expect(rows.budgetLines.first { $0.id == "b1" }?.amountCents == 2_600_00)
        #expect(rows.budgetLines.first { $0.id == "b3" }?.lineGroup == .discretionary)
        #expect(!rows.budgetLines.contains { $0.id == "b6" })
        #expect(rows.budgetLines.last?.name == "Gym")
        #expect(rows.savingsGoals.first?.targetAmountCents == 20_000_00)
        #expect(rows.members == fixture.rows.members)
    }
}
