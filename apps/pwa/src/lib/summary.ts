import type { SummaryInput } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Inflow } from '../hooks/useInflows'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import { applyBreakdownAmounts } from './derivedBudget'

/** The household rows a Summary is built from, before adapting to the plan's shape. */
export interface SummarySources {
  /** After-tax income for the year, in cents, from the household tax estimate. */
  afterTaxIncomeAnnualCents: number
  inflows: Inflow[]
  budgetLines: BudgetLine[]
  /** Each breakdown's rolled-up annual total, keyed by breakdown id, for derived lines. */
  breakdownTotals: Map<string, number>
  temporaryItems: TemporaryItem[]
  /** Annual income tax and levies (including the 15% super contributions tax) for the gross-basis view. */
  taxAnnualCents?: number
  /** Annual net salary-sacrifice super (after the 15% contributions tax) for the gross-basis view. */
  netConcessionalSuperAnnualCents?: number
}

/**
 * Adapts the household's rows to the plan's `SummaryInput`: non-taxable inflows
 * become the available-cash top-up, each budget line contributes its normalised
 * amount (a derived line taking its breakdown's rolled-up annual total), and each
 * temporary item its dated contribution. Pure — no React, no I/O.
 */
export function toSummaryInput({
  afterTaxIncomeAnnualCents,
  inflows,
  budgetLines,
  breakdownTotals,
  temporaryItems,
  taxAnnualCents = 0,
  netConcessionalSuperAnnualCents = 0,
}: SummarySources): SummaryInput {
  return {
    afterTaxIncomeAnnualCents,
    taxAnnualCents,
    netConcessionalSuperAnnualCents,
    nonTaxableInflows: inflows
      .filter((inflow) => !inflow.taxable)
      .map((inflow) => ({
        amountCents: inflow.amount_cents ?? 0,
        frequency: inflow.schedule,
        interval: inflow.interval_count ?? undefined,
      })),
    budgetLines: applyBreakdownAmounts(budgetLines, breakdownTotals).map((line) => ({
      group: line.line_group,
      amountCents: line.amount_cents,
      frequency: line.frequency,
      interval: line.interval_count ?? undefined,
    })),
    temporaryItems: temporaryItems.map((item) => ({
      contributionCents: item.contribution_cents,
      targetDate: item.target_date,
    })),
  }
}
