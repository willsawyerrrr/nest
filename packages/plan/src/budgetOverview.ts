/**
 * The Budget screen's figures: each line's fortnightly and annual amounts, each
 * group's fortnightly subtotal, and each allowance reconciled against the lines
 * drawn from it. The PWA and the native app both read them from here.
 */

import {
  isDrawnFromAllowance,
  summariseAllowances,
  type AllowanceSummary,
  type MemberAllowance,
} from './allowance.ts'
import type { BudgetGroup, BudgetLine } from './index.ts'
import { annualCents, fortnightlyCents } from './normalize.ts'
import type { Amounts } from './summary.ts'

/** The budget groups in display order. */
const GROUPS: readonly BudgetGroup[] = ['needs', 'wants', 'discretionary', 'savings', 'investments']

/** The Budget screen's figures for a set of lines and allowances. */
export interface BudgetOverview {
  /** Each input line's amounts, in input order. */
  readonly lines: readonly Amounts[]
  /**
   * Each group's fortnightly subtotal. A line drawn from an allowance counts
   * inside the allowance, which joins Discretionary in full, so the subtotals
   * agree with the Summary.
   */
  readonly groups: Readonly<Record<BudgetGroup, number>>
  readonly allowances: readonly AllowanceSummary[]
}

/** Reconciles `lines` and `allowances` into the Budget screen's figures. */
export function budgetOverview(
  lines: readonly BudgetLine[],
  allowances: readonly MemberAllowance[],
): BudgetOverview {
  const amounts = lines.map((line) => ({
    fortnightlyCents: fortnightlyCents(line.amountCents, line.frequency, line.interval),
    annualCents: annualCents(line.amountCents, line.frequency, line.interval),
  }))
  const summaries = summariseAllowances(lines, allowances)
  const groups = Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<
    BudgetGroup,
    number
  >
  lines.forEach((line, index) => {
    if (!isDrawnFromAllowance(line, allowances)) {
      groups[line.group] += amounts[index]!.fortnightlyCents
    }
  })
  groups.discretionary += summaries.reduce(
    (total, summary) => total + summary.allowance.fortnightlyCents,
    0,
  )
  return { lines: amounts, groups, allowances: summaries }
}
