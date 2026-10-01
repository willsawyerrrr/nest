import {
  capitalGainsSummary,
  holdingValueCents,
  lastPriceByTicker,
  matchTrades,
  type CapitalGainsSummary,
  type Holding,
  type UnmatchedSale,
} from '@nest/tax'
import type { Member } from '../hooks/useMembers'
import type { TradeInput, TradeRow } from '../hooks/useTrades'
import type { TradeSide } from './domain'
import { memberName } from './members'
import type { EquityHolding } from './super'
import { toTradeInputs } from './tax'

/** Human-readable labels for each trade side, for the form and lists. */
export const TRADE_SIDES: { value: TradeSide; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
]

/** A member's holding with its market value at the last traded price. */
export interface HoldingView extends Holding {
  /** The last traded price per unit for the ticker, across the household. */
  lastPriceCents: number
  valueCents: number
}

/** One member's holdings, realised gains per financial year, and oversold units. */
export interface MemberPortfolio {
  holdings: HoldingView[]
  /** Capital gains positions for each financial year with a sale, newest first. */
  gainsByYear: CapitalGainsSummary[]
  unmatchedSales: UnmatchedSale[]
}

/**
 * Derives a member's portfolio from every household trade: FIFO-matched holdings
 * valued at each ticker's last traded price, and a capital gains summary for each
 * financial year the member made a sale in.
 */
export function memberPortfolio(trades: readonly TradeRow[], memberId: string): MemberPortfolio {
  const inputs = toTradeInputs(trades)
  const prices = lastPriceByTicker(inputs)
  const { holdings, gains, unmatchedSales } = matchTrades(inputs)
  const memberGains = gains.filter((gain) => gain.memberId === memberId)
  const years = [...new Set(memberGains.map((gain) => gain.financialYear))].sort((a, b) => b - a)
  return {
    holdings: holdings
      .filter((holding) => holding.memberId === memberId)
      .map((holding) => {
        const lastPriceCents = prices.get(holding.ticker)!
        return {
          ...holding,
          lastPriceCents,
          valueCents: holdingValueCents(holding, lastPriceCents),
        }
      }),
    gainsByYear: years.map((year) => capitalGainsSummary(memberGains, year)),
    unmatchedSales: unmatchedSales.filter((sale) => sale.memberId === memberId),
  }
}

/**
 * Every member's holdings as net-worth equity holdings, valued at the last traded
 * price: one entry per member and ticker with a positive value.
 */
export function heldEquityHoldings(
  trades: readonly TradeRow[],
  members: Member[],
): EquityHolding[] {
  const inputs = toTradeInputs(trades)
  const prices = lastPriceByTicker(inputs)
  return matchTrades(inputs)
    .holdings.map((holding) => ({
      label: `${memberName(members, holding.memberId)} — ${holding.ticker}`,
      valueCents: holdingValueCents(holding, prices.get(holding.ticker)!),
    }))
    .filter((holding) => holding.valueCents > 0)
}

/**
 * The existing trade a candidate looks like a repeat of — same member, ticker,
 * date, units, and price — or undefined. `ignoreId` skips the trade being edited.
 */
export function findDuplicateTrade(
  trades: readonly TradeRow[],
  candidate: TradeInput,
  ignoreId?: string,
): TradeRow | undefined {
  return trades.find(
    (trade) =>
      trade.id !== ignoreId &&
      trade.member_id === candidate.member_id &&
      trade.ticker === candidate.ticker &&
      trade.traded_on === candidate.traded_on &&
      Number(trade.units) === candidate.units &&
      trade.price_per_unit_cents === candidate.price_per_unit_cents,
  )
}
