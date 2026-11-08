import Foundation
import Testing

@testable import Nest

@MainActor
@Suite struct PlanningSandboxTests {
    private let goal = SavingsGoal(
        annualInterestBps: nil, createdAt: "t", currentBalanceCents: 0, householdId: "h", id: "g1",
        linkedAccountId: nil, name: "Holiday", plannedContributionCents: nil, queuePosition: nil,
        targetAmountCents: 100_00, targetDate: nil, updatedAt: "t")

    private func newGoal(_ id: String) -> JSONRow {
        [
            "id": .string(id), "household_id": .string("h"), "name": .string("New"),
            "created_at": .string("t"), "updated_at": .string("t"),
            "current_balance_cents": .int(0), "target_amount_cents": .int(50_00),
        ]
    }

    @Test func aPatchMergesByIdAndNullClearsAColumn() {
        let layer = PlanningLayer()
            .updating("g1", patch: ["target_amount_cents": .int(250_00)])
            .updating("g1", patch: ["target_date": .string("2027-01-01")])
        let rows = layer.apply(to: [goal])
        #expect(rows.first?.targetAmountCents == 250_00)
        #expect(rows.first?.targetDate == "2027-01-01")
        let cleared = layer.updating("g1", patch: ["target_date": .null]).apply(to: [goal])
        #expect(cleared.first?.targetDate == nil)
    }

    @Test func deletingARealRowHidesItAndDeletingACreatedRowDropsIt() {
        var layer = PlanningLayer(creates: [newGoal("n1")])
        layer = layer.deleting("g1").deleting("n1")
        #expect(layer.deletes == ["g1"])
        #expect(layer.creates.isEmpty)
        #expect(layer.apply(to: [goal]).isEmpty)
    }

    @Test func createdRowsAppendAndTakeLaterPatches() {
        let layer = PlanningLayer(creates: [newGoal("n1")])
            .updating("n1", patch: ["target_amount_cents": .int(75_00)])
        let rows = layer.apply(to: [goal])
        #expect(rows.map(\.id) == ["g1", "n1"])
        #expect(rows.last?.targetAmountCents == 75_00)
    }

    @Test func resettingARowRemovesEveryTraceOfIt() {
        let layer = PlanningLayer(creates: [newGoal("n1")], deletes: ["g1"])
            .updating("g1", patch: ["name": .string("x")])
            .updating("n1", patch: ["name": .string("y")])
            .resetting("g1").resetting("n1")
        #expect(layer == PlanningLayer())
    }

    @Test func aRowThatNoLongerDecodesIsDropped() {
        let layer = PlanningLayer().updating("g1", patch: ["target_amount_cents": .string("many")])
        #expect(layer.apply(to: [goal]).isEmpty)
    }

    @Test func stateDecodesTheWebShapeAndIgnoresUnknownTables() throws {
        let json = """
            {"active":true,"overrides":{"inflows":{"updates":{"i":{"amount_cents":5}},"creates":[],"deletes":["x"]},
            "budget_line":{"updates":{}},"other":{"deletes":["z"]}}}
            """
        let state = try JSONDecoder().decode(PlanningState.self, from: Data(json.utf8))
        #expect(state.active)
        #expect(state.layer(.inflows).updates["i"] == ["amount_cents": .int(5)])
        #expect(state.layer(.inflows).deletes == ["x"])
        #expect(state.layer(.budgetLine) == PlanningLayer())
        #expect(state.overrides["other"] == nil)
        #expect(state.pendingCount == 2)
    }

    @Test func theStorePersistsPerHouseholdAndExitRemovesIt() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = PlanningStore(defaults: defaults)
        store.select(household: "h1")
        store.enter()
        store.update(.savingsGoal, id: "g1", patch: ["target_amount_cents": .int(1)])
        #expect(store.pendingCount == 1)

        let again = PlanningStore(defaults: defaults)
        again.select(household: "h1")
        #expect(again.isActive && again.pendingCount == 1)
        again.select(household: "h2")
        #expect(!again.isActive && again.pendingCount == 0)

        again.select(household: "h1")
        again.discard()
        #expect(again.isActive && again.pendingCount == 0)
        again.exit()
        #expect(defaults.data(forKey: PlanningStore.key("h1")) == nil)
        #expect(!again.isActive)
    }

    @Test func everyMutationAdvancesTheRevision() {
        let store = PlanningStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let start = store.revision
        store.enter()
        store.delete(.inflows, id: "i")
        store.reset(.inflows, id: "i")
        #expect(store.revision == start + 3)
    }

    @Test func saveParamsUseTheRPCsArgumentNames() throws {
        var state = PlanningState(active: true)
        state.overrides["inflows"] = PlanningLayer(deletes: ["i1"])
        state.overrides["savings_goal"] = PlanningLayer().updating(
            "g1", patch: ["target_amount_cents": .int(9)])
        let data = try JSONEncoder().encode(CommitPlanningParams(state))
        let object = try #require(
            try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(
            Set(object.keys) == [
                "p_inflow_creates", "p_inflow_updates", "p_inflow_deletes",
                "p_budget_line_creates", "p_budget_line_updates", "p_budget_line_deletes",
                "p_savings_goal_creates", "p_savings_goal_updates", "p_savings_goal_deletes",
            ])
        #expect(object["p_inflow_deletes"] as? [String] == ["i1"])
        #expect(object["p_budget_line_deletes"] as? [String] == [])
    }
}

@Suite struct PlanningPresentationTests {
    @Test func parsesTypedDollars() {
        #expect(PlanningPresentation.parseCents("1,234.50") == 123_450)
        #expect(PlanningPresentation.parseCents("$20") == 2_000)
        #expect(PlanningPresentation.parseCents("0") == 0)
        #expect(PlanningPresentation.parseCents("1.005") == nil)
        #expect(PlanningPresentation.parseCents("-5") == nil)
        #expect(PlanningPresentation.parseCents("abc") == nil)
        #expect(PlanningPresentation.parseCents("") == nil)
    }

    @Test func listsEditsNewRowsAndRemovalsWithWasAndNow() throws {
        let fixture = PlanningParityTests.fixtures[0]
        let pending = PlanningPresentation.pending(fixture.state, real: fixture.rows)
        let byID = Dictionary(uniqueKeysWithValues: pending.map { ($0.id, $0) })

        let edit = try #require(byID["inflows/i1"])
        #expect(edit.kind == .edit && edit.name == "Ada salary")
        #expect(edit.detail == "Amount \(MoneyFormat.cents(150_000_00)) → \(MoneyFormat.cents(180_000_00))")
        #expect(byID["inflows/i3"]?.kind == .removed && byID["inflows/i3"]?.name == "Bonus")
        #expect(byID["budget_line/new1"]?.kind == .new && byID["budget_line/new1"]?.name == "Gym")
        #expect(pending.count == 7)
    }

    @Test func offersAmountEditsOnlyWhereTheSandboxCanHoldThem() throws {
        let rows = PlanningParityTests.fixtures[0].rows
        let editable = PlanningPresentation.editable(rows)
        // Ben's wage is priced by the hour, and Utilities is derived from a breakdown.
        #expect(!editable.contains { $0.rowID == "i2" })
        #expect(!editable.contains { $0.rowID == "b2" })
        #expect(editable.contains { $0.table == .savingsGoal && $0.column == "target_amount_cents" })
        #expect(editable.contains { $0.rowID == "b1" && $0.column == "amount_cents" })
    }
}
