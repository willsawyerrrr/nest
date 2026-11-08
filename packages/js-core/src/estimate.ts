import type {
  DeductionRow,
  EquityRows,
  HelpDebtRow,
  InflowRow,
  InterestGoalRow,
  MemberRow,
  SaverRow,
  SuperContributionRow,
  TaxProfileRow,
  TradeRow,
} from '@nest/household'
import type { HouseholdTaxEstimate } from '@nest/tax'

/** The input of `estimateTax`: a household's rows and the financial year to assess them in. */
export interface EstimateInput {
  /** The financial year's ending calendar year (`2027` is 2026-27); one without a config reads as 2027. */
  financialYear: number
  inflows: InflowRow[]
  taxProfiles: TaxProfileRow[]
  contributions?: SuperContributionRow[]
  helpDebts?: HelpDebtRow[]
  deductions?: DeductionRow[]
  /** Each member's actual tax withheld for the year, as `[memberId, cents]` pairs. */
  paygWithheld?: [string, number][]
  members?: MemberRow[]
  /** Projected-interest inputs, shaped into other income before the estimate runs. */
  interestGoals?: InterestGoalRow[]
  interestSavers?: SaverRow[]
  trades?: TradeRow[]
  equity?: EquityRows
}

/** The scalar cents figures of a household tax estimate, and a per-member slice of each. */
export interface EstimateProjection {
  annualGrossCents: number
  annualTaxCents: number
  annualAfterTaxCents: number
  annualConcessionalContributionsCents: number
  annualNetConcessionalSuperCents: number
  annualDeductionsCents: number
  annualOneOffGrossCents: number
  annualOneOffAfterTaxCents: number
  fortnightlyGrossCents: number
  fortnightlyTaxCents: number
  fortnightlyAfterTaxCents: number
  members: {
    memberId: string
    annualGrossCents: number
    annualTaxCents: number
    annualAfterTaxCents: number
    helpRepaymentCents: number
    balanceCents: number
    medicareLevyCents: number
    oneOffOffsetCents: number
  }[]
}

/** Projects a full estimate, which carries the engine input back for what-ifs, onto its scalar figures. */
export function projectEstimate(estimate: HouseholdTaxEstimate): EstimateProjection {
  return {
    annualGrossCents: estimate.annualGrossCents,
    annualTaxCents: estimate.annualTaxCents,
    annualAfterTaxCents: estimate.annualAfterTaxCents,
    annualConcessionalContributionsCents: estimate.annualConcessionalContributionsCents,
    annualNetConcessionalSuperCents: estimate.annualNetConcessionalSuperCents,
    annualDeductionsCents: estimate.annualDeductionsCents,
    annualOneOffGrossCents: estimate.annualOneOffGrossCents,
    annualOneOffAfterTaxCents: estimate.annualOneOffAfterTaxCents,
    fortnightlyGrossCents: estimate.fortnightlyGrossCents,
    fortnightlyTaxCents: estimate.fortnightlyTaxCents,
    fortnightlyAfterTaxCents: estimate.fortnightlyAfterTaxCents,
    members: estimate.members.map((member) => ({
      memberId: member.memberId,
      annualGrossCents: member.annualGrossCents,
      annualTaxCents: member.annualTaxCents,
      annualAfterTaxCents: member.annualAfterTaxCents,
      helpRepaymentCents: member.breakdown.helpRepaymentCents,
      balanceCents: member.breakdown.balanceCents,
      medicareLevyCents: member.breakdown.medicareLevyCents,
      oneOffOffsetCents: member.breakdown.oneOffOffsetCents,
    })),
  }
}
