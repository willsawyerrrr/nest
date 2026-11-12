import Foundation
import Testing

@testable import Nest

/// Holds the native Super screen to the PWA's figures: `super-parity.json` carries
/// rows and the figures the PWA computes from them. The screen's own assembly
/// (`SuperRows.input`) feeds the bundled engine, and the results must equal them.
@Suite struct SuperParityTests {
    struct Expected: Decodable, Sendable {
        var summary: SuperSummary
        var projections: [SuperProjection?]
    }

    struct Fixture: Decodable, Sendable {
        var name: String
        var rows: SuperRows
        var ages: [String: Double]
        var assumptions: RetirementAssumptions
        var expected: Expected
    }

    private final class BundleLocator {}

    static let now = ISO8601DateFormatter().date(from: "2026-12-01T00:00:00Z")!

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "super-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let summary = try await engine.summariseSuper(fixture.rows.input(now: Self.now))
            #expect(summary == fixture.expected.summary, "\(fixture.name)")
            let projections = try await engine.projectSuper(
                SuperProjectionsInput(
                    entries: zip(fixture.rows.members, summary.members).map { member, figures in
                        .init(
                            currentBalanceCents: figures.effectiveBalanceCents,
                            netAnnualContributionCents: figures.netAnnualContributionCents,
                            age: fixture.ages[member.id])
                    },
                    assumptions: fixture.assumptions))
            #expect(projections == fixture.expected.projections, "\(fixture.name)")
        }
    }

    @Test func presentationShowsTheEngineFigures() {
        for fixture in Self.fixtures {
            let summary = fixture.expected.summary
            let presentation = SuperPresentation(
                content: SuperContent(rows: fixture.rows, summary: summary, financialYear: 2027),
                projections: fixture.expected.projections, assumptions: fixture.assumptions,
                ages: fixture.ages)
            #expect(
                presentation.sections.map(\.profile.effectiveCents)
                    == summary.members.map { Int($0.effectiveBalanceCents) })
            #expect(
                presentation.sections.map(\.projection.projection) == fixture.expected.projections)
            #expect(
                presentation.sections.map { $0.caps != nil } == summary.members.map { $0.caps != nil })
        }
    }
}
