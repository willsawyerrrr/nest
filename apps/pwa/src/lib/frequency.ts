import type { Frequency } from '@nest/plan'

/** Human-readable labels for the fixed (non-interpolated) frequencies. */
const FIXED_LABELS: Record<Exclude<Frequency, 'every_n_weeks'>, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Biannually',
  annual: 'Annually',
}

/**
 * Renders a frequency as a human-readable label. `every_n_weeks` interpolates
 * its interval (e.g. `Every 4 weeks`, or `Every week` when the interval is 1),
 * falling back to `Every N weeks` when no valid interval is supplied. Every
 * other value maps to its fixed label (e.g. `fortnightly` → `Fortnightly`).
 */
export function formatFrequency(frequency: Frequency, intervalWeeks?: number | null): string {
  if (frequency === 'every_n_weeks') {
    if (!intervalWeeks || !Number.isFinite(intervalWeeks)) {
      return 'Every N weeks'
    }
    return intervalWeeks === 1 ? 'Every week' : `Every ${intervalWeeks} weeks`
  }
  return FIXED_LABELS[frequency]
}
