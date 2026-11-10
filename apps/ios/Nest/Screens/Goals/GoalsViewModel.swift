import Foundation
import Observation

/// The fields a goal form supplies, written to `savings_goal` exactly as the PWA
/// writes them. Every key is sent, `null` included, so clearing a field clears
/// the column.
struct GoalInput: Encodable, Equatable, Sendable {
    var name: String
    var targetAmountCents: Int
    var targetDate: String?
    var currentBalanceCents: Int
    var linkedAccountId: String?
    var annualInterestBps: Int?
    var queuePosition: Int?
    var plannedContributionCents: Int?

    enum CodingKeys: String, CodingKey {
        case name
        case targetAmountCents = "target_amount_cents"
        case targetDate = "target_date"
        case currentBalanceCents = "current_balance_cents"
        case linkedAccountId = "linked_account_id"
        case annualInterestBps = "annual_interest_bps"
        case queuePosition = "queue_position"
        case plannedContributionCents = "planned_contribution_cents"
    }

    /// A stored goal as a complete input, with `queuePosition` overridden when given.
    init(_ goal: SavingsGoal, queuePosition: Int? = nil) {
        name = goal.name
        targetAmountCents = goal.targetAmountCents
        targetDate = goal.targetDate
        currentBalanceCents = goal.currentBalanceCents
        linkedAccountId = goal.linkedAccountId
        annualInterestBps = goal.annualInterestBps
        self.queuePosition = queuePosition ?? goal.queuePosition
        plannedContributionCents = goal.plannedContributionCents
    }

    init(
        name: String, targetAmountCents: Int, targetDate: String?, currentBalanceCents: Int,
        linkedAccountId: String?, annualInterestBps: Int?, queuePosition: Int?,
        plannedContributionCents: Int?
    ) {
        self.name = name
        self.targetAmountCents = targetAmountCents
        self.targetDate = targetDate
        self.currentBalanceCents = currentBalanceCents
        self.linkedAccountId = linkedAccountId
        self.annualInterestBps = annualInterestBps
        self.queuePosition = queuePosition
        self.plannedContributionCents = plannedContributionCents
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(targetAmountCents, forKey: .targetAmountCents)
        try container.encode(targetDate, forKey: .targetDate)
        try container.encode(currentBalanceCents, forKey: .currentBalanceCents)
        try container.encode(linkedAccountId, forKey: .linkedAccountId)
        try container.encode(annualInterestBps, forKey: .annualInterestBps)
        try container.encode(queuePosition, forKey: .queuePosition)
        try container.encode(plannedContributionCents, forKey: .plannedContributionCents)
    }
}

/// A new goal's insert body: the input plus the household.
private struct GoalInsert: Encodable, Sendable {
    let input: GoalInput
    let householdID: String

    func encode(to encoder: Encoder) throws {
        try input.encode(to: encoder)
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(householdID, forKey: Key("household_id"))
    }

    struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ value: String) { stringValue = value }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

/// Loads the household's goals through the cache, runs the projections in the
/// engine, publishes the result, and writes goal changes: to the database, or
/// into the planning sandbox while it is on.
@MainActor @Observable
final class GoalsViewModel {
    static let syncFailure = "Could not refresh from Up. Try again."

    private(set) var state: ScreenState<GoalsContent> = .loading
    private(set) var isSyncing = false
    private(set) var syncError: String?

    private let data: NestData
    private let engine: GoalsEngine
    private let now: @Sendable () -> Date
    private let planning: PlanningStore

    init(
        data: NestData = .live,
        overview: @escaping @Sendable (BudgetOverviewInput) async throws -> BudgetOverview =
            ScreenEngine.budgetOverview,
        queue: @escaping @Sendable (GoalQueueInput) async throws -> GoalQueueProjection =
            ScreenEngine.projectGoalQueue,
        now: @escaping @Sendable () -> Date = Date.init,
        planning: PlanningStore = .shared
    ) {
        self.data = data
        engine = GoalsEngine(overview: overview, queue: queue)
        self.now = now
        self.planning = planning
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let instant = now()
        let stream = RowsCombiner.stream(initial: GoalsRows(), sources: GoalsRows.sources, data: data)
        do {
            for try await snapshot in stream {
                planning.select(household: snapshot.rows.members.first?.householdId)
                let sandboxing = planning.state.active
                let rows = sandboxing ? snapshot.rows.sandboxed(by: planning.state) : snapshot.rows
                let figures = try await engine.figures(for: rows, now: instant)
                var baseline: GoalsBaseline?
                if sandboxing {
                    baseline = try await engine.baseline(real: snapshot.rows, sandboxed: rows, now: instant)
                }
                state = .loaded(
                    GoalsContent(
                        rows: rows, figures: figures, baseline: baseline,
                        householdID: snapshot.rows.members.first?.householdId, now: instant),
                    isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            fail(error)
        }
    }

    /// Discards the shown state and loads again.
    func retry() async {
        if state.value == nil { state = .loading }
        await load()
    }

    private func fail(_ error: Error) {
        let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
        if let content = state.value {
            state = .loaded(content, isRefreshing: false, refreshError: failure)
        } else {
            state = .failed(failure)
        }
    }

    // MARK: Writes

    /// Adds a goal.
    func create(_ input: GoalInput) async throws {
        if planning.state.active {
            guard var row = PlanningLayer.json(of: input) else { throw NestError(.invalidRequest) }
            let stamp = SummaryRows.iso(now())
            row["id"] = .string(UUID().uuidString.lowercased())
            row["household_id"] = .string(planning.householdID ?? state.value?.householdID ?? "")
            row["created_at"] = .string(stamp)
            row["updated_at"] = .string(stamp)
            planning.create(.savingsGoal, row: row)
            return
        }
        guard let household = state.value?.householdID else { throw NestError(.invalidRequest) }
        try await data.insert(SavingsGoal.self, values: GoalInsert(input: input, householdID: household))
        await load()
    }

    /// Saves changes to a goal.
    func update(id: String, input: GoalInput) async throws {
        if planning.state.active {
            guard let patch = PlanningLayer.json(of: input) else { throw NestError(.invalidRequest) }
            planning.update(.savingsGoal, id: id, patch: patch)
            return
        }
        try await data.update(SavingsGoal.self, values: input, filters: [.eq("id", id)])
        await load()
    }

    /// Deletes a goal.
    func remove(id: String) async throws {
        if planning.state.active {
            planning.delete(.savingsGoal, id: id)
            return
        }
        try await data.delete(SavingsGoal.self, filters: [.eq("id", id)])
        await load()
    }

    /// Rewrites the queued goals' positions to `orderedIDs`, writing only the goals that moved.
    func reorder(_ orderedIDs: [String]) async throws {
        let goals = Dictionary(
            (state.value?.rows.savingsGoals ?? []).map { ($0.id, $0) }, uniquingKeysWith: { $1 })
        let moves = orderedIDs.enumerated().compactMap { position, id -> (String, GoalInput)? in
            guard let goal = goals[id], goal.queuePosition != position else { return nil }
            return (id, GoalInput(goal, queuePosition: position))
        }
        if planning.state.active {
            for (id, input) in moves {
                if let patch = PlanningLayer.json(of: input) {
                    planning.update(.savingsGoal, id: id, patch: patch)
                }
            }
            return
        }
        let data = data
        do {
            try await withThrowingTaskGroup(of: Void.self) { group in
                for (id, input) in moves {
                    group.addTask {
                        try await data.update(SavingsGoal.self, values: input, filters: [.eq("id", id)])
                    }
                }
                try await group.waitForAll()
            }
        } catch {
            await load()
            throw error
        }
        await load()
    }

    /// Pulls fresh Up balances, then reloads.
    func syncFromUp() async {
        isSyncing = true
        syncError = nil
        defer { isSyncing = false }
        do {
            struct Ignored: Decodable { init(from decoder: Decoder) throws {} }
            let _: Ignored = try await data.api.invoke("up-sync")
            await load()
        } catch {
            syncError = Self.syncFailure
        }
    }
}

extension GoalsRows {
    /// The rows with the sandbox laid over the two tables it covers here.
    func sandboxed(by state: PlanningState) -> GoalsRows {
        var rows = self
        rows.budgetLines = state.layer(.budgetLine).apply(to: budgetLines)
        rows.savingsGoals = state.layer(.savingsGoal).apply(to: savingsGoals)
        return rows
    }
}
