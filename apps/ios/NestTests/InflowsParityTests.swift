import Foundation
import Testing

@testable import Nest

/// Holds the native Inflows screen to the PWA's figures: `inflows-parity.json`
/// carries rows, the fortnightly figures the PWA computes from them, and form drafts
/// with the figures the PWA form shows back. The screen's own assembly feeds the
/// bundled engine, and the result must equal them.
@Suite struct InflowsParityTests {
    struct Fixture: Decodable, Sendable {
        struct Draft: Decodable, Sendable {
            var input: InflowDraftInput
            var expected: InflowDraftPreview
        }

        var name: String
        var rows: InflowsRows
        var expectedFortnightly: InflowFortnightlies
        var drafts: [Draft]
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "inflows-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    @Test func screenAssemblyMatchesThePWAFortnightlyFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let figures = try await engine.summariseInflows(fixture.rows.input)
            #expect(figures == fixture.expectedFortnightly, "\(fixture.name)")
        }
    }

    @Test func formDraftsMatchThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            for (index, draft) in fixture.drafts.enumerated() {
                let preview = try await engine.previewInflowDraft(draft.input)
                #expect(preview == draft.expected, "draft \(index)")
            }
        }
    }

    @Test func presentationShowsTheEngineFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let figures = try await engine.summariseInflows(fixture.rows.input)
            let list = InflowsPresentation(
                rows: fixture.rows, fortnightlies: figures,
                now: InflowsPresentation.parseIsoDate("2026-11-09")!
            ).list
            for row in list {
                let expected = fixture.expectedFortnightly.items.first { $0.inflowId == row.id }
                #expect(row.fortnightlyCents == expected?.fortnightlyCents, "\(row.id)")
            }
        }
    }
}
