import Foundation
import Testing

@testable import Nest

/// Holds the native Tax estimate and EOFY screens to the PWA's figures:
/// `tax-parity.json` carries rows and what the PWA's `TaxSection` and `EofySection`
/// compute from them. The screens' own assembly (`TaxRows.input`) feeds the bundled
/// engine, and every result must equal them.
@Suite struct TaxParityTests {
    struct Expected: Decodable, Sendable {
        var taxScreen: TaxScreenFigures
        var householdYear: [HouseholdYearFigures]
        var mlsWhatIf: [FamilyMlsFigures]
        var salarySacrifice: SalarySacrificeResult
    }

    struct Fixture: Decodable, Sendable {
        var name: String
        var now: String
        var financialYear: Int
        var rows: TaxRows
        var baselineInflows: [Inflow]
        var expected: Expected
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "tax-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private func input(_ fixture: Fixture, planning: Bool = false) -> TaxScreenInput {
        var sandboxed = fixture.rows
        sandboxed.inflows = fixture.baselineInflows
        // The fixture's rows are the proposed ones; the baseline is the real rows.
        return fixture.rows.input(
            financialYear: fixture.financialYear,
            now: ISO8601DateFormatter().date(from: fixture.now)!,
            real: planning ? sandboxed : nil)
    }

    @Test func screenAssemblyMatchesThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let figures = try await engine.taxScreen(input(fixture, planning: true))
            #expect(figures == fixture.expected.taxScreen, "\(fixture.name)")
        }
    }

    @Test func theWhatIfsAndHouseholdYearMatchThePWAFigures() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let rows = input(fixture)
            for (index, children) in [0, 2].enumerated() {
                let query = DependentChildrenInput(rows: rows, dependentChildren: children)
                #expect(
                    try await engine.householdYear(query) == fixture.expected.householdYear[index])
                #expect(try await engine.mlsWhatIf(query) == fixture.expected.mlsWhatIf[index])
            }
            let sacrifice = try await engine.salarySacrifice(
                SalarySacrificeInput(rows: rows, memberId: "m1", extraCents: 5_000_00))
            #expect(sacrifice == fixture.expected.salarySacrifice)
        }
    }

    @Test func presentationLabelsTheEnginesFigures() throws {
        let fixture = try #require(Self.fixtures.first)
        let figures = fixture.expected.taxScreen
        let ada = try #require(figures.estimate.members.first { $0.memberId == "m1" })
        let income = TaxPresentation.incomeLines(
            member: ada, projectedInterestCents: figures.memberExtras[0].projectedInterestCents)
        #expect(income.last?.annualCents == ada.breakdown.taxableIncomeCents)
        #expect(income.first { $0.label == "Net capital gain" }?.isVisible == true)
        let steps = TaxPresentation.waterfallSteps(ada)
        #expect(steps.first?.endCents == ada.annualGrossCents)
        #expect(steps.last?.amountCents == ada.annualAfterTaxCents)
        let liable = fixture.expected.householdYear[1].mls
        #expect(TaxPresentation.mlsVerdict(liable) == "Liable at 1.25% (tier 2)")
    }
}
