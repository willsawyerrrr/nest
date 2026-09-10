import Foundation
import Testing

@testable import Nest

@Suite struct BudgetLinePhrasingTests {
    private func response(_ match: BudgetLineMatch?, names: [String] = []) -> BudgetLineResponse {
        BudgetLineResponse(match: match, names: names)
    }

    private func match(
        name: String = "Groceries",
        amountCents: Int = 200_00,
        frequency: String = "weekly",
        intervalCount: Int? = nil
    ) -> BudgetLineMatch {
        BudgetLineMatch(
            name: name,
            amountCents: amountCents,
            frequency: frequency,
            intervalCount: intervalCount,
            fortnightlyCents: 0,
            annualCents: 0
        )
    }

    @Test func speaksAWeeklyLineAsPerWeek() {
        let sentence = BudgetLinePhrasing.spokenSummary(
            response(match(name: "Groceries", amountCents: 200_00, frequency: "weekly")),
            query: "groceries"
        )

        #expect(sentence == "You've budgeted $200.00 per week for Groceries.")
    }

    @Test func speaksAFortnightlyLineAsPerFortnight() {
        let sentence = BudgetLinePhrasing.spokenSummary(
            response(match(name: "Rent", amountCents: 1_400_00, frequency: "fortnightly")),
            query: "rent"
        )

        #expect(sentence == "You've budgeted $1,400.00 per fortnight for Rent.")
    }

    @Test func speaksEveryNWeeksWithItsInterval() {
        #expect(
            BudgetLinePhrasing.perPeriod(
                amountCents: 300_00, frequency: "every_n_weeks", intervalCount: 4
            ) == "$300.00 every 4 weeks"
        )
        #expect(
            BudgetLinePhrasing.perPeriod(
                amountCents: 300_00, frequency: "every_n_weeks", intervalCount: 1
            ) == "$300.00 every week"
        )
    }

    @Test func fallsBackToAFixedCadenceWhenTheIntervalIsMissing() {
        #expect(
            BudgetLinePhrasing.perPeriod(
                amountCents: 100_00, frequency: "every_n_months", intervalCount: nil
            ) == "$100.00 per month"
        )
    }

    @Test func namesTheAvailableLinesWhenNothingMatched() {
        let sentence = BudgetLinePhrasing.spokenSummary(
            response(nil, names: ["Groceries", "Rent"]),
            query: "holidays"
        )

        #expect(sentence == "I couldn't find a budget for holidays. You have: Groceries, Rent.")
    }

    @Test func promptsToSetOneUpWhenThereAreNoLines() {
        let sentence = BudgetLinePhrasing.spokenSummary(response(nil, names: []), query: "groceries")

        #expect(sentence == "You haven't set up any budget lines yet.")
    }
}
