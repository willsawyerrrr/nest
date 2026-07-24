import type { BudgetLine } from '../hooks/useBudgetLines'
import type { DerivedAmountContext } from './breakdowns'

/** Whether a line's amount is roll-up-derived rather than manually typed: a gift line or a breakdown line. */
function isDerivedLine(line: BudgetLine): boolean {
  return line.is_gift_line || line.breakdown_id !== null
}

/** Restates a line as its rolled-up annual figure. */
function annualise(line: BudgetLine, amountCents: number): BudgetLine {
  return { ...line, amount_cents: amountCents, frequency: 'annual' }
}

/**
 * Overrides the effective amount of every roll-up-derived budget line with its
 * rolled-up annual total, treated as an annual figure — so the budget and each
 * roll-up stay one source of truth and never drift. A gift line (`is_gift_line`)
 * takes its recipient partition's share (keyed by `gift_recipient_member_id`,
 * `null` for the external line); a generic breakdown line takes its breakdown's
 * item total. A plain manual line passes through untouched; with no derived line
 * present the input is returned as-is. A derived line missing from the context
 * falls back to zero.
 */
export function applyBreakdownAmounts(
  lines: BudgetLine[],
  context: DerivedAmountContext,
): BudgetLine[] {
  if (!lines.some(isDerivedLine)) {
    return lines
  }
  return lines.map((line) => {
    if (line.is_gift_line) {
      return annualise(
        line,
        context.giftTotalsByMember.get(line.gift_recipient_member_id ?? null) ?? 0,
      )
    }
    if (line.breakdown_id !== null) {
      return annualise(line, context.genericTotalsByBreakdownId.get(line.breakdown_id) ?? 0)
    }
    return line
  })
}
