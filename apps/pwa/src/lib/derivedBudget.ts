import type { BudgetDerivedSource, BudgetLine } from '../hooks/useBudgetLines'
import { giftBudgetTotalCents, type GiftBudget } from './gifts'
import { medicationsAnnualTotalCents, type Medication } from './medications'

/**
 * Replaces the effective amount of every budget line derived from `source` with
 * `total`, treated as an annual figure. A derived line takes its amount from its
 * tracker rather than its typed `amount_cents`, so the budget and the tracker
 * stay one source of truth. Lines from other sources (and manual lines) pass
 * through untouched, and with no matching line present the input is returned
 * as-is.
 */
function applyDerivedAmount(
  lines: BudgetLine[],
  source: BudgetDerivedSource,
  total: number,
): BudgetLine[] {
  if (!lines.some((line) => line.derived_source === source)) {
    return lines
  }
  return lines.map((line) =>
    line.derived_source === source ? { ...line, amount_cents: total, frequency: 'annual' } : line,
  )
}

/**
 * Replaces the effective amount of any gift-derived budget line with the
 * household's total planned gift spend, treated as an annual figure.
 */
export function applyGiftDerivedAmounts(
  lines: BudgetLine[],
  giftBudgets: GiftBudget[],
): BudgetLine[] {
  return applyDerivedAmount(lines, 'gift', giftBudgetTotalCents(giftBudgets))
}

/**
 * Replaces the effective amount of any medication-derived budget line with the
 * household's total annual medication cost.
 */
export function applyMedicationDerivedAmounts(
  lines: BudgetLine[],
  medications: Medication[],
): BudgetLine[] {
  return applyDerivedAmount(lines, 'medication', medicationsAnnualTotalCents(medications))
}
