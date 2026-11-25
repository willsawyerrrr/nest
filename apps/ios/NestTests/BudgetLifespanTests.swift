import Foundation
import Testing

@testable import Nest

/// Budget item lifespans on the native side: which lines are active, what the
/// form writes for a start date, and the "Stop budgeting" form's rules.
@Suite struct BudgetLifespanTests {
    private func line(id: String = "b1", startsOn: String?, retiredOn: String? = nil) throws
        -> BudgetLine
    {
        var row: [String: Any] = [
            "allowance_member_id": NSNull(), "amount_cents": 100_00, "breakdown_id": NSNull(),
            "created_at": "2026-01-01T00:00:00Z", "destination_account_id": NSNull(),
            "frequency": "fortnightly", "gift_recipient_member_id": NSNull(), "goal_id": NSNull(),
            "household_id": "h1", "id": id, "interval_count": NSNull(), "is_gift_line": false,
            "line_group": "needs", "management_url": NSNull(), "name": "Rent",
            "retired_on": retiredOn ?? NSNull(), "updated_at": "2026-01-01T00:00:00Z",
        ]
        row["starts_on"] = startsOn ?? NSNull()
        return try JSONDecoder().decode(
            BudgetLine.self, from: JSONSerialization.data(withJSONObject: row))
    }

    @Test func aLineIsActiveFromItsStartUntilItsRetirement() throws {
        let rent = try line(startsOn: "2026-01-01", retiredOn: "2026-10-10")
        #expect(!rent.isActive(on: "2025-12-31"))
        #expect(rent.isActive(on: "2026-10-09"))
        #expect(!rent.isActive(on: "2026-10-10"))
        #expect(rent.isRetired(on: "2026-10-10"))
        #expect(try line(startsOn: "2027-03-01").isUpcoming(on: "2026-11-25"))
        #expect(try line(startsOn: nil).isActive(on: "2026-11-25"))
    }

    @Test func aNewLineWritesItsStartAndAnEditOnlyAChangedOne() throws {
        var created = BudgetLineFormState(today: "2026-11-25")
        created.name = "Gym"
        created.amount = "25"
        #expect(created.input?.startsOn == "2026-11-25")

        var edited = BudgetLineFormState(initial: try line(startsOn: "2026-01-01"), today: "2026-11-25")
        #expect(edited.input?.startsOn == nil)
        edited.startsOn = "2025-07-01"
        #expect(edited.input?.startsOn == "2025-07-01")
    }

    @Test func changingFromADayNeedsADayAfterTheStart() throws {
        var form = BudgetLineFormState(initial: try line(startsOn: "2026-11-25"), today: "2026-11-25")
        #expect(form.canChangeFrom)
        form.changeFrom = "2026-11-25"
        #expect(!form.canSubmit)
        form.changeFrom = "2026-12-01"
        #expect(form.canSubmit)
    }

    @Test func stoppingTheDefaultNeedsTheItemThatTakesOver() throws {
        var form = BudgetLineRetireFormState(
            line: try line(startsOn: "2026-01-01"), today: "2026-11-25",
            isDefault: { $0 >= "2026-01-01" }, defaultCandidates: { _ in [("b2", "Fun money")] })
        #expect(form.needsNewDefault)
        #expect(!form.canSubmit)
        form.newDefaultLineId = "b2"
        #expect(form.retirement == BudgetLineRetirement(retireOn: "2026-11-25", newDefaultLineId: "b2"))
        form.retireOn = "2026-01-01"
        #expect(!form.canSubmit)
    }

    @Test func theDefaultInForceIsReadFromItsDatedRows() {
        var rows = BudgetRows()
        rows.defaultLines = [
            HouseholdDefaultBudgetLine(
                budgetLineId: "old", createdAt: "", householdId: "h1", validFrom: "2026-01-01"),
            HouseholdDefaultBudgetLine(
                budgetLineId: "new", createdAt: "", householdId: "h1", validFrom: "2026-10-01"),
        ]
        #expect(rows.isDefault("old", from: "2026-09-30"))
        #expect(!rows.isDefault("old", from: "2026-10-01"))
        #expect(rows.isDefault("new", from: "2026-09-30"))
    }
}
