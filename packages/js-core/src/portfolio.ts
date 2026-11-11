import { toTradeInputs, type TradeRow } from '@nest/household'
import {
  capitalGainsSummary,
  holdingValueCents,
  lastPriceByTicker,
  matchTrades,
  MICRO_UNITS_PER_UNIT,
  unitsValueCents,
} from '@nest/tax'

/** A trade as the Investments screen reads it: the engine's columns plus its id. */
export interface PortfolioTrade extends TradeRow {
  id: string
}

/** The input of {@link portfolioOf}: every household trade, and the members to report. */
export interface PortfolioInput {
  trades: PortfolioTrade[]
  memberIds: string[]
}

/**
 * Each member's holdings (FIFO-matched, valued at each ticker's last traded
 * price), realised gains per financial year (newest first) and oversold units,
 * and each trade's value before brokerage, as the PWA's Investments tab shows them.
 */
export function portfolioOf(input: PortfolioInput) {
  const inputs = toTradeInputs(input.trades)
  const prices = lastPriceByTicker(inputs)
  const { holdings, gains, unmatchedSales } = matchTrades(inputs)
  return {
    members: input.memberIds.map((memberId) => {
      const memberGains = gains.filter((gain) => gain.memberId === memberId)
      const years = [...new Set(memberGains.map((gain) => gain.financialYear))].sort(
        (a, b) => b - a,
      )
      return {
        memberId,
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
    }),
    tradeValues: input.trades.map((trade) => ({
      tradeId: trade.id,
      valueCents: unitsValueCents(
        Math.round(Number(trade.units) * MICRO_UNITS_PER_UNIT),
        trade.price_per_unit_microdollars,
      ),
    })),
  }
}

/** The input of {@link tradeFigures}: the form's typed dollar and unit amounts. */
export interface TradeFiguresInput {
  units: string
  price: string
  fee: string
}

/** A typed amount as a number, or null when blank or not a number. */
function parseAmount(text: string): number | null {
  if (text.trim() === '') {
    return null
  }
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : null
}

/**
 * The trade form's typed amounts as stored figures: units as a number, the price
 * in integer microdollars and the brokerage fee in integer cents (zero when
 * blank), as the PWA's `dollarsToMicrodollars` and `dollarsToCents` read them.
 */
export function tradeFigures(input: TradeFiguresInput) {
  const units = parseAmount(input.units)
  const price = parseAmount(input.price)
  const fee = parseAmount(input.fee)
  return {
    units,
    priceMicrodollars: price === null ? null : Math.round(price * 1_000_000),
    feeCents: fee === null ? 0 : Math.round(fee * 100),
  }
}
