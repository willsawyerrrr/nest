import Foundation

/// Every row the Budget and Allowance screens read.
struct BudgetRows: Codable, Sendable, Equatable {
    var budgetLines: [BudgetLine] = []
    var memberAllowances: [MemberAllowance] = []
    var members: [Member] = []
    var accounts: [Account] = []
    var savingsGoals: [SavingsGoal] = []
    var temporaryItems: [TemporaryItem] = []

    static var sources: [TableSource<BudgetRows>] {
        [
            .table(BudgetLine.self) { $0.budgetLines = $1 },
            .table(MemberAllowance.self) { $0.memberAllowances = $1 },
            .table(Member.self) { $0.members = $1 },
            .table(Account.self) { $0.accounts = $1 },
            .table(SavingsGoal.self) { $0.savingsGoals = $1 },
            .table(TemporaryItem.self) { $0.temporaryItems = $1 },
        ]
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
