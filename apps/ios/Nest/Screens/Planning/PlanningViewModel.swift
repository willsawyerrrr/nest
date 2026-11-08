import Foundation
import Observation

/// What the Planning screen renders once loaded: the real rows, the rows with
/// the sandbox laid over them, and the Summary of each.
struct PlanningContent: Equatable, Sendable {
    let real: SummaryRows
    let proposed: SummaryRows
    let baseline: BudgetSummary
    let projected: BudgetSummary
}

/// The arguments of `commit_planning_changes`: every sandboxed table's creates,
/// updates and deletes, applied in one transaction.
struct CommitPlanningParams: Encodable, Sendable {
    let inflows: PlanningLayer
    let budgetLines: PlanningLayer
    let savingsGoals: PlanningLayer

    init(_ state: PlanningState) {
        inflows = state.layer(.inflows)
        budgetLines = state.layer(.budgetLine)
        savingsGoals = state.layer(.savingsGoal)
    }

    enum CodingKeys: String, CodingKey {
        case inflowCreates = "p_inflow_creates"
        case inflowUpdates = "p_inflow_updates"
        case inflowDeletes = "p_inflow_deletes"
        case budgetLineCreates = "p_budget_line_creates"
        case budgetLineUpdates = "p_budget_line_updates"
        case budgetLineDeletes = "p_budget_line_deletes"
        case savingsGoalCreates = "p_savings_goal_creates"
        case savingsGoalUpdates = "p_savings_goal_updates"
        case savingsGoalDeletes = "p_savings_goal_deletes"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(inflows.creates, forKey: .inflowCreates)
        try container.encode(inflows.updates, forKey: .inflowUpdates)
        try container.encode(inflows.deletes, forKey: .inflowDeletes)
        try container.encode(budgetLines.creates, forKey: .budgetLineCreates)
        try container.encode(budgetLines.updates, forKey: .budgetLineUpdates)
        try container.encode(budgetLines.deletes, forKey: .budgetLineDeletes)
        try container.encode(savingsGoals.creates, forKey: .savingsGoalCreates)
        try container.encode(savingsGoals.updates, forKey: .savingsGoalUpdates)
        try container.encode(savingsGoals.deletes, forKey: .savingsGoalDeletes)
    }
}

/// Loads the Summary's rows, computes the Summary from the real rows and from
/// the sandboxed ones, and saves the sandbox for real.
@MainActor @Observable
final class PlanningViewModel {
    private(set) var state: ScreenState<PlanningContent> = .loading
    private(set) var isSaving = false
    private(set) var saveError: NestError?

    let planning: PlanningStore
    private let data: NestData
    private let summarise: @Sendable (SummaryInput) async throws -> BudgetSummary
    private let now: @Sendable () -> Date

    init(
        data: NestData = .live,
        planning: PlanningStore = .shared,
        summarise: @escaping @Sendable (SummaryInput) async throws -> BudgetSummary =
            ScreenEngine.summarise,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.data = data
        self.planning = planning
        self.summarise = summarise
        self.now = now
    }

    /// Streams the rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let instant = now()
        let stream = RowsCombiner.stream(
            initial: SummaryRows(),
            sources: SummaryRows.sources(financialYear: FinancialYear.containing(instant)),
            data: data)
        do {
            for try await snapshot in stream {
                planning.select(household: snapshot.rows.members.first?.householdId)
                let proposed = snapshot.rows.sandboxed(by: planning.state)
                let baseline = try await summarise(snapshot.rows.input(now: instant))
                let projected = try await summarise(proposed.input(now: instant))
                state = .loaded(
                    PlanningContent(
                        real: snapshot.rows, proposed: proposed, baseline: baseline,
                        projected: projected),
                    isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let content = state.value {
                state = .loaded(content, isRefreshing: false, refreshError: failure)
            } else {
                state = .failed(failure)
            }
        }
    }

    /// Discards the shown state and loads again.
    func retry() async {
        if state.value == nil { state = .loading }
        await load()
    }

    /// Writes every held change for real in one transaction, then clears the
    /// sandbox (staying in planning mode). A failed save leaves every pending
    /// change as it was and surfaces its fixed message.
    func save() async {
        guard !isSaving, planning.pendingCount > 0 else { return }
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do {
            try await data.call(
                "commit_planning_changes", params: CommitPlanningParams(planning.state),
                invalidating: Set(PlanningTable.allCases.map(\.rawValue)))
            planning.discard()
        } catch {
            saveError = (NestError.from(error) as? NestError) ?? NestError(.unknown)
        }
    }
}
