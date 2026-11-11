import { availableFinancialYears, currentTaxConfig } from '@nest/household'
import {
  carExpenseDeductionCents,
  configsByYear,
  financialYearForDate,
  workFromHomeDeductionCents,
} from '@nest/tax'

/** The input of {@link deductionFigures}. A figure whose input is absent is zero. */
export interface DeductionFiguresInput {
  financialYear: number
  /** Work-related kilometres, for the distance basis. */
  distanceKm?: number
  /** Hours worked from home, for the hours basis. */
  hours?: number
  /** What an expense cost in full, before the work-use share. */
  fullAmountCents?: number
  /** The share of `fullAmountCents` claimed, as a percentage. */
  workUsePercent?: number
}

/**
 * The deductible share of a cost: `fullAmountCents` at `workUsePercent`, with
 * the percentage taken in hundredths so it carries no float error. Matches the
 * PWA's `workUseAmountCents`.
 */
export function workUseAmountCents(fullAmountCents: number, workUsePercent: number): number {
  const hundredthsOfAPercent = Math.round(workUsePercent * 100)
  return Math.round((fullAmountCents * hundredthsOfAPercent) / 10_000)
}

/**
 * The Deductions form's derived figures for a financial year: the ATO's rates
 * and the car-expense cap, the dollar deduction for a distance and for hours
 * worked from home, and the apportioned claim. The year's config falls back to
 * the current year's, as the form does.
 */
export function deductionFigures(input: DeductionFiguresInput) {
  const config = configsByYear[input.financialYear] ?? currentTaxConfig()
  return {
    centsPerKm: config.carExpense.centsPerKm,
    maxClaimableKm: config.carExpense.maxClaimableKm,
    centsPerHour: config.workFromHome.centsPerHour,
    distanceCents: carExpenseDeductionCents(input.distanceKm ?? 0, config),
    hoursCents: workFromHomeDeductionCents(input.hours ?? 0, config),
    apportionedCents: workUseAmountCents(input.fullAmountCents ?? 0, input.workUsePercent ?? 100),
  }
}

/** The input of {@link financialYearOptions}. */
export interface FinancialYearOptionsInput {
  /** ISO 8601 instant that picks the current financial year. */
  now: string
}

/** The current financial year at `now`, and every year with a published tax config, most recent first. */
export function financialYearOptions(input: FinancialYearOptionsInput) {
  return {
    current: financialYearForDate(new Date(input.now)),
    available: [...availableFinancialYears],
  }
}
