/**
 * Startup equity vesting and valuation: how much of a grant has vested by a given
 * date, and the current value of that vested portion. Pure and deterministic —
 * the `asOf` date is passed in, never read from the clock here.
 */

import type { Money } from './index'

/** Whether a grant is options (exercisable at a strike) or shares held outright. */
export type EquityInstrumentType = 'option' | 'share'

/** How often a grant's tranches vest after the cliff. */
export type VestingFrequency = 'monthly' | 'quarterly' | 'annual'

/** Whole months in one vesting interval, keyed by frequency. */
const INTERVAL_MONTHS: Record<VestingFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
}

/**
 * A single equity grant's vesting shape and current price. `grantDate` is an ISO
 * date (YYYY-MM-DD). `quantity` is whole units. `strikePriceCents` is the
 * per-share exercise price for options and null for shares; `pricePerShareCents`
 * is the user-maintained current fair value per share.
 */
export interface EquityGrant {
  readonly quantity: number
  readonly grantDate: string
  readonly cliffMonths: number
  readonly vestingPeriodMonths: number
  readonly vestingFrequency: VestingFrequency
  readonly instrumentType: EquityInstrumentType
  readonly strikePriceCents: Money | null
  readonly pricePerShareCents: Money
}

/**
 * Whole months elapsed from `grantDate` to `asOf`: complete calendar months,
 * counting the day-of-month so a partial final month is not counted until the
 * anniversary day is reached. Negative when `asOf` precedes the grant.
 */
function wholeMonthsElapsed(grantDate: string, asOf: Date): number {
  const parts = grantDate.split('-')
  const gy = Number(parts[0])
  const gm = Number(parts[1])
  const gd = Number(parts[2])
  const ay = asOf.getFullYear()
  const am = asOf.getMonth() + 1
  const ad = asOf.getDate()
  let months = (ay - gy) * 12 + (am - gm)
  if (ad < gd) {
    months -= 1
  }
  return months
}

/**
 * The whole number of units vested as of `asOf`, rounding down. Nothing vests
 * before the cliff; from the cliff on, whole tranches vest on each interval
 * boundary, and the grant is fully vested once the vesting period has elapsed.
 * The cliff is assumed to be a whole multiple of the vesting interval, so the
 * tranches accrued to the cliff all vest together at the cliff boundary.
 */
export function vestedQuantity(grant: EquityGrant, asOf: Date): number {
  const elapsed = wholeMonthsElapsed(grant.grantDate, asOf)
  if (elapsed < grant.cliffMonths) {
    return 0
  }
  const interval = INTERVAL_MONTHS[grant.vestingFrequency]
  const vestedMonths = Math.floor(elapsed / interval) * interval
  const vestedFraction = Math.min(1, vestedMonths / grant.vestingPeriodMonths)
  return Math.floor(grant.quantity * vestedFraction)
}

/**
 * The current value of a grant's vested portion, in integer cents, never
 * negative. Options are valued at their intrinsic "if exercised today" gain —
 * vested units times the excess of the price per share over the strike (a null
 * strike counts as zero). Shares are valued at vested units times the price per
 * share.
 */
export function grantValueCents(grant: EquityGrant, asOf: Date): number {
  const vested = vestedQuantity(grant, asOf)
  if (grant.instrumentType === 'option') {
    const intrinsic = grant.pricePerShareCents - (grant.strikePriceCents ?? 0)
    return vested * Math.max(0, intrinsic)
  }
  return vested * grant.pricePerShareCents
}

/** The summed vested value of every grant as of `asOf`, in integer cents. */
export function equityTotalCents(grants: readonly EquityGrant[], asOf: Date): number {
  return grants.reduce((total, grant) => total + grantValueCents(grant, asOf), 0)
}
