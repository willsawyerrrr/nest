import {
  exerciseCostCents,
  grantValueCents,
  grossVestedValueCents,
  heldShareQuantity,
  vestedQuantity,
  type EquityInstrumentType,
  type VestingFrequency,
} from '@nest/plan'

/** An `equity_grant` row as the roll-up reads it. */
export interface EquityGrantInput {
  id: string
  instrument_type: EquityInstrumentType
  quantity: number
  grant_date: string
  cliff_months: number
  vesting_period_months: number
  vesting_frequency: VestingFrequency
  strike_price_cents: number | null
  price_per_share_cents: number
}

/** An `equity_exercise` or `equity_sale` row as the roll-up reads it. */
export interface EquityMovementInput {
  grant_id: string
  quantity: number
}

/** The input of {@link summariseEquity}. */
export interface EquityInput {
  grants: EquityGrantInput[]
  exercises: EquityMovementInput[]
  sales: EquityMovementInput[]
  /** ISO 8601 instant the grants are valued at. */
  now: string
}

/** One grant's derived facts, in whole units and cents. */
export interface GrantFigures {
  grantId: string
  vested: number
  exercised: number
  sold: number
  held: number
  grossCents: number
  exerciseCents: number
  netCents: number
}

const total = (rows: EquityMovementInput[], grantId: string) =>
  rows.filter((row) => row.grant_id === grantId).reduce((sum, row) => sum + row.quantity, 0)

/**
 * Each grant's vested quantity, units exercised, sold and held, gross vested value,
 * exercise cost and net value at `input.now`: the figures the PWA's Equity screen
 * draws from `@nest/plan`, after the grant's recorded exercises and sales.
 */
export function summariseEquity(input: EquityInput): GrantFigures[] {
  const asOf = new Date(input.now)
  return input.grants.map((grant) => {
    const exercised = total(input.exercises, grant.id)
    const sold = total(input.sales, grant.id)
    const plan = {
      quantity: grant.quantity,
      grantDate: grant.grant_date,
      cliffMonths: grant.cliff_months,
      vestingPeriodMonths: grant.vesting_period_months,
      vestingFrequency: grant.vesting_frequency,
      instrumentType: grant.instrument_type,
      strikePriceCents: grant.strike_price_cents,
      pricePerShareCents: grant.price_per_share_cents,
      exercisedQuantity: exercised,
      soldQuantity: sold,
    }
    return {
      grantId: grant.id,
      vested: vestedQuantity(plan, asOf),
      exercised,
      sold,
      held: heldShareQuantity(plan, asOf),
      grossCents: grossVestedValueCents(plan, asOf),
      exerciseCents: exerciseCostCents(plan, asOf),
      netCents: grantValueCents(plan, asOf),
    }
  })
}
