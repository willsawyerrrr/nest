import Foundation

/// A tax estimate's scalar cents figures; each `members` entry carries the same
/// figures for one member.
struct TaxEstimate: Codable, Equatable, Sendable {
    struct Member: Codable, Equatable, Sendable {
        var memberId: String
        var annualGrossCents: Int64
        var annualTaxCents: Int64
        var annualAfterTaxCents: Int64
        var helpRepaymentCents: Int64
        var balanceCents: Int64
        var medicareLevyCents: Int64
        var oneOffOffsetCents: Int64
    }

    var annualGrossCents: Int64
    var annualTaxCents: Int64
    var annualAfterTaxCents: Int64
    var annualConcessionalContributionsCents: Int64
    var annualNetConcessionalSuperCents: Int64
    var annualDeductionsCents: Int64
    var annualOneOffGrossCents: Int64
    var annualOneOffAfterTaxCents: Int64
    var fortnightlyGrossCents: Int64
    var fortnightlyTaxCents: Int64
    var fortnightlyAfterTaxCents: Int64
    var members: [Member]
}

/// The household's reconciled Summary; `afterSaving` is the fortnightly buffer.
struct BudgetSummary: Codable, Equatable, Sendable {
    struct Amounts: Codable, Equatable, Sendable {
        var fortnightlyCents: Int64
        var annualCents: Int64
    }

    /// A group's totals and its share of available fortnightly cash.
    struct Group: Codable, Equatable, Sendable {
        var fortnightlyCents: Int64
        var annualCents: Int64
        var portion: Double
    }

    /// A member's spending allowance reconciled against the lines drawn from it.
    struct Allowance: Codable, Equatable, Sendable {
        var memberId: String
        var allowance: Amounts
        var drawn: Amounts
        var remaining: Amounts
    }

    struct Groups: Codable, Equatable, Sendable {
        var needs: Group
        var wants: Group
        var discretionary: Group
        var temporary: Group
        var savings: Group
        var investments: Group
    }

    var oneOffCents: Int64
    var available: Amounts
    var groups: Groups
    var allowances: [Allowance]
    var outgoings: Amounts
    var savingsBlock: Amounts
    var afterOutgoing: Amounts
    var afterSaving: Amounts
    var tax: Amounts
    var salarySacrifice: Amounts
}

/// One savings goal's projected trajectory. Dates are ISO `YYYY-MM-DD`.
struct GoalProjection: Codable, Equatable, Sendable {
    var remainingCents: Int64
    var alreadyMet: Bool
    var fortnightsToTarget: Int?
    var projectedCompletionDate: String?
    var requiredFortnightlyContributionCents: Int64?
}

/// A queued goal's projection and when it starts drawing from the freed pool.
struct QueuedGoalProjection: Codable, Equatable, Sendable {
    var remainingCents: Int64
    var alreadyMet: Bool
    var fortnightsToTarget: Int?
    var projectedCompletionDate: String?
    var requiredFortnightlyContributionCents: Int64?
    var projectedStartDate: String?
}

/// The projections for a household's whole ordered goal list.
struct GoalQueueProjection: Codable, Equatable, Sendable {
    var active: [GoalProjection]
    var queued: [QueuedGoalProjection]
}

/// The breakdowns' roll-up: each breakdown's totals and each item's fortnightly figure.
struct BreakdownRollups: Codable, Equatable, Sendable {
    struct Total: Codable, Equatable, Sendable {
        var breakdownId: String
        var annualCents: Int64
        var fortnightlyCents: Int64
    }

    struct ItemFortnightly: Codable, Equatable, Sendable {
        var itemId: String
        var fortnightlyCents: Int64
    }

    var totals: [Total]
    var items: [ItemFortnightly]
}

/// The Budget screen's figures at an instant. `lines` and `temporaryActive`
/// follow the input's order.
struct BudgetOverview: Codable, Equatable, Sendable {
    /// Fortnightly subtotals; a line drawn from an allowance counts inside the
    /// allowance, which joins Discretionary in full.
    struct Groups: Codable, Equatable, Sendable {
        var needs: Int64
        var wants: Int64
        var discretionary: Int64
        var savings: Int64
        var investments: Int64

        subscript(group: BudgetGroup) -> Int64 {
            switch group {
            case .needs: needs
            case .wants: wants
            case .discretionary: discretionary
            case .savings: savings
            case .investments: investments
            }
        }
    }

    var lines: [BudgetSummary.Amounts]
    var groups: Groups
    var allowances: [BudgetSummary.Allowance]
    var temporaryActive: [Bool]
}
