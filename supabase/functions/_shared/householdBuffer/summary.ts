/**
 * The single server-side implementation of the PWA Summary's "fortnightly after
 * saving" buffer — the React-free port of `apps/pwa/src/lib/summary.ts`'s
 * `summariseHousehold`, exact to the on-screen figure.
 *
 * Two tax estimates run over the household's inflows: the whole-year one, which
 * prorates each dated inflow by its FY-active share and drives every ANNUAL
 * figure; and a second over only the taxable inflows active at `now`, each at
 * its full annual rate, which drives the FORTNIGHTLY figures. Projected savings
 * interest feeds both. The after-tax cash is then reconciled against the budget
 * lines and temporary items by `@nest/plan`'s `summarise`.
 *
 * The breakdown- and gift-derived budget lines are read straight: the
 * `reconcile_derived_lines` triggers keep their `amount_cents` (annual, whole
 * cents, via `reconcile_annual_cents` which mirrors `normalize.ts`'s
 * `annualCents`) and `frequency = 'annual'` canonical in the row, so there is
 * nothing to re-derive here — the database is the sole authority for those
 * amounts.
 *
 * `notify-eval`'s buffer trigger and the `intent-summary` edge function both
 * call this, so Siri and the app never disagree.
 */

import {
  type Amounts,
  type BudgetGroup,
  type BudgetSummary,
  type Frequency,
  type GroupSummary,
  summarise,
  type SummaryInput,
} from '@nest/plan'
import {
  configsByYear,
  financialYearForDate,
  FY2027_CONFIG,
  type HouseholdTaxEstimate,
  isDateInFinancialYear,
} from '@nest/tax'
import {
  activeNowTaxableInflows,
  type BudgetLineRow,
  type InterestGoalRow,
  projectedInterestIncomeInputs,
  type SaverRow,
} from './adapters.ts'
import { estimateHouseholdTaxFromRows, type InflowRow, type TaxEstimateRows } from './tax.ts'

/** A `temporary_item` row: a fortnightly contribution running through a target date. */
export interface TemporaryItemRow {
  contribution_cents: number
  target_date: string
}

/** Everything `summariseHouseholdFromRows` reads — the tax-estimate rows plus the plan rows. */
export interface BudgetSummaryBundle extends TaxEstimateRows {
  budgetLines: readonly BudgetLineRow[]
  temporaryItems: readonly TemporaryItemRow[]
  /** Savings goals — a goal modelling an interest rate feeds projected interest into the estimate. */
  savingsGoals: readonly InterestGoalRow[]
  /** Synced Up savers (`source = 'up'`, `type = 'savings'`) — resolves a goal's linked-saver balance. */
  savers: readonly SaverRow[]
}

/**
 * Combines two reconciliations of the same plan into the figures the Summary
 * reports: every ANNUAL figure from `wholeYear`, every FORTNIGHTLY figure (and
 * the group portions that divide by fortnightly available cash) from
 * `activeNow`. Budget lines, temporary items, and one-off money are identical in
 * both runs and pass straight through.
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
 * The whole Summary reconciliation from the household's rows, at `now`. Pure —
 * the same rows in always give the same buffer out. The financial year and tax
 * config are read from `now`, matching the PWA's `financialYearForDate(new
 * Date())` / `currentTaxConfig()`.
 */
export function summariseHouseholdFromRows(
  bundle: BudgetSummaryBundle,
  now: Date,
): BudgetSummary {
  const financialYear = financialYearForDate(now)
  const config = configsByYear[financialYear] ?? FY2027_CONFIG

  // Projected savings interest is steady, always-active `other` income, so the
  // same inputs feed the whole-year estimate and the active-now rerun.
  const interestIncomes = projectedInterestIncomeInputs(
    bundle.savingsGoals,
    bundle.savers,
    bundle.members,
  )
  const budgetLines = bundle.budgetLines.map((line) => ({
    group: line.line_group as BudgetGroup,
    amountCents: line.amount_cents,
    frequency: line.frequency as Frequency,
    ...(line.interval_count != null && { interval: line.interval_count }),
  }))
  const nonTaxableInflows = bundle.inflows.flatMap((inflow) =>
    inflow.taxable || inflow.schedule == null ? [] : [{
      amountCents: inflow.amount_cents ?? 0,
      frequency: inflow.schedule as Frequency,
      ...(inflow.interval_count != null && { interval: inflow.interval_count }),
      ...(inflow.starts_on != null && { startsOn: inflow.starts_on }),
      ...(inflow.ends_on != null && { endsOn: inflow.ends_on }),
    }]
  )
  const oneOffCents = bundle.inflows.reduce(
    (total, inflow) =>
      inflow.paid_on != null && isDateInFinancialYear(inflow.paid_on, financialYear)
        ? total + (inflow.amount_cents ?? 0)
        : total,
    0,
  )
  const temporaryItems = bundle.temporaryItems.map((item) => ({
    contributionCents: item.contribution_cents,
    targetDate: item.target_date,
  }))

  const inputFor = (estimate: HouseholdTaxEstimate): SummaryInput => {
    const oneOffTaxCents = estimate.annualOneOffGrossCents - estimate.annualOneOffAfterTaxCents
    return {
      afterTaxIncomeAnnualCents: estimate.annualAfterTaxCents - estimate.annualOneOffAfterTaxCents,
      salarySacrificeAnnualCents: estimate.annualNetConcessionalSuperCents,
      taxAnnualCents: estimate.annualTaxCents -
        oneOffTaxCents +
        (estimate.annualConcessionalContributionsCents -
          estimate.annualNetConcessionalSuperCents),
      oneOffCents,
      nonTaxableInflows,
      budgetLines,
      temporaryItems,
    }
  }
  const estimateOver = (rows: readonly InflowRow[]): HouseholdTaxEstimate =>
    estimateHouseholdTaxFromRows({ ...bundle, inflows: rows }, config, interestIncomes)

  const wholeYear = summarise(inputFor(estimateOver(bundle.inflows)), now)
  const activeNow = summarise(
    inputFor(estimateOver(activeNowTaxableInflows(bundle.inflows, now))),
    now,
  )
  return reportedSummary(wholeYear, activeNow)
}
