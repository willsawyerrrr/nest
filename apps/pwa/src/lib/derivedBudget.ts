import type { BudgetLine } from '../hooks/useBudgetLines'
import type { DerivedAmountContext } from './breakdowns'

/** The effective annual amount of a single derived line, resolved from the context. */
function derivedAmountCents(
  line: BudgetLine,
  breakdownId: string,
  context: DerivedAmountContext,
): number {
  if (context.giftBreakdownId !== null && breakdownId === context.giftBreakdownId) {
    return context.giftTotalsByMember.get(line.gift_recipient_member_id ?? null) ?? 0
  }
  return context.genericTotalsByBreakdownId.get(breakdownId) ?? 0
}

/**
 * Overrides the effective amount of every breakdown-derived budget line with its
 * rolled-up annual total, treated as an annual figure — so the budget and each
 * breakdown stay one source of truth and never drift. A generic line takes its
 * breakdown's item total; a gift-breakdown line takes its recipient partition's
 * share (keyed by `gift_recipient_member_id`, `null` for the external line). A
 * line with no `breakdown_id` is an ordinary manual line and passes through
 * untouched; with no derived line present the input is returned as-is. A derived
 * line missing from the context falls back to zero.
 */
export function applyBreakdownAmounts(
  lines: BudgetLine[],
  context: DerivedAmountContext,
): BudgetLine[] {
  if (!lines.some((line) => line.breakdown_id !== null)) {
    return lines
  }
  return lines.map((line) =>
    line.breakdown_id !== null
      ? {
          ...line,
          amount_cents: derivedAmountCents(line, line.breakdown_id, context),
          frequency: 'annual',
        }
      : line,
  )
}
