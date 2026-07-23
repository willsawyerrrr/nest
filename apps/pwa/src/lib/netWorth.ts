import type { HelpPayoffProjection } from '@nest/tax'

/** Default projection horizon in years when no member age pins it to retirement. */
export const DEFAULT_PROJECTION_HORIZON_YEARS = 30

/**
 * The projection horizon in whole years: the longest span to `retirementAge`
 * across members whose age is known, or `DEFAULT_PROJECTION_HORIZON_YEARS` when
 * none is known (or every known member is already at or past retirement).
 */
export function projectionHorizonYears(ages: readonly number[], retirementAge: number): number {
  const spans = ages.map((age) => Math.round(retirementAge - age)).filter((years) => years > 0)
  return spans.length > 0 ? Math.max(...spans) : DEFAULT_PROJECTION_HORIZON_YEARS
}

/**
 * The household's total HELP balance at each projected year (index 0 = now),
 * combining the members' payoff schedules: year 0 is `currentTotalCents`, and each
 * later year sums each member's closing balance for that year (0 once a schedule
 * has cleared or ended). Runs to `horizonYears`.
 */
export function combinedHelpCentsByYear(
  payoffs: Iterable<HelpPayoffProjection>,
  currentTotalCents: number,
  horizonYears: number,
): number[] {
  const schedules = [...payoffs].map((payoff) => payoff.schedule)
  const result = [currentTotalCents]
  for (let year = 1; year <= horizonYears; year++) {
    let sum = 0
    for (const schedule of schedules) {
      sum += schedule[year - 1]?.closingBalanceCents ?? 0
    }
    result.push(sum)
  }
  return result
}
