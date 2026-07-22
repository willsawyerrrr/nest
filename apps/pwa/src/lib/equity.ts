import type { EquityGrant, EquityInstrumentType, VestingFrequency } from '@nest/plan'
import type { EquityGrantRow } from '../hooks/useEquityGrants'

/** Human-readable labels for each equity instrument type, for forms and lists. */
export const EQUITY_INSTRUMENT_TYPES: { value: EquityInstrumentType; label: string }[] = [
  { value: 'option', label: 'Options' },
  { value: 'share', label: 'Shares' },
]

/** Human-readable labels for each vesting frequency, for forms and lists. */
export const VESTING_FREQUENCIES: { value: VestingFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
]

/**
 * Maps a stored equity-grant row to the pure `@nest/plan` grant shape the vesting
 * and valuation math consumes.
 */
export function equityGrantToPlan(grant: EquityGrantRow): EquityGrant {
  return {
    quantity: grant.quantity,
    grantDate: grant.grant_date,
    cliffMonths: grant.cliff_months,
    vestingPeriodMonths: grant.vesting_period_months,
    vestingFrequency: grant.vesting_frequency as VestingFrequency,
    instrumentType: grant.instrument_type as EquityInstrumentType,
    strikePriceCents: grant.strike_price_cents,
    pricePerShareCents: grant.price_per_share_cents,
  }
}
