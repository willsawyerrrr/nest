import type { SummaryInput } from '@nest/plan'
import { isDateInFinancialYear } from '@nest/tax'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Inflow } from '../hooks/useInflows'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import type { DerivedAmountContext } from './breakdowns'
import { applyBreakdownAmounts } from './derivedBudget'

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
 * become the available-cash top-up, each budget line contributes its normalised
 * amount (a derived line taking its breakdown's rolled-up annual total), and each
 * temporary item its dated contribution. Pure — no React, no I/O.
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
