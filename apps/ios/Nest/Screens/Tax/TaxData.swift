import Foundation

/// Every row the Tax estimate and EOFY screens read, for one financial year.
struct TaxRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var inflows: [Inflow] = []
    var taxProfiles: [TaxProfile] = []
    var contributions: [SuperContribution] = []
    var superProfiles: [SuperProfile] = []
    var helpDebts: [HelpDebt] = []
    var deductions: [Deduction] = []
    var deductionGroups: [DeductionGroup] = []
    var deductionReceipts: [DeductionReceipt] = []
    var payslips: [Payslip] = []
    var savingsGoals: [SavingsGoal] = []
    var savers: [AccountWithBalance] = []
    var trades: [Trade] = []
    var equityGrants: [EquityGrant] = []
    var equityExercises: [EquityExercise] = []
    var equitySales: [EquitySale] = []
    var shareGrants: [ShareGrant] = []

    init() {}

    init(from decoder: Decoder) throws {
        enum Key: String, CodingKey {
            case members, inflows, taxProfiles, contributions, superProfiles, helpDebts, deductions
            case deductionGroups, deductionReceipts, payslips, savingsGoals, savers, trades
            case equityGrants, equityExercises, equitySales, shareGrants
        }
        let c = try decoder.container(keyedBy: Key.self)
        members = try c.decode([Member].self, forKey: .members)
        inflows = try c.decode([Inflow].self, forKey: .inflows)
        taxProfiles = try c.decode([TaxProfile].self, forKey: .taxProfiles)
        contributions = try c.decode([SuperContribution].self, forKey: .contributions)
        superProfiles = try c.decode([SuperProfile].self, forKey: .superProfiles)
        helpDebts = try c.decode([HelpDebt].self, forKey: .helpDebts)
        deductions = try c.decode([Deduction].self, forKey: .deductions)
        deductionGroups = try c.decode([DeductionGroup].self, forKey: .deductionGroups)
        deductionReceipts = try c.decode([DeductionReceipt].self, forKey: .deductionReceipts)
        payslips = try c.decode([Payslip].self, forKey: .payslips)
        savingsGoals = try c.decode([SavingsGoal].self, forKey: .savingsGoals)
        savers = try c.decode([AccountWithBalance].self, forKey: .savers)
        trades = try c.decode([Trade].self, forKey: .trades)
        equityGrants = try c.decode([EquityGrant].self, forKey: .equityGrants)
        equityExercises = try c.decode([EquityExercise].self, forKey: .equityExercises)
        equitySales = try c.decode([EquitySale].self, forKey: .equitySales)
        shareGrants = try c.decodeIfPresent([ShareGrant].self, forKey: .shareGrants) ?? []
    }

    /// The tables, scoped to `financialYear` where the PWA hooks scope them and
    /// ordered as they read them. `eofy` adds the tables only the EOFY screen shows.
    static func sources(financialYear: Int, eofy: Bool) -> [TableSource<TaxRows>] {
        let year = Filter.eq("financial_year", String(financialYear))
        var sources: [TableSource<TaxRows>] = [
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(Inflow.self, order: [Order(column: "name")]) { $0.inflows = $1 },
            .table(TaxProfile.self, filters: [year]) { $0.taxProfiles = $1 },
            .table(SuperContribution.self, filters: [year]) { $0.contributions = $1 },
            .table(SuperProfile.self, filters: [year]) { $0.superProfiles = $1 },
            .table(HelpDebt.self) { $0.helpDebts = $1 },
            .table(
                Deduction.self, filters: [year], order: [Order(column: "deduction_date")]
            ) { $0.deductions = $1 },
            .table(Payslip.self, filters: [year], order: [Order(column: "period_end")]) {
                $0.payslips = $1
            },
            .table(
                SavingsGoal.self,
                order: [Order(column: "queue_position"), Order(column: "name")]
            ) { $0.savingsGoals = $1 },
            .table(
                AccountWithBalance.self,
                filters: [.neq("source", "manual"), .eq("type", "savings")],
                order: [Order(column: "name")]
            ) { $0.savers = $1 },
            .table(
                Trade.self, order: [Order(column: "traded_on"), Order(column: "created_at")]
            ) { $0.trades = $1 },
            .table(EquityGrant.self, order: [Order(column: "grant_date")]) {
                $0.equityGrants = $1
            },
            .table(
                EquityExercise.self,
                order: [Order(column: "exercised_on"), Order(column: "created_at")]
            ) { $0.equityExercises = $1 },
            .table(
                EquitySale.self, order: [Order(column: "sold_on"), Order(column: "created_at")]
            ) { $0.equitySales = $1 },
        ]
        if eofy {
            sources += [
                .table(
                    DeductionGroup.self, filters: [year], order: [Order(column: "name")]
                ) { $0.deductionGroups = $1 },
                .table(DeductionReceipt.self, order: [Order(column: "created_at")]) {
                    $0.deductionReceipts = $1
                },
                .table(ShareGrant.self) { $0.shareGrants = $1 },
            ]
        }
        return sources
    }

    /// The engine input for `financialYear` at `now`. `real` is the household's
    /// unsandboxed rows while planning mode is on, estimated again for the
    /// `real → proposed` moves.
    func input(financialYear: Int, now: Date, real: TaxRows? = nil) -> TaxScreenInput {
        TaxScreenInput(
            financialYear: financialYear, now: SummaryRows.iso(now), inflows: inflows,
            taxProfiles: taxProfiles, contributions: contributions, superProfiles: superProfiles,
            helpDebts: helpDebts, deductions: deductions, members: members, payslips: payslips,
            interestGoals: savingsGoals, interestSavers: savers.compactMap(SaverInput.init),
            trades: trades,
            equity: .init(
                grants: equityGrants, exercises: equityExercises, sales: equitySales),
            baseline: real.map { .init(inflows: $0.inflows, interestGoals: $0.savingsGoals) })
    }

    /// The rows with the planning sandbox laid over the inflows and goals it covers.
    func sandboxed(by state: PlanningState) -> TaxRows {
        var rows = self
        rows.inflows = state.layer(.inflows).apply(to: inflows)
        rows.savingsGoals = state.layer(.savingsGoal).apply(to: savingsGoals)
        return rows
    }
}

/// The bridge's `TaxScreenInput`. Rows encode with their column names.
struct TaxScreenInput: Encodable, Sendable {
    struct Equity: Encodable, Sendable {
        let grants: [EquityGrant]
        let exercises: [EquityExercise]
        let sales: [EquitySale]
    }

    struct Baseline: Encodable, Sendable {
        let inflows: [Inflow]
        let interestGoals: [SavingsGoal]
    }

    let financialYear: Int
    let now: String
    let inflows: [Inflow]
    let taxProfiles: [TaxProfile]
    let contributions: [SuperContribution]
    let superProfiles: [SuperProfile]
    let helpDebts: [HelpDebt]
    let deductions: [Deduction]
    let members: [Member]
    let payslips: [Payslip]
    let interestGoals: [SavingsGoal]
    let interestSavers: [SaverInput]
    let trades: [Trade]
    let equity: Equity
    let baseline: Baseline?
}

/// `salarySacrifice`'s input: the screen's rows, the member and the extra amount.
struct SalarySacrificeInput: Encodable, Sendable {
    let rows: TaxScreenInput
    let memberId: String
    let extraCents: Int

    func encode(to encoder: Encoder) throws {
        try rows.encode(to: encoder)
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(memberId, forKey: .memberId)
        try c.encode(extraCents, forKey: .extraCents)
    }

    private enum Keys: String, CodingKey { case memberId, extraCents }
}

/// `mlsWhatIf`'s and `householdYear`'s input: the screen's rows and the dependent children.
struct DependentChildrenInput: Encodable, Sendable {
    let rows: TaxScreenInput
    let dependentChildren: Int

    func encode(to encoder: Encoder) throws {
        try rows.encode(to: encoder)
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(dependentChildren, forKey: .dependentChildren)
    }

    private enum Keys: String, CodingKey { case dependentChildren }
}
