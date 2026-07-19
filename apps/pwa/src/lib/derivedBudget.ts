import type { BudgetLine } from '../hooks/useBudgetLines'
import { giftBudgetTotalCents, type GiftBudget } from './gifts'

/**
 * Replaces the effective amount of any gift-derived budget line with the
 * household's total planned gift spend, treated as an annual figure. A line with
 * `derived_source = 'gift'` takes its amount from the gift tracker rather than
 * its typed `amount_cents`, so the budget and the gift tracker stay one source
 * of truth. Manual lines (`derived_source = null`) pass through untouched, and
 * with no gift-derived line present the input is returned as-is.
 */
export function applyGiftDerivedAmounts(
  lines: BudgetLine[],
  giftBudgets: GiftBudget[],
): BudgetLine[] {
  if (!lines.some((line) => line.derived_source === 'gift')) {
    return lines
  }
  const total = giftBudgetTotalCents(giftBudgets)
  return lines.map((line) =>
    line.derived_source === 'gift' ? { ...line, amount_cents: total, frequency: 'annual' } : line,
  )
}
