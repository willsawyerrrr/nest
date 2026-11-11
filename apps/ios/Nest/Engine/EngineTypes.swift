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

/// A member's whole tax breakdown, as `@nest/tax` computes it.
struct TaxBreakdown: Codable, Equatable, Sendable {
    var taxableIncomeCents: Int
    var incomeForSurchargeCents: Int
    var incomeTaxCents: Int
    var litoOffsetCents: Int
    var oneOffOffsetCents: Int
    var medicareLevyCents: Int
    var medicareLevySurchargeCents: Int
    var helpRepaymentCents: Int
    var division293Cents: Int
    var totalLiabilityCents: Int
    var paygWithheldCents: Int
    var balanceCents: Int
    var repaymentIncomeCents: Int
}

/// One member's estimate and tax breakdown.
struct TaxMemberFigures: Codable, Equatable, Sendable {
    var memberId: String
    var annualGrossCents: Int
    var annualConcessionalContributionsCents: Int
    var annualDeductionsCents: Int
    var annualTaxCents: Int
    var annualAfterTaxCents: Int
    var annualOneOffGrossCents: Int
    var annualNetCapitalGainCents: Int
    var fortnightlyGrossCents: Int
    var fortnightlyTaxCents: Int
    var fortnightlyAfterTaxCents: Int
    var employmentTerminationCents: Int
    var breakdown: TaxBreakdown
}

/// The household's estimate and each member's.
struct TaxHouseholdFigures: Codable, Equatable, Sendable {
    var annualGrossCents: Int
    var annualTaxCents: Int
    var annualAfterTaxCents: Int
    var annualOneOffGrossCents: Int
    var fortnightlyGrossCents: Int
    var fortnightlyTaxCents: Int
    var fortnightlyAfterTaxCents: Int
    var members: [TaxMemberFigures]
}

/// A member's super contribution-cap status.
struct SuperCapFigures: Codable, Equatable, Sendable {
    var concessionalCents: Int
    var concessionalCapCents: Int
    var concessionalOverCap: Bool
    var nonConcessionalCents: Int
    var nonConcessionalCapCents: Int
    var nonConcessionalOverCap: Bool
    var coContributionCents: Int
}

/// A member's HELP/HECS payoff projection and its one-line summary.
struct HelpPayoffFigures: Codable, Equatable, Sendable {
    var paidOffFinancialYear: Int?
    var yearsToPayOff: Int?
    var summary: String
}

/// What the estimate screens show about a member beyond the estimate itself.
struct TaxMemberExtras: Codable, Equatable, Sendable {
    var memberId: String
    var capSummary: SuperCapFigures?
    var helpPayoff: HelpPayoffFigures?
    var projectedInterestCents: Int
    var payslipCount: Int
}

/// The Tax estimate and EOFY screens' figures.
struct TaxScreenFigures: Codable, Equatable, Sendable {
    /// The cents-per-unit rates a distance or hours deduction is claimed at.
    struct DeductionRates: Codable, Equatable, Sendable {
        var centsPerKm: Double
        var centsPerHour: Double
    }

    var financialYear: Int
    /// Every financial year with a published tax config, most recent first.
    var availableFinancialYears: [Int]
    var deductionRates: DeductionRates
    var estimate: TaxHouseholdFigures
    var baseline: TaxHouseholdFigures?
    var memberExtras: [TaxMemberExtras]
}

/// A salary-sacrifice what-if's result.
struct SalarySacrificeResult: Codable, Equatable, Sendable {
    var additionalConcessionalCents: Int
    var taxSavedCents: Int
    var contributionsTaxCents: Int
    var netToSuperCents: Int
    var takeHomeChangeCents: Int
    var division293DeltaCents: Int
}

/// The family Medicare levy surcharge as if no member held hospital cover.
struct FamilyMlsFigures: Codable, Equatable, Sendable {
    var combinedIncomeForSurchargeCents: Int
    var tierRate: Double
    var thresholdCents: Int
    var perMemberSurchargeCents: [Int]
    var totalSurchargeCents: Int
}

/// The Medicare levy surcharge family-income test.
struct MlsTestFigures: Codable, Equatable, Sendable {
    struct Next: Codable, Equatable, Sendable {
        var floorCents: Int
        var distanceCents: Int

/// How an expectation is measured, as `@nest/plan` names the bases.
enum ExpectationBasis: String, Codable, Sendable {
    case cadence
    case partCycle = "part_cycle"
    case calendarDays = "calendar_days"
    case occasional
    case oneOff = "one_off"
}

/// Why an expectation is a share of a pay period.
enum PartCycleReason: String, Codable, Sendable {
    case partPeriod = "part_period"
    case inflowDates = "inflow_dates"
}

/// One payslip measured against the plan: each expected figure beside its variance
/// (actual less expected), positive when the slip reported more than the plan.
struct PayslipVariance: Codable, Equatable, Sendable {
    /// One inflow's share of an itemised slip.
    struct LineGroup: Codable, Equatable, Sendable {
        var sourceInflowId: String?
        var labels: [String]
        var actualCents: Int64
        var expectedCents: Int64?
        var varianceCents: Int64?
        var basis: ExpectationBasis
        var partCycleReason: PartCycleReason?
    }

    /// One tax component's share of a slip's tax.
    struct TaxGroup: Codable, Equatable, Sendable {
        var component: PayslipTaxComponent
        var labels: [String]
        var actualCents: Int64
        var expectedCents: Int64
        var varianceCents: Int64
    }

    var basis: ExpectationBasis
    var partCycleReason: PartCycleReason?
    var cadenceInflowId: String?
    var periodDays: Int
    var cadencePeriodDays: Int?
    var financialYearDays: Int
    var expectedGrossCents: Int64?
    var grossVarianceCents: Int64?
    var grossPartlyUnmeasured: Bool
    var unmeasuredGrossCents: Int64
    var lineGroups: [LineGroup]
    var unallocatedCents: Int64
    var expectedTaxWithheldCents: Int64
    var taxWithheldVarianceCents: Int64
    var taxGroups: [TaxGroup]
    var unallocatedTaxCents: Int64
    var superBaseCents: Int64
    var expectedSuperGuaranteeCents: Int64
    var expectedConcessionalCents: Int64
    var expectedSuperCents: Int64
    var actualSuperCents: Int64
    var superVarianceCents: Int64
}

/// A member's payslips measured against the plan, and their year to date.
struct PayslipsOverview: Codable, Equatable, Sendable {
    struct Totals: Codable, Equatable, Sendable {
        var grossCents: Int64
        var taxWithheldCents: Int64
        var superCents: Int64
        var salarySacrificeCents: Int64
        var payslipCount: Int
    }

    /// The running totals printed on the latest slip that carries all three.
    struct Reported: Codable, Equatable, Sendable {
        var grossCents: Int64
        var taxWithheldCents: Int64
        var superCents: Int64
    }

    /// One year-to-date figure held against the plan, over the slips whose
    /// expectation is known.
    struct Position: Codable, Equatable, Sendable {
        var actualCents: Int64
        var expectedCents: Int64?
        var varianceCents: Int64?
        var coveredCount: Int
        var payslipCount: Int
    }

    struct Positions: Codable, Equatable, Sendable {
        var gross: Position
        var taxWithheld: Position
        var `super`: Position
    }

    /// An inflow no pay period measures, measured across the year.
    struct Unmeasured: Codable, Equatable, Sendable {
        var sourceInflowId: String
        var actualCents: Int64
        var expectedCents: Int64
        var varianceCents: Int64
        var annualExpectedCents: Int64
        var asAt: String
    }

    struct SlipVariance: Codable, Equatable, Sendable {
        var payslipId: String
        var variance: PayslipVariance
    }

    struct Member: Codable, Equatable, Sendable {
        var memberId: String
        var variances: [SlipVariance]
        var totals: Totals
        var reported: Reported?
        var positions: Positions
        var unmeasured: [Unmeasured]
    }

    var members: [Member]
}
