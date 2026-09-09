/**
 * The verified per-financial-year tax + super config the household shaping runs
 * against, and the set of years a config is published for.
 */

import { configsByYear, financialYearForDate, FY2027_CONFIG, type TaxYearConfig } from '@nest/tax'

/**
 * The verified tax + super config for the current financial year, falling back
 * to FY2027 for years without a published config.
 */
export function currentTaxConfig(): TaxYearConfig {
  return configsByYear[financialYearForDate(new Date())] ?? FY2027_CONFIG
}

/** Every financial year with a published tax config, most recent first. */
export const availableFinancialYears: readonly number[] = Object.keys(configsByYear)
  .map(Number)
  .sort((a, b) => b - a)
