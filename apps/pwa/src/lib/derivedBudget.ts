import type { BudgetLine } from '../hooks/useBudgetLines'

/**
 * Overrides the effective amount of every breakdown-derived budget line with its
 * breakdown's rolled-up annual total, keyed by `breakdown_id`, treated as an
 * annual figure — so the budget and each breakdown stay one source of truth and
 * never drift. A line with no `breakdown_id` is an ordinary manual line and
 * passes through untouched; with no derived line present the input is returned
 * as-is. A derived line missing from the map falls back to zero.
 */
export function applyBreakdownAmounts(
  lines: BudgetLine[],
  totalsByBreakdownId: Map<string, number>,
): BudgetLine[] {
  if (!lines.some((line) => line.breakdown_id !== null)) {
    return lines
  }
  return lines.map((line) =>
    line.breakdown_id !== null
      ? {
          ...line,
          amount_cents: totalsByBreakdownId.get(line.breakdown_id) ?? 0,
          frequency: 'annual',
        }
      : line,
  )
}
