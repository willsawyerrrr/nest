import Foundation

/// The AU financial year (ending-year label) containing `date`, in UTC like the
/// engines: FY2027 is 1 July 2026 to 30 June 2027.
enum FinancialYear {
    static func containing(_ date: Date) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = calendar.dateComponents([.year, .month], from: date)
        return parts.year! + (parts.month! >= 7 ? 1 : 0)
    }
}

/// Every row the Summary reconciliation reads.
struct SummaryRows: Codable, Sendable, Equatable {
    var inflows: [Inflow] = []
    var taxProfiles: [TaxProfile] = []
    var contributions: [SuperContribution] = []
    var helpDebts: [HelpDebt] = []
    var deductions: [Deduction] = []
    var members: [Member] = []
    var budgetLines: [BudgetLine] = []
    var memberAllowances: [MemberAllowance] = []
    var temporaryItems: [TemporaryItem] = []
    var savingsGoals: [SavingsGoal] = []
    var savers: [AccountWithBalance] = []

    /// The tables, scoped to `financialYear` where the PWA scopes them. Breakdown-
    /// and gift-derived budget lines are read as stored: the database keeps their
    /// annual amount canonical, as it does for the edge functions.
    static func sources(financialYear: Int) -> [TableSource<SummaryRows>] {
        let year = Filter.eq("financial_year", String(financialYear))
        return [
            .table(Inflow.self) { $0.inflows = $1 },
            .table(TaxProfile.self, filters: [year]) { $0.taxProfiles = $1 },
            .table(SuperContribution.self, filters: [year]) { $0.contributions = $1 },
            .table(HelpDebt.self) { $0.helpDebts = $1 },
            .table(Deduction.self, filters: [year]) { $0.deductions = $1 },
            .table(Member.self) { $0.members = $1 },
            .table(BudgetLine.self) { $0.budgetLines = $1 },
            .table(MemberAllowance.self) { $0.memberAllowances = $1 },
            .table(TemporaryItem.self) { $0.temporaryItems = $1 },
            .table(SavingsGoal.self) { $0.savingsGoals = $1 },
            .table(
                AccountWithBalance.self,
                filters: [.neq("source", "manual"), .eq("type", "savings")]
            ) { $0.savers = $1 },
        ]
    }

    /// The engine input at `now`: the household's rows in the shape
    /// `summariseHousehold` reads.
    func input(now: Date) -> SummaryInput {
        SummaryInput(
            bundle: SummaryBundle(
                inflows: inflows, taxProfiles: taxProfiles, contributions: contributions,
                helpDebts: helpDebts, deductions: deductions, members: members,
                budgetLines: budgetLines, memberAllowances: memberAllowances,
                temporaryItems: temporaryItems, savingsGoals: savingsGoals,
                savers: savers.compactMap(SaverInput.init)),
            now: Self.iso(now))
    }

    /// `2026-12-01T00:00:00Z`, the instant format the engine parses.
    static func iso(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}

/// The engine's `SummaryInput`: the rows and the instant they are read at.
struct SummaryInput: Encodable, Sendable {
    let bundle: SummaryBundle
    let now: String
}

/// The engine's `BudgetSummaryBundle`, keyed as `@nest/household` reads it. Rows
/// encode with their column names.
struct SummaryBundle: Encodable, Sendable {
    let inflows: [Inflow]
    let taxProfiles: [TaxProfile]
    let contributions: [SuperContribution]
    let helpDebts: [HelpDebt]
    let deductions: [Deduction]
    let members: [Member]
    let budgetLines: [BudgetLine]
    let memberAllowances: [MemberAllowance]
    let temporaryItems: [TemporaryItem]
    let savingsGoals: [SavingsGoal]
    let savers: [SaverInput]
}

/// A synced saver as the engine reads it: its balance, and its owner (`nil` for a joint saver).
struct SaverInput: Encodable, Sendable {
    let id: String
    let balanceCents: Int
    let ownerMemberId: String?

    init?(_ account: AccountWithBalance) {
        guard let id = account.id else { return nil }
        self.id = id
        balanceCents = account.balanceCents ?? 0
        ownerMemberId = account.ownerMemberId
    }

    enum CodingKeys: String, CodingKey {
        case id
        case balanceCents = "balance_cents"
        case ownerMemberId = "owner_member_id"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(balanceCents, forKey: .balanceCents)
        try container.encode(ownerMemberId, forKey: .ownerMemberId)
    }
}
