/**
 * Startup-equity and held-share valuation inputs for net worth: each grant with
 * the units its exercises and sales have moved, and each member's holdings at the
 * last traded price.
 */

import type { EquityGrant } from '@nest/plan'
import { holdingValueCents, lastPriceByTicker, matchTrades } from '@nest/tax'
import type { EquityHolding } from './netWorth.ts'
import type { MemberRow, TradeRow } from './rows.ts'
import { toTradeInputs } from './tax/trades.ts'

/** The `equity_grant` columns valuation reads. */
export interface NetWorthEquityGrantRow {
  id: string
  member_id: string
  label: string
  instrument_type: string
  quantity: number
  grant_date: string
  cliff_months: number
  vesting_period_months: number
  vesting_frequency: string
  strike_price_cents: number | null
  price_per_share_cents: number
}

/** An `equity_exercise` or `equity_sale` row's units against a grant. */
export interface GrantUnitsRow {
  id: string
  grant_id: string
  quantity: number
}

/** A member as net worth labels them. */
export interface NetWorthMemberRow extends MemberRow {
  name: string
}

/** The whole units of a grant exercised and sold, and what remains of each. */
export interface GrantHoldings {
  exercised: number
  sold: number
  /** Granted options not yet exercised; zero for a share grant. */
  unexercised: number
  /** Shares that can still be sold: exercised options (or granted shares) not yet sold. */
  sellable: number
}

/**
 * A grant's exercised and sold units, from the recorded rows, and the headroom
 * left for each. `ignoreExerciseId` and `ignoreSaleId` leave one row out, for
 * validating an edit of it.
 */
export function grantHoldings(
  grant: { id: string; instrument_type: string; quantity: number },
  exercises: readonly GrantUnitsRow[],
  sales: readonly GrantUnitsRow[],
  ignoreExerciseId?: string,
  ignoreSaleId?: string,
): GrantHoldings {
  const total = (rows: readonly GrantUnitsRow[], ignore?: string) =>
    rows
      .filter((row) => row.grant_id === grant.id && row.id !== ignore)
      .reduce((sum, row) => sum + row.quantity, 0)
  const exercised = total(exercises, ignoreExerciseId)
  const sold = total(sales, ignoreSaleId)
  const isOption = grant.instrument_type === 'option'
  return {
    exercised,
    sold,
    unexercised: isOption ? Math.max(0, grant.quantity - exercised) : 0,
    sellable: Math.max(0, (isOption ? exercised : grant.quantity) - sold),
  }
}

/**
 * Maps a stored equity-grant row to the pure `@nest/plan` grant shape the vesting
 * and valuation math consumes, carrying the units its recorded exercises and
 * sales have already moved.
 */
export function equityGrantToPlan(
  grant: NetWorthEquityGrantRow,
  exercises: readonly GrantUnitsRow[] = [],
  sales: readonly GrantUnitsRow[] = [],
): EquityGrant {
  const { exercised, sold } = grantHoldings(grant, exercises, sales)
  return {
    quantity: grant.quantity,
    grantDate: grant.grant_date,
    cliffMonths: grant.cliff_months,
    vestingPeriodMonths: grant.vesting_period_months,
    vestingFrequency: grant.vesting_frequency as EquityGrant['vestingFrequency'],
    instrumentType: grant.instrument_type as EquityGrant['instrumentType'],
    strikePriceCents: grant.strike_price_cents ?? null,
    pricePerShareCents: grant.price_per_share_cents,
    exercisedQuantity: exercised,
    soldQuantity: sold,
  }
}

/** The name of the member with `id`, or `'Unknown'` when none matches. */
export function heldMemberName(
  members: readonly { id: string; name: string }[],
  id: string,
): string {
  return members.find((member) => member.id === id)?.name ?? 'Unknown'
}

/**
 * Every member's share and ETF holdings as net-worth equity holdings, valued at
 * the last traded price: one entry per member and ticker with a positive value.
 */
export function heldEquityHoldings(
  trades: readonly TradeRow[],
  members: readonly { id: string; name: string }[],
): EquityHolding[] {
  const inputs = toTradeInputs(trades)
  const prices = lastPriceByTicker(inputs)
  return matchTrades(inputs)
    .holdings.map((holding) => ({
      label: `${heldMemberName(members, holding.memberId)} — ${holding.ticker}`,
      valueCents: holdingValueCents(holding, prices.get(holding.ticker)!),
    }))
    .filter((holding) => holding.valueCents > 0)
}
