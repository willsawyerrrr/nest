import type { Frequency } from '@budget/plan'

/**
 * Renders a frequency as a human-readable label. `every_n_weeks` interpolates
 * its interval (e.g. `Every 4 weeks`, or `Every week` when the interval is 1),
 * falling back to `Every N weeks` when no valid interval is supplied. Every
 * other value is the capitalised enum word (e.g. `weekly` → `Weekly`).
 */
export function formatFrequency(frequency: Frequency, intervalWeeks?: number | null): string {
  if (frequency === 'every_n_weeks') {
    if (!intervalWeeks || !Number.isFinite(intervalWeeks)) {
      return 'Every N weeks'
    }
    return intervalWeeks === 1 ? 'Every week' : `Every ${intervalWeeks} weeks`
  }
  return frequency.charAt(0).toUpperCase() + frequency.slice(1)
}
