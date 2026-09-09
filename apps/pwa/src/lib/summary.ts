import {
  summarise,
  type Amounts,
  type BudgetSummary,
  type GroupSummary,
  type SummaryInput,
} from '@nest/plan'
import { isDateInFinancialYear, type HouseholdTaxEstimate } from '@nest/tax'
import type { Account } from '../hooks/useAccounts'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { DeductionRow } from '../hooks/useDeductions'
import type { Goal } from '../hooks/useGoals'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import type { DerivedAmountContext } from './breakdowns'
import { applyBreakdownAmounts } from './derivedBudget'
import {
  activeNowTaxableInflows,
  estimateHouseholdTaxFromRows,
  projectedInterestIncomeInputs,
  type InflowRow,
} from './tax'

/** The household rows a Summary is built from, before adapting to the plan's shape. */
export interface SummarySources {
  /**
   * After-tax income for the year, in cents, from the household tax estimate, NET
   * of one-off money — the plan is a statement about the cash that recurs.
   */
  afterTaxIncomeAnnualCents: number
  /** The financial year one-off money must land in to be reported against the plan. */
  financialYear: number
  inflows: Inflow[]
  budgetLines: BudgetLine[]
  /** The rolled-up amounts each derived line reads (generic totals and gift partitions). */
  derivedAmounts: DerivedAmountContext
  temporaryItems: TemporaryItem[]
  /** Annual income tax and levies (including the 15% super contributions tax) for the gross-basis view. */
  taxAnnualCents?: number
  /**
   * Total salary sacrifice for the year (currently the net concessional super,
   * from the tax estimate; extensible to other pre-tax sacrifices), for the
   * gross-basis view.
   */
  salarySacrificeAnnualCents?: number
}

/**
 * Adapts the household's rows to the plan's `SummaryInput`: non-taxable inflows
 * become the available-cash top-up, carrying their effective window so `summarise`
 * can gate each one in or out by whether it is active at `now`; each budget line
 * contributes its normalised amount (a derived line taking its breakdown's
 * rolled-up annual total), and each temporary item its dated contribution. Pure —
 * no React, no I/O.
 *
 * ONE-OFF money — taxable and non-taxable alike — is gathered into `oneOffCents` and
 * kept out of the available-cash top-up. A payment that lands once has no
 * fortnightly share to plan against, and a recurring frequency is the only thing a
 * non-taxable inflow's normalisation could read it as, so it would raise the buffer
 * for all 26 fortnights of the year on the strength of one. Only payments landing in
 * `financialYear` count; one paid in another year belongs to that year's reading.
 */
export function toSummaryInput({
  afterTaxIncomeAnnualCents,
  financialYear,
  inflows,
  budgetLines,
  derivedAmounts,
  temporaryItems,
  taxAnnualCents = 0,
  salarySacrificeAnnualCents = 0,
}: SummarySources): SummaryInput {
  return {
    afterTaxIncomeAnnualCents,
    taxAnnualCents,
    salarySacrificeAnnualCents,
    oneOffCents: inflows.reduce(
      (total, inflow) =>
        inflow.paid_on != null && isDateInFinancialYear(inflow.paid_on, financialYear)
          ? total + (inflow.amount_cents ?? 0)
          : total,
      0,
    ),
    nonTaxableInflows: inflows.flatMap((inflow) =>
      inflow.taxable || inflow.schedule == null
        ? []
        : [
            {
              amountCents: inflow.amount_cents ?? 0,
              frequency: inflow.schedule,
              ...(inflow.interval_count != null && { interval: inflow.interval_count }),
              ...(inflow.starts_on != null && { startsOn: inflow.starts_on }),
              ...(inflow.ends_on != null && { endsOn: inflow.ends_on }),
            },
          ],
    ),
    budgetLines: applyBreakdownAmounts(budgetLines, derivedAmounts).map((line) => ({
      group: line.line_group,
      amountCents: line.amount_cents,
      frequency: line.frequency,
      ...(line.interval_count != null && { interval: line.interval_count }),
    })),
    temporaryItems: temporaryItems.map((item) => ({
      contributionCents: item.contribution_cents,
      targetDate: item.target_date,
    })),
  }
}

/** The household rows the reconciliation and its tax estimate are built from. */
export interface HouseholdSummarySources {
  inflows: Inflow[]
  budgetLines: BudgetLine[]
  taxProfiles: TaxProfile[]
  financialYear: number
  contributions: SuperContribution[]
  helpDebts: HelpDebt[]
  deductions: DeductionRow[]
  members: readonly Pick<Member, 'id' | 'date_of_birth'>[]
  /** Savings goals — a goal modelling an interest rate feeds projected interest into the tax estimate. */
  goals: readonly Goal[]
  /** Accounts with balances — resolves a goal's linked saver balance and its ownership for interest attribution. */
  accounts: readonly Pick<Account, 'id' | 'balance_cents' | 'owner_member_id'>[]
  derivedAmounts: DerivedAmountContext
  temporaryItems: TemporaryItem[]
  now?: Date
}

/**
 * Combines two reconciliations of the same plan into the figures the Summary
 * reports: every ANNUAL figure from `wholeYear` — the whole-of-financial-year tax
 * estimate — and every FORTNIGHTLY figure, plus the group portions that divide
 * by fortnightly available cash, from `activeNow` — the estimate run over only
 * the income landing now. Budget lines, temporary items, and one-off money are
 * identical in both runs and pass straight through.
 *
 * The two bases deliberately disagree for a dated inflow exactly as they already
 * do for one-off money: an annual figure is a whole-year truth, a fortnightly one
 * is what the household can count on landing each fortnight right now, so a salary
 * that ended in March feeds the annual take-home its part-year share and the
 * fortnightly buffer nothing.
 */
function reportedSummary(wholeYear: BudgetSummary, activeNow: BudgetSummary): BudgetSummary {
  const merge = (annual: Amounts, fortnightly: Amounts): Amounts => ({
    fortnightlyCents: fortnightly.fortnightlyCents,
    annualCents: annual.annualCents,
  })
  const mergeGroup = (annual: GroupSummary, fortnightly: GroupSummary): GroupSummary => ({
    ...merge(annual, fortnightly),
    portion: fortnightly.portion,
  })
  const groupKeys = Object.keys(wholeYear.groups) as (keyof BudgetSummary['groups'])[]
  return {
    oneOffCents: wholeYear.oneOffCents,
    available: merge(wholeYear.available, activeNow.available),
    groups: Object.fromEntries(
      groupKeys.map((key) => [key, mergeGroup(wholeYear.groups[key], activeNow.groups[key])]),
    ) as BudgetSummary['groups'],
    outgoings: merge(wholeYear.outgoings, activeNow.outgoings),
    savingsBlock: merge(wholeYear.savingsBlock, activeNow.savingsBlock),
    afterOutgoing: merge(wholeYear.afterOutgoing, activeNow.afterOutgoing),
    afterSaving: merge(wholeYear.afterSaving, activeNow.afterSaving),
    tax: merge(wholeYear.tax, activeNow.tax),
    salarySacrifice: merge(wholeYear.salarySacrifice, activeNow.salarySacrifice),
  }
}

/**
 * The whole Summary reconciliation from the household's rows. Two tax estimates
 * run over the (possibly sandboxed) inflows: the whole-year one, which prorates
 * each dated inflow by its FY-active share and drives every ANNUAL figure; and a
 * second one over only the taxable inflows active at `now`, each at its full
 * annual rate ({@link activeNowTaxableInflows}), which drives the FORTNIGHTLY
 * figures — so the buffer reflects the income landing this fortnight rather than
 * a fraction of pay that has stopped or not yet started. The after-tax cash is
 * then reconciled against the budget lines and temporary items.
 *
 * One-off money is reported beside the plan, never inside it, so the take-home
 * the ledger divides is net of it in both estimates, as are the tax and
 * salary-sacrifice slices the gross basis rebuilds Gross from. Pure — the Summary
 * tab and the planning roll-up both call it, once per row set, so their figures
 * agree by construction; in planning mode the baseline and proposed rows each run
 * through the same active-now path, so a sandbox date edit moves the buffer.
 */
export function summariseHousehold({
  inflows,
  budgetLines,
  taxProfiles,
  financialYear,
  contributions,
  helpDebts,
  deductions,
  members,
  goals,
  accounts,
  derivedAmounts,
  temporaryItems,
  now = new Date(),
}: HouseholdSummarySources): BudgetSummary {
  // Projected savings interest is steady, always-active `other` income, so the
  // same inputs feed the whole-year estimate and the active-now rerun.
  const interestIncomes = projectedInterestIncomeInputs(goals, accounts, members)
  const inputFor = (estimate: HouseholdTaxEstimate): SummaryInput => {
    const oneOffTaxCents = estimate.annualOneOffGrossCents - estimate.annualOneOffAfterTaxCents
    return toSummaryInput({
      afterTaxIncomeAnnualCents: estimate.annualAfterTaxCents - estimate.annualOneOffAfterTaxCents,
      financialYear,
      inflows,
      budgetLines,
      derivedAmounts,
      temporaryItems,
      salarySacrificeAnnualCents: estimate.annualNetConcessionalSuperCents,
      taxAnnualCents:
        estimate.annualTaxCents -
        oneOffTaxCents +
        (estimate.annualConcessionalContributionsCents - estimate.annualNetConcessionalSuperCents),
    })
  }
  const estimateOver = (rows: readonly InflowRow[]): HouseholdTaxEstimate =>
    estimateHouseholdTaxFromRows(
      rows,
      taxProfiles,
      contributions,
      helpDebts,
      deductions,
      undefined,
      undefined,
      members,
      interestIncomes,
    )

  const wholeYear = summarise(inputFor(estimateOver(inflows)), now)
  const activeNow = summarise(inputFor(estimateOver(activeNowTaxableInflows(inflows, now))), now)
  return reportedSummary(wholeYear, activeNow)
}
