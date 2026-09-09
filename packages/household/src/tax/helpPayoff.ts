/**
 * Projecting when a member's HELP/HECS debt clears, holding their repayment
 * income constant, and the per-member and one-line summaries built on it.
 */

import {
  financialYearForDate,
  projectHelpPayoff,
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type TaxBreakdown,
  type TaxYearConfig,
} from '@nest/tax'
import type { HelpDebtRow } from '../rows.ts'
import { currentTaxConfig } from './config.ts'
import { helpDebtCentsByMember } from './superBases.ts'

/** Years the HELP/HECS payoff projection runs before giving up on clearing the debt. */
export const HELP_PAYOFF_MAX_YEARS = 40

/**
 * Projects when a member's HELP/HECS debt is paid off, holding their repayment
 * income (from the tax breakdown) constant and starting from the financial year
 * `now` falls in. `config` reuses the current year's rates for every future year.
 */
export function helpPayoffForBreakdown(
  breakdown: TaxBreakdown,
  balanceCents: number,
  config: TaxYearConfig,
  now: Date = new Date(),
): HelpPayoffProjection {
  return projectHelpPayoff(
    balanceCents,
    breakdown.repaymentIncomeCents,
    config,
    financialYearForDate(now),
    HELP_PAYOFF_MAX_YEARS,
  )
}

/**
 * A one-line, user-facing summary of a HELP/HECS payoff projection: the financial
 * year and years-to-go when it clears, or a note that it does not clear within the
 * projection horizon at the member's current income.
 */
export function helpPayoffSummary(projection: HelpPayoffProjection): string {
  if (projection.paidOffFinancialYear !== null) {
    const years = projection.yearsToPayOff ?? 0
    return `HELP debt projected paid off in FY${projection.paidOffFinancialYear} (${years} year${
      years === 1 ? '' : 's'
    })`
  }
  return `HELP debt not cleared within ${HELP_PAYOFF_MAX_YEARS} years at current income`
}

/**
 * Each member's HELP/HECS payoff projection, keyed by member id, for those whose
 * HELP balance is positive. Members without a HELP debt are omitted.
 */
export function helpPayoffByMember(
  estimate: HouseholdTaxEstimate,
  helpDebts: readonly HelpDebtRow[],
  config: TaxYearConfig = currentTaxConfig(),
  now: Date = new Date(),
): Map<string, HelpPayoffProjection> {
  const balanceByMember = helpDebtCentsByMember(helpDebts)
  const byMember = new Map<string, HelpPayoffProjection>()
  for (const member of estimate.members) {
    const balanceCents = balanceByMember.get(member.memberId) ?? 0
    if (balanceCents > 0) {
      byMember.set(
        member.memberId,
        helpPayoffForBreakdown(member.breakdown, balanceCents, config, now),
      )
    }
  }
  return byMember
}
