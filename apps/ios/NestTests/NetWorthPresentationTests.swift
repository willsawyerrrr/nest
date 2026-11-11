import Foundation
import Testing

@testable import Nest

@Suite struct NetWorthPresentationTests {
    private func account(_ id: String, _ cents: Int, deleted: Bool = false) -> NetWorthOutcome.Account {
        .init(id: id, name: id, balanceCents: cents, deletedFromSourceAt: deleted ? "t" : nil)
    }

    private func point(_ year: Int, equity: Int = 0, help: Int = 0, debt: Int = 0) -> NetWorthOutcome.Point {
        .init(
            year: year, superCents: 100, otherCents: 50, equityCents: equity, helpCents: help,
            debtCents: debt, totalCents: 150 + equity - help - debt)
    }

    private func presentation(
        others: [NetWorthOutcome.Account] = [], excluded: [NetWorthOutcome.Account] = [],
        projection: [NetWorthOutcome.Point] = [], baselineTotal: Int? = nil
    ) -> NetWorthPresentation {
        func outcome(total: Int) -> NetWorthOutcome {
            .init(
                breakdown: .init(
                    superAccounts: [], otherAccounts: others, excludedAccounts: excluded,
                    equityHoldings: [], liabilities: [], superTotalCents: 0, otherTotalCents: 0,
                    equityTotalCents: 0, liabilitiesTotalCents: 0, totalCents: total),
                projection: projection, projectionBaseYear: 2026)
        }
        return NetWorthPresentation(
            content: .init(
                outcome: outcome(total: 500), baseline: baselineTotal.map { outcome(total: $0) },
                horizon: .retirement))
    }

    @Test func superAloneIsNotEditable() {
        #expect(!presentation().hasTogglable)
        #expect(presentation(others: [account("a", 1)]).hasTogglable)
        #expect(presentation(excluded: [account("a", 1)]).hasTogglable)
    }

    @Test func totalsComparedAgainstTheRealRowsWhilePlanning() {
        #expect(presentation().baselineTotalCents == nil)
        #expect(presentation(baselineTotal: 400).baselineTotalCents == 400)
    }

    @Test func projectionEndsAtTheLastPointAndLabelsYears() {
        let shown = presentation(projection: [point(0), point(1), point(2, equity: 70)])
        #expect(shown.projectionEndCents == 220)
        #expect(shown.rows.map(\.year) == ["2026", "2027", "2028"])
        #expect(shown.showsEquity)
        #expect(shown.hasData)
    }

    @Test func nothingToProjectHasNoData() {
        let empty = NetWorthOutcome.Point(
            year: 0, superCents: 0, otherCents: 0, equityCents: 0, helpCents: 0, debtCents: 0,
            totalCents: 0)
        #expect(!presentation(projection: [empty]).hasData)
        #expect(!presentation().hasData)
    }

    @Test func tooltipListsAssetsPositiveAndLiabilitiesNegative() {
        let row = NetWorthPresentation(
            content: .init(
                outcome: .init(
                    breakdown: presentation().breakdown,
                    projection: [point(1, equity: 30, help: 20, debt: 10)], projectionBaseYear: 2026),
                baseline: nil, horizon: .tenYears)
        ).rows[0]
        let items = NetWorthPresentation.tooltipItems(row)
        #expect(items.map(\.label) == ["Super", "Cash & other", "Equity", "HELP debt", "Debt accounts"])
        #expect(items.map(\.cents) == [100, 50, 30, -20, -10])
    }
}
