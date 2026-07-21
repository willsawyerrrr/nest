import type { Frequency } from './domain'

/** Human-readable labels for the fixed (non-interpolated) frequencies. */
const FIXED_LABELS: Record<Exclude<Frequency, 'every_n_weeks' | 'every_n_months'>, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Biannually',
  annual: 'Annually',
}

/**
 * Renders a frequency as a human-readable label. `every_n_weeks` and
 * `every_n_months` interpolate their interval (e.g. `Every 4 weeks` /
 * `Every 3 months`, or `Every week` / `Every month` when the interval is 1),
 * falling back to `Every N weeks` / `Every N months` when no valid interval is
 * supplied. Every other value maps to its fixed label (e.g. `fortnightly` →
 * `Fortnightly`).
 */
export function formatFrequency(frequency: Frequency, interval?: number | null): string {
  if (frequency === 'every_n_weeks') {
    if (!interval || !Number.isFinite(interval)) {
      return 'Every N weeks'
    }
    return interval === 1 ? 'Every week' : `Every ${interval} weeks`
  }
  if (frequency === 'every_n_months') {
    if (!interval || !Number.isFinite(interval)) {
      return 'Every N months'
    }
    return interval === 1 ? 'Every month' : `Every ${interval} months`
  }
  return FIXED_LABELS[frequency]
}

/**
 * Select options for every frequency, in fixed-label order then the interpolated
 * cadences (`every_n_weeks`, `every_n_months`).
 */
export const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  ...(
    Object.entries(FIXED_LABELS) as [
      Exclude<Frequency, 'every_n_weeks' | 'every_n_months'>,
      string,
    ][]
  ).map(([value, label]) => ({ value, label })),
  { value: 'every_n_weeks', label: formatFrequency('every_n_weeks') },
  { value: 'every_n_months', label: formatFrequency('every_n_months') },
]
