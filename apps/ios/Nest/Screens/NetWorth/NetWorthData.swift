import Foundation

/// How far the projection runs: a fixed span, or to the retirement age. Persisted
/// under the web app's key, as its segmented control's options.
enum ProjectionHorizon: String, CaseIterable, Sendable, Codable {
    case fiveYears = "5y"
    case tenYears = "10y"
    case twentyYears = "20y"
    case thirtyYears = "30y"
    case retirement

    static let storageKey = "net-worth-projection-horizon"

    var label: String { self == .retirement ? "To retirement" : rawValue }
}

/// Every row the Net worth screen reads.
struct NetWorthRows: Codable, Sendable, Equatable {
    var accounts: [AccountWithBalance] = []
    var members: [Member] = []
    var superProfiles: [SuperProfile] = []
    var contributions: [SuperContribution] = []
    var taxProfiles: [TaxProfile] = []
    var helpDebts: [HelpDebt] = []
    var deductions: [Deduction] = []
    var inflows: [Inflow] = []
    var savingsGoals: [SavingsGoal] = []
    var budgetLines: [BudgetLine] = []
    var equityGrants: [EquityGrant] = []
    var equityExercises: [EquityExercise] = []
    var equitySales: [EquitySale] = []
    var trades: [Trade] = []

    /// The tables, scoped to `financialYear` where the PWA hooks scope them and
    /// ordered as they read them.
    static func sources(financialYear: Int) -> [TableSource<NetWorthRows>] {
        let year = Filter.eq("financial_year", String(financialYear))
        return [
            .table(AccountWithBalance.self, order: [Order(column: "name")]) { $0.accounts = $1 },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(SuperProfile.self, filters: [year]) { $0.superProfiles = $1 },
            .table(SuperContribution.self, filters: [year]) { $0.contributions = $1 },
            .table(TaxProfile.self, filters: [year]) { $0.taxProfiles = $1 },
            .table(HelpDebt.self) { $0.helpDebts = $1 },
            .table(Deduction.self, filters: [year], order: [Order(column: "deduction_date")]) {
                $0.deductions = $1
            },
            .table(Inflow.self, order: [Order(column: "name")]) { $0.inflows = $1 },
            .table(
                SavingsGoal.self, order: [Order(column: "queue_position"), Order(column: "name")]
            ) { $0.savingsGoals = $1 },
            .table(BudgetLine.self) { $0.budgetLines = $1 },
            .table(EquityGrant.self, order: [Order(column: "grant_date")]) { $0.equityGrants = $1 },
            .table(
                EquityExercise.self,
                order: [Order(column: "exercised_on"), Order(column: "created_at")]
            ) { $0.equityExercises = $1 },
            .table(
                EquitySale.self, order: [Order(column: "sold_on"), Order(column: "created_at")]
            ) { $0.equitySales = $1 },
            .table(
                Trade.self, order: [Order(column: "traded_on"), Order(column: "created_at")]
            ) { $0.trades = $1 },
        ]
    }

    /// The engine input at `now` for `horizon`.
    func input(horizon: ProjectionHorizon, now: Date) -> NetWorthInput {
        NetWorthInput(
            accounts: accounts.compactMap(NetWorthAccountInput.init), superProfiles: superProfiles,
            contributions: contributions, taxProfiles: taxProfiles, helpDebts: helpDebts,
            deductions: deductions, members: members, inflows: inflows, goals: savingsGoals,
            budgetLines: budgetLines, equityGrants: equityGrants,
            equityExercises: equityExercises, equitySales: equitySales, trades: trades,
            horizon: horizon.rawValue, now: SummaryRows.iso(now))
    }

    /// The rows with the planning sandbox laid over the three tables it covers here.
    func sandboxed(by state: PlanningState) -> NetWorthRows {
        var rows = self
        rows.inflows = state.layer(.inflows).apply(to: inflows)
        rows.savingsGoals = state.layer(.savingsGoal).apply(to: savingsGoals)
        rows.budgetLines = state.layer(.budgetLine).apply(to: budgetLines)
        return rows
    }
}

/// An account as the engine reads it for net worth.
struct NetWorthAccountInput: Encodable, Sendable {
    let id: String
    let name: String
    let type: AccountType
    let balanceCents: Int
    let excludeFromNetWorth: Bool
    let deletedFromSourceAt: String?

    init?(_ account: AccountWithBalance) {
        guard let id = account.id, let name = account.name else { return nil }
        self.id = id
        self.name = name
        type = account.type ?? .other
        balanceCents = account.balanceCents ?? 0
        excludeFromNetWorth = account.excludeFromNetWorth ?? false
        deletedFromSourceAt = account.deletedFromSourceAt
    }

    enum CodingKeys: String, CodingKey {
        case id, name, type
        case balanceCents = "balance_cents"
        case excludeFromNetWorth = "exclude_from_net_worth"
        case deletedFromSourceAt = "deleted_from_source_at"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
        try container.encode(balanceCents, forKey: .balanceCents)
        try container.encode(excludeFromNetWorth, forKey: .excludeFromNetWorth)
        try container.encode(deletedFromSourceAt, forKey: .deletedFromSourceAt)
    }
}

/// The engine's `NetWorthInput`. Rows encode with their column names.
struct NetWorthInput: Encodable, Sendable {
    let accounts: [NetWorthAccountInput]
    let superProfiles: [SuperProfile]
    let contributions: [SuperContribution]
    let taxProfiles: [TaxProfile]
    let helpDebts: [HelpDebt]
    let deductions: [Deduction]
    let members: [Member]
    let inflows: [Inflow]
    let goals: [SavingsGoal]
    let budgetLines: [BudgetLine]
    let equityGrants: [EquityGrant]
    let equityExercises: [EquityExercise]
    let equitySales: [EquitySale]
    let trades: [Trade]
    let horizon: String
    let now: String
}

/// The engine's net worth: the breakdown and the year-by-year projection.
struct NetWorthOutcome: Decodable, Equatable, Sendable {
    struct Account: Decodable, Equatable, Sendable, Identifiable {
        let id: String
        let name: String
        let balanceCents: Int
        let deletedFromSourceAt: String?

        enum CodingKeys: String, CodingKey {
            case id, name
            case balanceCents = "balance_cents"
            case deletedFromSourceAt = "deleted_from_source_at"
        }
    }

    struct Holding: Decodable, Equatable, Sendable, Identifiable {
        let label: String
        let valueCents: Int
        var id: String { label }
    }

    struct Liability: Decodable, Equatable, Sendable, Identifiable {
        let label: String
        let balanceCents: Int
        var id: String { label }
    }

    struct Breakdown: Decodable, Equatable, Sendable {
        let superAccounts: [Account]
        let otherAccounts: [Account]
        let excludedAccounts: [Account]
        let equityHoldings: [Holding]
        let liabilities: [Liability]
        let superTotalCents: Int
        let otherTotalCents: Int
        let equityTotalCents: Int
        let liabilitiesTotalCents: Int
        let totalCents: Int
    }

    struct Point: Decodable, Equatable, Sendable, Identifiable {
        let year: Int
        let superCents: Int
        let otherCents: Int
        let equityCents: Int
        let helpCents: Int
        let debtCents: Int
        let totalCents: Int
        var id: Int { year }
    }

    let breakdown: Breakdown
    let projection: [Point]
    let projectionBaseYear: Int
}
