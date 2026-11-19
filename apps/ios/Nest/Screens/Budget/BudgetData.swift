import Foundation

/// Every row the Budget and Allowance screens read.
struct BudgetRows: Codable, Sendable, Equatable {
    var budgetLines: [BudgetLine] = []
    var memberAllowances: [MemberAllowance] = []
    var members: [Member] = []
    /// Every account a line can name or be funded from, a co-member's spending
    /// account by name only.
    var accounts: [AccountDirectoryEntry] = []
    var savingsGoals: [SavingsGoal] = []
    var temporaryItems: [TemporaryItem] = []
    /// The generic breakdowns, which own their derived line's name and group.
    var breakdowns: [Breakdown] = []
    /// The super profiles, whose linked balance accounts cannot fund a line.
    var superProfiles: [SuperProfile] = []

    /// The tables, with super profiles scoped to `financialYear` as the PWA reads them.
    static func sources(financialYear: Int) -> [TableSource<BudgetRows>] {
        [
            .table(BudgetLine.self) { $0.budgetLines = $1 },
            .table(MemberAllowance.self) { $0.memberAllowances = $1 },
            .table(Member.self) { $0.members = $1 },
            .table(AccountDirectoryEntry.self, order: [Order(column: "name")]) { $0.accounts = $1 },
            .table(SavingsGoal.self) { $0.savingsGoals = $1 },
            .table(TemporaryItem.self) { $0.temporaryItems = $1 },
            .table(Breakdown.self) { $0.breakdowns = $1 },
            .table(SuperProfile.self, filters: [.eq("financial_year", String(financialYear))]) {
                $0.superProfiles = $1
            },
        ]
    }

    /// The accounts a line or allowance may be funded from: every account but a
    /// super fund's balance account, which is not spendable.
    var fundingAccounts: [(id: String, name: String)] {
        let superIDs = Set(superProfiles.compactMap(\.linkedAccountId))
        return accounts.compactMap { account in
            guard let id = account.id, let name = account.name, !superIDs.contains(id) else {
                return nil
            }
            return (id, name)
        }
    }

    /// The engine input at `now`: the lines and allowances in the shape
    /// `budgetOverview` reads.
    func input(now: Date) -> BudgetOverviewInput {
        BudgetOverviewInput(
            lines: budgetLines.map(BudgetOverviewInput.Line.init),
            allowances: memberAllowances.map(BudgetOverviewInput.Allowance.init),
            temporaryItems: temporaryItems.map(BudgetOverviewInput.Temporary.init),
            now: SummaryRows.iso(now))
    }
}

/// The engine's `BudgetOverviewInput`, keyed as `@nest/plan` reads it.
struct BudgetOverviewInput: Encodable, Sendable {
    struct Line: Encodable, Sendable {
        let group: BudgetGroup
        let amountCents: Int
        let frequency: Frequency
        let interval: Int?
        let allowanceMemberId: String?

        init(
            group: BudgetGroup, amountCents: Int, frequency: Frequency, interval: Int?,
            allowanceMemberId: String?
        ) {
            self.group = group
            self.amountCents = amountCents
            self.frequency = frequency
            self.interval = interval
            self.allowanceMemberId = allowanceMemberId
        }

        init(_ line: BudgetLine) {
            group = line.lineGroup
            amountCents = line.amountCents
            frequency = line.frequency
            interval = line.intervalCount
            allowanceMemberId = line.allowanceMemberId
        }
    }

    struct Allowance: Encodable, Sendable {
        let memberId: String
        let amountCents: Int
        let frequency: Frequency
        let interval: Int?

        init(_ allowance: MemberAllowance) {
            memberId = allowance.memberId
            amountCents = allowance.amountCents
            frequency = allowance.frequency
            interval = allowance.intervalCount
        }
    }

    struct Temporary: Encodable, Sendable {
        let contributionCents: Int
        let targetDate: String

        init(_ item: TemporaryItem) {
            contributionCents = item.contributionCents
            targetDate = item.targetDate
        }
    }

    let lines: [Line]
    let allowances: [Allowance]
    let temporaryItems: [Temporary]
    let now: String
}
