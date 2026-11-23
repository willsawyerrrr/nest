import Foundation

/// Every row the Payslips screen reads: the household's payslips for the financial
/// year and their lines, with the rows the tax estimate behind each slip's
/// withholding and super expectations is drawn from, and the `income` credits each
/// slip's net is corroborated against.
struct PayslipsRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var inflows: [Inflow] = []
    var taxProfiles: [TaxProfile] = []
    var contributions: [SuperContribution] = []
    var helpDebts: [HelpDebt] = []
    var deductions: [Deduction] = []
    var payslips: [Payslip] = []
    var lines: [PayslipLine] = []
    var credits: [LedgerTransaction] = []

    /// The tables, scoped to `financialYear` where the PWA scopes them, each ordered as
    /// the PWA's hooks read them: members and inflows by name, payslips most recent pay
    /// period first, lines in the order they were entered, credits by posting time.
    /// Row-level security scopes the credits to the balance-visible accounts.
    static func sources(
        financialYear: Int, calendar: Calendar = .current
    ) -> [TableSource<PayslipsRows>] {
        let year = Filter.eq("financial_year", String(financialYear))
        let bounds = creditBounds(financialYear: financialYear, calendar: calendar)
        return [
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(Inflow.self, order: [Order(column: "name")]) { $0.inflows = $1 },
            .table(TaxProfile.self, filters: [year]) { $0.taxProfiles = $1 },
            .table(SuperContribution.self, filters: [year]) { $0.contributions = $1 },
            .table(HelpDebt.self) { $0.helpDebts = $1 },
            .table(Deduction.self, filters: [year], order: [Order(column: "deduction_date")]) {
                $0.deductions = $1
            },
            .table(
                Payslip.self, filters: [year], order: [Order(column: "period_end", ascending: false)]
            ) { $0.payslips = $1 },
            .table(PayslipLine.self, order: [Order(column: "created_at")]) { $0.lines = $1 },
            .table(
                LedgerTransaction.self,
                filters: [
                    .eq("kind", "income"), .gt("amount_cents", "0"),
                    .gte("posted_at", bounds.from), .lt("posted_at", bounds.to),
                ],
                order: [Order(column: "posted_at")]
            ) { $0.credits = $1 },
        ]
    }

    /// The instants a financial year's salary credits are read between, as the PWA's
    /// `salaryCreditBounds`: from local midnight a day before the year opens, so a
    /// slip paid on 1 July finds a credit processed early, to local midnight past the
    /// longest match window after its close (seven days past 30 June), so a slip paid
    /// on 30 June finds one that landed after a weekend.
    static func creditBounds(
        financialYear: Int, calendar: Calendar = .current
    ) -> (from: String, to: String) {
        let formatter = ISO8601DateFormatter()
        func instant(month: Int, day: Int, year: Int) -> String {
            formatter.string(
                from: calendar.date(from: DateComponents(year: year, month: month, day: day))!)
        }
        return (
            instant(month: 6, day: 30, year: financialYear - 1),
            instant(month: 7, day: 8, year: financialYear)
        )
    }

    /// The engine input for `financialYear`: the rows in the shape `payslipsOverview`
    /// reads. Rows encode with their column names; each credit is dated on its local
    /// calendar day in `calendar`, as the PWA dates it.
    func input(financialYear: Int, calendar: Calendar = .current) -> PayslipsInput {
        PayslipsInput(
            financialYear: financialYear, members: members, inflows: inflows,
            taxProfiles: taxProfiles, contributions: contributions, helpDebts: helpDebts,
            deductions: deductions, payslips: payslips, lines: lines,
            credits: credits.map { SalaryCreditInput($0, calendar: calendar) })
    }
}

/// The engine's `PayslipsInput`.
struct PayslipsInput: Encodable, Sendable {
    let financialYear: Int
    let members: [Member]
    let inflows: [Inflow]
    let taxProfiles: [TaxProfile]
    let contributions: [SuperContribution]
    let helpDebts: [HelpDebt]
    let deductions: [Deduction]
    let payslips: [Payslip]
    let lines: [PayslipLine]
    let credits: [SalaryCreditInput]
}

/// The engine's `SalaryCreditInputRow`: an `income` credit on its local calendar day.
struct SalaryCreditInput: Encodable, Sendable, Equatable {
    let id: String
    let postedOn: String
    let amountCents: Int
    let memberId: String?
    let description: String
    let transactionType: String?

    init(_ transaction: LedgerTransaction, calendar: Calendar) {
        id = transaction.id
        postedOn = GiftsPresentation.localDate(transaction.postedAt, calendar: calendar)
        amountCents = transaction.amountCents
        memberId = transaction.memberId
        description = transaction.description
        transactionType = transaction.transactionType
    }

    enum CodingKeys: String, CodingKey {
        case id
        case postedOn = "posted_on"
        case amountCents = "amount_cents"
        case memberId = "member_id"
        case description
        case transactionType = "transaction_type"
    }

    /// Writes an absent member or type as `null`, which the engine compares against.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(postedOn, forKey: .postedOn)
        try container.encode(amountCents, forKey: .amountCents)
        try container.encode(memberId, forKey: .memberId)
        try container.encode(description, forKey: .description)
        try container.encode(transactionType, forKey: .transactionType)
    }
}
