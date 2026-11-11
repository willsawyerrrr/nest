import Foundation
import Testing

@testable import Nest

/// Holds the native Equity screen to the PWA's figures: `equity-parity.json`
/// carries rows and the figures and labels the PWA computes from them. The
/// screen's own assembly (`EquityRows.input`) feeds the bundled engine, and the
/// presentation built from the result must equal them.
@Suite struct EquityParityTests {
    struct Fixture: Decodable, Sendable {
        struct Expected: Decodable, Sendable {
            var figures: [GrantFigures]
            var members: [Member]
        }

        struct Member: Decodable, Equatable, Sendable {
            struct Grant: Decodable, Equatable, Sendable {
                var id: String
                var label: String
                var instrumentLabel: String
                var isOption: Bool
                var frequencyLabel: String
                var vestedLabel: String
                var netCents: Int64
                var valueLine: String?
                var activityLine: String?
            }

            struct Activity: Decodable, Equatable, Sendable {
                var id: String
                var title: String
                var detail: String
            }

            var id: String
            var name: String
            var grants: [Grant]
            var exercises: [Activity]?
            var sales: [Activity]?
        }

        var name: String
        var now: String
        var rows: EquityRows
        var expected: Expected
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "equity-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private func now(_ fixture: Fixture) -> Date {
        ISO8601DateFormatter().date(from: fixture.now)!
    }

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let figures = try await engine.summariseEquity(fixture.rows.input(now: now(fixture)))
            #expect(figures == fixture.expected.figures, "\(fixture.name)")
        }
    }

    @Test func presentationLabelsMatchThePWA() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let figures = try await engine.summariseEquity(fixture.rows.input(now: now(fixture)))
            let members = EquityPresentation(
                content: EquityContent(rows: fixture.rows, figures: figures)
            ).members
            #expect(members.count == fixture.expected.members.count)
            for (actual, expected) in zip(members, fixture.expected.members) {
                #expect(actual.id == expected.id && actual.name == expected.name)
                #expect(
                    actual.grants.map {
                        Fixture.Member.Grant(
                            id: $0.id, label: $0.label, instrumentLabel: $0.instrumentLabel,
                            isOption: $0.isOption, frequencyLabel: $0.frequencyLabel,
                            vestedLabel: $0.vestedLabel, netCents: $0.netCents,
                            valueLine: $0.valueLine, activityLine: $0.activityLine)
                    } == expected.grants, "\(expected.name) grants")
                func activity(_ rows: [ActivityRow]?) -> [Fixture.Member.Activity]? {
                    rows?.map { .init(id: $0.id, title: $0.title, detail: $0.detail) }
                }
                #expect(activity(actual.exercises) == expected.exercises, "\(expected.name) exercises")
                #expect(activity(actual.sales) == expected.sales, "\(expected.name) sales")
            }
        }
    }
}
