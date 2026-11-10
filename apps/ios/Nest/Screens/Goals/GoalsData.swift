import Foundation

/// A synced saver account a goal can link to: its balance replaces the goal's
/// manual one.
struct GoalSaver: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let balanceCents: Int
    let isDeletedAtSource: Bool

    init?(_ account: AccountWithBalance) {
        guard let id = account.id, let name = account.name else { return nil }
        self.id = id
        self.name = name
        balanceCents = account.balanceCents ?? 0
        isDeletedAtSource = account.deletedFromSourceAt != nil
    }
}

/// Every row the Goals screen reads.
struct GoalsRows: Codable, Sendable, Equatable {
    var savingsGoals: [SavingsGoal] = []
    var budgetLines: [BudgetLine] = []
    var savers: [AccountWithBalance] = []
    var members: [Member] = []

    static var sources: [TableSource<GoalsRows>] {
        [
            .table(SavingsGoal.self, order: [Order(column: "queue_position"), Order(column: "name")]) {
                $0.savingsGoals = $1
            },
            .table(BudgetLine.self) { $0.budgetLines = $1 },
            .table(
                AccountWithBalance.self,
                filters: [.neq("source", "manual"), .eq("type", "savings")],
                order: [Order(column: "name")]
            ) { $0.savers = $1 },
            .table(Member.self) { $0.members = $1 },
        ]
    }

    var saverList: [GoalSaver] { savers.compactMap(GoalSaver.init) }

    /// The account a goal links to, when set and still visible to the household.
    func saver(for goal: SavingsGoal) -> GoalSaver? {
        guard let id = goal.linkedAccountId else { return nil }
        return saverList.first { $0.id == id }
    }

    /// The balance a goal is measured at: its linked saver's, else the manual figure.
    func balanceCents(of goal: SavingsGoal) -> Int {
        saver(for: goal)?.balanceCents ?? goal.currentBalanceCents
    }

    /// The `budgetOverview` input whose `lines` are parallel to `budgetLines`. The
    /// PWA reads a funding line's fortnightly figure without its interval, so the
    /// interval is withheld here too.
    func overviewInput(now: Date) -> BudgetOverviewInput {
        BudgetOverviewInput(
            lines: budgetLines.map(BudgetOverviewInput.Line.fundingLine),
            allowances: [], temporaryItems: [], now: SummaryRows.iso(now))
    }

    /// Each goal's fortnightly funding: the sum of its linked lines' fortnightly figures.
    func contributions(overview: BudgetOverview) -> [String: Int] {
        var totals: [String: Int] = [:]
        for (line, amounts) in zip(budgetLines, overview.lines) {
            if let goalID = line.goalId { totals[goalID, default: 0] += Int(amounts.fortnightlyCents) }
        }
        return totals
    }

    /// Goals funded by a linked line (active, in row order) and the rest (queued,
    /// by queue position then name).
    func partition(contributions: [String: Int]) -> (active: [SavingsGoal], queued: [SavingsGoal]) {
        let active = savingsGoals.filter { (contributions[$0.id] ?? 0) > 0 }
        let queued = savingsGoals.filter { (contributions[$0.id] ?? 0) == 0 }.sorted {
            let a = $0.queuePosition ?? Int.max
            let b = $1.queuePosition ?? Int.max
            return a != b ? a < b : $0.name.localizedCompare($1.name) == .orderedAscending
        }
        return (active, queued)
    }

    /// The `projectGoalQueue` input over the whole ordered list.
    func queueInput(contributions: [String: Int], now: Date) -> GoalQueueInput {
        let (active, queued) = partition(contributions: contributions)
        return GoalQueueInput(
            active: active.map {
                .init(goal: shape($0), fortnightlyContributionCents: contributions[$0.id] ?? 0)
            },
            queued: queued.map {
                .init(goal: shape($0), plannedContributionCents: $0.plannedContributionCents)
            },
            now: SummaryRows.iso(now))
    }

    /// Every goal as an active one at its own funding (zero when unfunded): each
    /// goal's projection as if it were drawing now.
    func allActiveInput(contributions: [String: Int], now: Date) -> GoalQueueInput {
        GoalQueueInput(
            active: savingsGoals.map {
                .init(goal: shape($0), fortnightlyContributionCents: contributions[$0.id] ?? 0)
            },
            queued: [], now: SummaryRows.iso(now))
    }

    private func shape(_ goal: SavingsGoal) -> GoalQueueInput.Goal {
        .init(
            targetAmountCents: goal.targetAmountCents, currentBalanceCents: balanceCents(of: goal),
            targetDate: goal.targetDate, annualInterestBps: goal.annualInterestBps)
    }
}

extension BudgetOverviewInput.Line {
    /// A budget line as a goal's funding reads it: amount and cadence only.
    static func fundingLine(_ line: BudgetLine) -> BudgetOverviewInput.Line {
        BudgetOverviewInput.Line(
            group: line.lineGroup, amountCents: line.amountCents, frequency: line.frequency,
            interval: nil, allowanceMemberId: nil)
    }
}

/// The engine's `GoalQueueInput`, keyed as `@nest/plan` reads it.
struct GoalQueueInput: Encodable, Sendable {
    struct Goal: Encodable, Sendable {
        let targetAmountCents: Int
        let currentBalanceCents: Int
        let targetDate: String?
        let annualInterestBps: Int?
    }

    struct Active: Encodable, Sendable {
        let goal: Goal
        let fortnightlyContributionCents: Int
    }

    struct Queued: Encodable, Sendable {
        let goal: Goal
        let plannedContributionCents: Int?
    }

    let active: [Active]
    let queued: [Queued]
    let now: String
}

/// Runs the goal figures through the engine: funding from the budget lines, then
/// each goal's projection and the queue's.
struct GoalsEngine: Sendable {
    let overview: @Sendable (BudgetOverviewInput) async throws -> BudgetOverview
    let queue: @Sendable (GoalQueueInput) async throws -> GoalQueueProjection

    func figures(for rows: GoalsRows, now: Date) async throws -> GoalsFigures {
        let contributions = rows.contributions(
            overview: try await overview(rows.overviewInput(now: now)))
        let (active, queued) = rows.partition(contributions: contributions)
        let projection = try await queue(rows.queueInput(contributions: contributions, now: now))
        return GoalsFigures(
            contributions: contributions,
            active: Dictionary(
                zip(active.map(\.id), projection.active), uniquingKeysWith: { $1 }),
            queued: Dictionary(zip(queued.map(\.id), projection.queued), uniquingKeysWith: { $1 }))
    }

    func baseline(real: GoalsRows, sandboxed: GoalsRows, now: Date) async throws
        -> GoalsBaseline
    {
        let realFigures = try await figures(for: real, now: now)
        // A goal created in the sandbox is projected at the real funding rate.
        var everyGoal = real
        let known = Set(real.savingsGoals.map(\.id))
        everyGoal.savingsGoals += sandboxed.savingsGoals.filter { !known.contains($0.id) }
        let projection = try await queue(
            everyGoal.allActiveInput(contributions: realFigures.contributions, now: now))
        return GoalsBaseline(
            rows: real, figures: realFigures,
            asActive: Dictionary(
                zip(everyGoal.savingsGoals.map(\.id), projection.active), uniquingKeysWith: { $1 }))
    }
}
