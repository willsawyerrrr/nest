import Foundation
import Testing

@testable import Nest

/// Holds the native Payslips to the PWA's figures: `payslips-parity.json` carries rows and
/// what the PWA computes from them (each slip's variance, each member's year to date,
/// reported totals and unmeasured positions). The screen's own assembly
/// (`PayslipsRows.input`) feeds the bundled engine, and the result must equal them.
@Suite struct PayslipsParityTests {
    struct Fixture: Decodable, Sendable {
        var name: String
        var financialYear: Int
        var rows: PayslipsRows
        var expected: PayslipsOverview
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "payslips-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let overview = try await engine.payslipsOverview(
                fixture.rows.input(financialYear: fixture.financialYear))
            #expect(overview == fixture.expected, "\(fixture.name)")
        }
    }

    @Test func presentationShowsTheEngineFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let overview = try await engine.payslipsOverview(
                fixture.rows.input(financialYear: fixture.financialYear))
            let presentation = PayslipsPresentation(
                content: PayslipsContent(
                    rows: fixture.rows, overview: overview, financialYear: fixture.financialYear))
            for model in presentation.members {
                let expected = try #require(
                    fixture.expected.members.first { $0.memberId == model.member.id })
                #expect(model.cards.count == expected.variances.count)
                #expect(model.totals?.map(\.cents) == model.totals.map { _ in
                    [expected.totals.grossCents, expected.totals.taxWithheldCents,
                     expected.totals.superCents + expected.totals.salarySacrificeCents]
                })
                #expect(model.unmeasured.map(\.actualCents) == expected.unmeasured.map(\.actualCents))
            }
        }
    }
}
