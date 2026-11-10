import Foundation
import Testing

@testable import Nest

/// Holds the native Goals screen to the PWA's figures: `goals-parity.json` carries
/// a household's rows and the funding, progress, status flag and ETA line the
/// PWA's `goalProjection` helpers produce from them. The screen's own assembly
/// (`GoalsEngine`, then `GoalsPresentation`) runs over the bundled engine and must
/// show the same.
@Suite struct GoalsParityTests {
    struct Shown: Decodable, Sendable {
        struct Status: Decodable, Sendable {
            var label: String
            var color: String
        }

        var id: String
        var contributionCents: Int
        var percent: Int
        var balanceCents: Int
        var status: Status
        var eta: String
    }

    struct Expected: Decodable, Sendable {
        var active: [Shown]
        var queued: [Shown]
    }

    struct Fixture: Decodable, Sendable {
        var name: String
        var now: String
        var rows: GoalsRows
        var expected: Expected
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "goals-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private static func color(_ tone: NestPill.Tone) -> String {
        switch tone {
        case .positive: "positive"
        case .warning: "warning"
        case .info: "info"
        case .negative: "negative"
        case .brand: "brand"
        case .neutral: "gray"
        }
    }

    private static func shown(_ row: GoalRow) -> String {
        [
            row.id, "\(row.contributionCents)", "\(row.roundedPercent)", "\(row.balanceCents)",
            row.status.label, color(row.status.tone), row.eta.text,
        ].joined(separator: "|")
    }

    private static func expected(_ goal: Shown) -> String {
        [
            goal.id, "\(goal.contributionCents)", "\(goal.percent)", "\(goal.balanceCents)",
            goal.status.label, goal.status.color, goal.eta,
        ].joined(separator: "|")
    }

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        let goalsEngine = GoalsEngine(
            overview: { try await engine.budgetOverview($0) },
            queue: { try await engine.projectGoalQueue($0) })
        for fixture in Self.fixtures {
            let now = ISO8601DateFormatter().date(from: fixture.now)!
            let figures = try await goalsEngine.figures(for: fixture.rows, now: now)
            let presentation = GoalsPresentation(
                content: GoalsContent(
                    rows: fixture.rows, figures: figures, baseline: nil, householdID: nil, now: now))
            #expect(presentation.active.map(Self.shown).count == fixture.expected.active.count)
            for (row, goal) in zip(presentation.active, fixture.expected.active) {
                #expect(Self.shown(row) == Self.expected(goal), "\(fixture.name): \(goal.id)")
            }
            #expect(presentation.queued.map(\.id) == fixture.expected.queued.map(\.id))
            for (row, goal) in zip(presentation.queued, fixture.expected.queued) {
                #expect(Self.shown(row) == Self.expected(goal), "\(fixture.name): \(goal.id)")
            }
        }
    }
}
