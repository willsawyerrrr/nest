/** Maps between a savings goal's stored interest rate (basis points) and the form's percent field. */

/** Stored basis points as a percent for the rate field, or `''` when no rate is set. */
export function interestBpsToPercent(bps: number | null | undefined): number | '' {
  return bps == null ? '' : bps / 100
}

/** A rate-field percent value as whole basis points, or `null` when blank or not a number. */
export function interestPercentToBps(value: number | string): number | null {
  if (value === '' || value == null) {
    return null
  }
  const percent = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(percent)) {
    return null
  }
  return Math.round(percent * 100)
}

/**
 * The assumed-rate note shown beside a goal's ETA (e.g. `4.50% p.a. assumed`),
 * or `null` when the goal models no interest.
 */
export function assumedInterestNote(bps: number | null | undefined): string | null {
  if (bps == null || bps <= 0) {
    return null
  }
  return `${(bps / 100).toFixed(2)}% p.a. assumed`
}
