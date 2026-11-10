import Foundation

/// Every row the Payslips screen reads: the household's payslips for the financial
/// year and their lines, with the rows the tax estimate behind each slip's
/// withholding and super expectations is drawn from.
struct PayslipsRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var inflows: [Inflow] = []
    var taxProfiles: [TaxProfile] = []
    var contributions: [SuperContribution] = []
    var helpDebts: [HelpDebt] = []
    var deductions: [Deduction] = []
    var payslips: [Payslip] = []
    var lines: [PayslipLine] = []

    /// The tables, scoped to `financialYear` where the PWA scopes them, each ordered as
    /// the PWA's hooks read them: members and inflows by name, payslips most recent pay
    /// period first, lines in the order they were entered.
    static func sources(financialYear: Int) -> [TableSource<PayslipsRows>] {
        let year = Filter.eq("financial_year", String(financialYear))
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
        ]
    }

    /// The engine input for `financialYear`: the rows in the shape `payslipsOverview`
    /// reads. Rows encode with their column names.
    func input(financialYear: Int) -> PayslipsInput {
        PayslipsInput(
            financialYear: financialYear, members: members, inflows: inflows,
            taxProfiles: taxProfiles, contributions: contributions, helpDebts: helpDebts,
            deductions: deductions, payslips: payslips, lines: lines)
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
}
