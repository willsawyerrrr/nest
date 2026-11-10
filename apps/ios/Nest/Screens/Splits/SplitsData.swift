import Foundation

/// Every row the Pay splits screen reads.
struct SplitsRows: Codable, Sendable, Equatable {
    var budgetLines: [BudgetLine] = []
    var savingsGoals: [SavingsGoal] = []
    var accounts: [AccountDirectoryEntry] = []
    var superProfiles: [SuperProfile] = []
    var paySplits: [PaySplit] = []
    var households: [Household] = []
    var members: [Member] = []
    var memberAllowances: [MemberAllowance] = []

    /// The tables, with super profiles scoped to `financialYear` as the PWA reads them.
    static func sources(financialYear: Int) -> [TableSource<SplitsRows>] {
        [
            .table(BudgetLine.self, order: [Order(column: "name")]) { $0.budgetLines = $1 },
            .table(SavingsGoal.self) { $0.savingsGoals = $1 },
            .table(AccountDirectoryEntry.self, order: [Order(column: "name")]) { $0.accounts = $1 },
            .table(SuperProfile.self, filters: [.eq("financial_year", String(financialYear))]) {
                $0.superProfiles = $1
            },
            .table(PaySplit.self) { $0.paySplits = $1 },
            .table(Household.self) { $0.households = $1 },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
            .table(MemberAllowance.self) { $0.memberAllowances = $1 },
        ]
    }

    /// The household's household row, which holds the pay account.
    var household: Household? {
        households.first { $0.id == members.first?.householdId } ?? households.first
    }

    /// The account pay lands in, if one is designated.
    var payAccountId: String? { household?.payAccountId }

    /// The confirmed fortnightly split per account id.
    var configuredByAccount: [String: Int] {
        Dictionary(
            paySplits.map { ($0.accountId, $0.confirmedFortnightlyCents) },
            uniquingKeysWith: { $1 })
    }

    /// Accounts a split can target: the directory without super-fund balance accounts.
    var splittableAccounts: [AccountDirectoryEntry] {
        let superIDs = Set(superProfiles.compactMap(\.linkedAccountId))
        return accounts.filter { $0.id.map { !superIDs.contains($0) } ?? false }
    }

    /// The engine input: the lines, goals and allowances in the shape
    /// `assignmentsByAccount` reads. An allowance whose member is unknown is dropped.
    var input: PaySplitRoutesInput {
        let names = Dictionary(members.map { ($0.id, $0.name) }, uniquingKeysWith: { $1 })
        return PaySplitRoutesInput(
            lines: budgetLines.map(PaySplitRoutesInput.Line.init),
            goals: savingsGoals.map(PaySplitRoutesInput.Goal.init),
            allowances: memberAllowances.compactMap { allowance in
                names[allowance.memberId].map {
                    PaySplitRoutesInput.Allowance(allowance, memberName: $0)
                }
            })
    }
}

/// The engine's `PaySplitRoutesInput`, keyed as `@nest/plan` reads it.
struct PaySplitRoutesInput: Encodable, Sendable {
    struct Line: Encodable, Sendable {
        let id: String
        let name: String
        let group: BudgetGroup
        let amountCents: Int
        let frequency: Frequency
        let interval: Int?
        let goalId: String?
        let destinationAccountId: String?
        let allowanceMemberId: String?

        init(_ line: BudgetLine) {
            id = line.id
            name = line.name
            group = line.lineGroup
            amountCents = line.amountCents
            frequency = line.frequency
            interval = line.intervalCount
            goalId = line.goalId
            destinationAccountId = line.destinationAccountId
            allowanceMemberId = line.allowanceMemberId
        }
    }

    struct Goal: Encodable, Sendable {
        let id: String
        let linkedAccountId: String?

        init(_ goal: SavingsGoal) {
            id = goal.id
            linkedAccountId = goal.linkedAccountId
        }
    }

    struct Allowance: Encodable, Sendable {
        let memberId: String
        let amountCents: Int
        let frequency: Frequency
        let interval: Int?
        let name: String
        let destinationAccountId: String?

        init(_ allowance: MemberAllowance, memberName: String) {
            memberId = allowance.memberId
            amountCents = allowance.amountCents
            frequency = allowance.frequency
            interval = allowance.intervalCount
            name = BudgetPresentation.allowanceName(memberName)
            destinationAccountId = allowance.destinationAccountId
        }
    }

    let lines: [Line]
    let goals: [Goal]
    let allowances: [Allowance]
}
