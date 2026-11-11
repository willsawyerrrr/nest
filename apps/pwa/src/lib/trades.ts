import {
  capitalGainsSummary,
  holdingValueCents,
  lastPriceByTicker,
  matchTrades,
  MICRO_UNITS_PER_UNIT,
  unitsValueCents,
  type CapitalGainsSummary,
  type Holding,
  type UnmatchedSale,
} from '@nest/tax'
import type { TradeInput, TradeRow } from '../hooks/useTrades'
import type { TradeSide } from './domain'
import { memberName } from './members'
import { formatCents, formatUnitPrice } from './money'
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
  /** Integer microdollars. */
  lastPriceMicrodollars: number
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
        const lastPriceMicrodollars = prices.get(holding.ticker)!
        return {
          ...holding,
          lastPriceMicrodollars,
          valueCents: holdingValueCents(holding, lastPriceMicrodollars),
        }
      }),
    gainsByYear: years.map((year) => capitalGainsSummary(memberGains, year)),
    unmatchedSales: unmatchedSales.filter((sale) => sale.memberId === memberId),
  }
}

export { heldEquityHoldings } from '@nest/household'

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
      trade.price_per_unit_microdollars === candidate.price_per_unit_microdollars,
  )
}

/** A units figure without trailing zeros, grouped by thousands. */
export function formatUnits(units: number): string {
  return units.toLocaleString('en-AU', { maximumFractionDigits: 6 })
}

/** A units figure with its noun, e.g. `1 unit`, `1.5 units`. */
export function unitsText(units: number): string {
  return `${formatUnits(units)} ${units === 1 ? 'unit' : 'units'}`
}

/** A trade's value before brokerage: its units at its price, to the nearest cent. */
export function tradeValueCents(trade: TradeRow): number {
  return unitsValueCents(
    Math.round(Number(trade.units) * MICRO_UNITS_PER_UNIT),
    trade.price_per_unit_microdollars,
  )
}

/** A trade's brokerage, e.g. `$9.50 brokerage`, or an empty string when there is none. */
export function brokerageLabel(trade: TradeRow): string {
  return trade.fee_cents > 0 ? `${formatCents(trade.fee_cents)} brokerage` : ''
}

/** One holdings or realised-gains line: a title, muted cells and a figure under a caption. */
export interface SummaryLine {
  title: string
  cells: string[]
  figure: number
  figureCaption: string
}

/** A current holding as a line: units, average cost and cost base, over its market value. */
export function holdingLine(holding: HoldingView): SummaryLine {
  return {
    title: holding.ticker,
    cells: [
      unitsText(holding.units),
      `Avg cost ${formatUnitPrice(holding.averageCostMicrodollars)}`,
      `Cost base ${formatCents(holding.costBaseCents)}`,
    ],
    figure: holding.valueCents,
    figureCaption: `at ${formatUnitPrice(holding.lastPriceMicrodollars)}`,
  }
}

/** A financial year's capital gains as a line: gains, losses and discount, over the net gain. */
export function gainsLine(summary: CapitalGainsSummary): SummaryLine {
  return {
    title: `FY${summary.financialYear}`,
    cells: [
      `Gains ${formatCents(summary.gainsCents + summary.discountableGainsCents)}`,
      `Losses ${formatCents(summary.lossesCents + summary.carriedInLossesCents)}`,
      summary.discountCents > 0 ? `CGT discount ${formatCents(summary.discountCents)}` : '',
    ],
    figure: summary.netCapitalGainCents,
    figureCaption: 'net capital gain',
  }
}
