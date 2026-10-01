/** Maps stored `trade` rows to the `@nest/tax` capital-gains engine's inputs. */

import type { TradeInput } from '@nest/tax'
import type { TradeRow } from '../rows.ts'

/** The engine's trade inputs for `trade` rows; `units` is coerced since PostgREST may serialise `numeric` as a string. */
export function toTradeInputs(trades: readonly TradeRow[]): TradeInput[] {
  return trades.map((trade) => ({
    memberId: trade.member_id,
    ticker: trade.ticker,
    side: trade.side === 'sell' ? 'sell' : 'buy',
    tradedOn: trade.traded_on,
    units: Number(trade.units),
    pricePerUnitCents: trade.price_per_unit_cents,
    feeCents: trade.fee_cents,
  }))
}
