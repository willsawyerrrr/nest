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
import { isBudgetLineActive } from './lifespan.ts'
import { annualCents, fortnightlyCents } from './normalize.ts'
import type { Amounts } from './summary.ts'

/** The budget groups in display order. */
const GROUPS: readonly BudgetGroup[] = ['needs', 'wants', 'discretionary', 'savings', 'investments']

/** The Budget screen's figures for a set of lines and allowances. */
export interface BudgetOverview {
  /** Each input line's amounts, in input order, whether or not it is active. */
  readonly lines: readonly Amounts[]
  /**
   * Each group's fortnightly subtotal. A line drawn from an allowance counts
   * inside the allowance, which joins Discretionary in full, so the subtotals
   * agree with the Summary.
   */
  readonly groups: Readonly<Record<BudgetGroup, number>>
  readonly allowances: readonly AllowanceSummary[]
}

/**
 * Reconciles `lines` and `allowances` into the Budget screen's figures. Every
 * line has its amounts; with `today` (the household's local day), only the lines
 * active that day count toward the group subtotals and allowances, so an item
 * not yet started or already retired is listed but not totalled.
 */
export function budgetOverview(
  lines: readonly BudgetLine[],
  allowances: readonly MemberAllowance[],
  today?: string,
): BudgetOverview {
  const amounts = lines.map((line) => ({
    fortnightlyCents: fortnightlyCents(line.amountCents, line.frequency, line.interval),
    annualCents: annualCents(line.amountCents, line.frequency, line.interval),
  }))
  const counts = (line: BudgetLine) => today === undefined || isBudgetLineActive(line, today)
  const summaries = summariseAllowances(lines.filter(counts), allowances)
  const groups = Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<
    BudgetGroup,
    number
  >
  lines.forEach((line, index) => {
    if (counts(line) && !isDrawnFromAllowance(line, allowances)) {
      groups[line.group] += amounts[index]!.fortnightlyCents
    }
  })
  groups.discretionary += summaries.reduce(
    (total, summary) => total + summary.allowance.fortnightlyCents,
    0,
  )
  return { lines: amounts, groups, allowances: summaries }
}
