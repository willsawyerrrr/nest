/**
 * Share and ETF capital gains: holdings, FIFO parcel matching, realised gains and
 * losses per financial year, and the net capital gain a member is assessed on.
 * Pure and derived — everything here is recomputed from the full trade list, so
 * editing or deleting a trade recalculates every figure.
 *
 * Sales are matched to purchase parcels first-in first-out within one member's
 * holding of one ticker. A buy's brokerage joins its cost base and a sell's
 * brokerage comes off its proceeds. A parcel held for MORE than 12 months when it
 * is sold is eligible for the 50% CGT discount, applied after capital losses.
 * Units are held internally as integer micro-units and unit prices as integer
 * microdollars (`unitPrice.ts`), so nothing here uses floating point. Each
 * trade's consideration (`units × price`) is rounded half-up to whole cents once,
 * as a contract note prints it; every other figure derives from whole cents.
 *
 * Sales of startup equity are capital-gains events too (`matchEquitySales`): no
 * tax arises when options are exercised under the startup concession, so a sale's
 * cost base is the strike paid, and the CGT discount's holding period runs from
 * the grant date. Their gains join trade gains in `capitalGainsSummary`, so
 * losses net across both.
 */

import type { FinancialYear, Money } from './index.ts'
import {
  centsToMicrodollars,
  MICRO_UNITS_PER_UNIT,
  scaleRoundHalfUp,
  unitsValueCents,
  type Microdollars,
} from './unitPrice.ts'

/** The fraction of a discount-eligible gain that remains assessable (a 50% discount). */
export const CGT_DISCOUNT_RETAINED = 0.5

const MICRO = MICRO_UNITS_PER_UNIT

/** Whether a trade acquires or disposes of units. */
export type TradeSide = 'buy' | 'sell'

/** One recorded trade. `units` may be fractional (up to six decimal places). */
export interface TradeInput {
  readonly memberId: string
  readonly ticker: string
  readonly side: TradeSide
  /** The trade date (ISO `YYYY-MM-DD`). */
  readonly tradedOn: string
  readonly units: number
  /** The exact price per unit, excluding brokerage, in microdollars. */
  readonly pricePerUnitMicrodollars: Microdollars
  readonly feeCents: Money
}

/** A member's current holding of one ticker, from the parcels still unsold. */
export interface Holding {
  readonly memberId: string
  readonly ticker: string
  readonly units: number
  /** Total cost of the unsold parcels, brokerage included. */
  readonly costBaseCents: Money
  /** `costBaseCents` per unit, in microdollars (rounded half-up). */
  readonly averageCostMicrodollars: Microdollars
}

/**
 * Shares a member holds from one equity grant, available to be sold: the units of
 * one exercise (cost per unit the strike paid), or all of a share grant (nil
 * cost). `grantDate` starts the CGT discount's holding period; `acquiredOn`
 * orders the lots for matching.
 */
export interface EquityLotInput {
  readonly memberId: string
  readonly grantId: string
  /** The grant's label, reported as the gain's `ticker`. */
  readonly label: string
  readonly grantDate: string
  readonly acquiredOn: string
  readonly units: number
  readonly costPerUnitCents: Money
}

/** One sale of equity shares: whole units at a price per share, less fees. */
export interface EquitySaleInput {
  readonly memberId: string
  readonly grantId: string
  readonly label: string
  readonly soldOn: string
  readonly units: number
  readonly pricePerShareCents: Money
  readonly feeCents: Money
}

/** The portion of one sale matched against one purchase parcel. */
export interface RealisedGain {
  readonly memberId: string
  readonly ticker: string
  readonly acquiredOn: string
  readonly soldOn: string
  readonly units: number
  readonly costBaseCents: Money
  /** The share of the sale's proceeds, net of brokerage, for these units. */
  readonly proceedsCents: Money
  /** Proceeds less cost base; negative for a loss. */
  readonly gainCents: Money
  /** Whether the parcel was held for more than 12 months, earning the CGT discount. */
  readonly discountEligible: boolean
  /** The financial year the sale falls in. */
  readonly financialYear: FinancialYear
}

/** Units sold beyond what the member's recorded buys cover; excluded from every gain. */
export interface UnmatchedSale {
  readonly memberId: string
  readonly ticker: string
  readonly soldOn: string
  readonly units: number
}

/** The result of matching every trade: current holdings, realised gains, and any oversold units. */
export interface TradeMatching {
  readonly holdings: Holding[]
  readonly gains: RealisedGain[]
  readonly unmatchedSales: UnmatchedSale[]
}

/** One member's capital gains position for a financial year. */
export interface CapitalGainsSummary {
  readonly financialYear: FinancialYear
  /** Realised gains from parcels not eligible for the discount, before losses. */
  readonly gainsCents: Money
  /** Realised gains from discount-eligible parcels, before losses and discount. */
  readonly discountableGainsCents: Money
  /** The year's realised losses, as a positive magnitude. */
  readonly lossesCents: Money
  /** Net capital losses carried in from earlier years, as a positive magnitude. */
  readonly carriedInLossesCents: Money
  /** The CGT discount taken off the discountable gains left after losses. */
  readonly discountCents: Money
  /** The assessable net capital gain: gains after losses and the discount; never negative. */
  readonly netCapitalGainCents: Money
  /** Losses left over after the year's gains, carried to the next year. */
  readonly carriedForwardLossesCents: Money
}

/** The financial year (ending-year label) an ISO date falls in. */
function financialYearOfIso(iso: string): FinancialYear {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return month >= 7 ? year + 1 : year
}

/** Whether `soldOn` is more than one year after `acquiredOn`. */
function heldOverTwelveMonths(acquiredOn: string, soldOn: string): boolean {
  const year = Number(acquiredOn.slice(0, 4))
  const month = Number(acquiredOn.slice(5, 7))
  const day = Number(acquiredOn.slice(8, 10))
  const anniversary = new Date(Date.UTC(year + 1, month - 1, day)).toISOString().slice(0, 10)
  return soldOn > anniversary
}

/** Whole micro-units of `units`. */
function toMicro(units: number): number {
  return Math.round(units * MICRO)
}

interface Parcel {
  readonly acquiredOn: string
  unitsMicro: number
  costCents: Money
}

/** Trades in matching order: by date, buys before sells on the same day, then as supplied. */
function inMatchingOrder(trades: readonly TradeInput[]): TradeInput[] {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort(
      (a, b) =>
        a.trade.tradedOn.localeCompare(b.trade.tradedOn) ||
        Number(a.trade.side === 'sell') - Number(b.trade.side === 'sell') ||
        a.index - b.index,
    )
    .map(({ trade }) => trade)
}

/**
 * Matches each equity sale to the grant's lots first-in first-out, returning each
 * matched piece's realised gain (the lot's `grantDate` as `acquiredOn`, its label
 * as `ticker`) and any sold units the lots do not cover. A sale's proceeds are
 * its units at the price less fees, with rounding remainders landing on the last
 * piece so they are allocated exactly.
 */
export function matchEquitySales(
  lots: readonly EquityLotInput[],
  sales: readonly EquitySaleInput[],
): { gains: RealisedGain[]; unmatchedSales: UnmatchedSale[] } {
  const remaining = new Map<string, { lot: EquityLotInput; units: number }[]>()
  for (const lot of [...lots].sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn))) {
    remaining.set(lot.grantId, [...(remaining.get(lot.grantId) ?? []), { lot, units: lot.units }])
  }
  const gains: RealisedGain[] = []
  const unmatchedSales: UnmatchedSale[] = []
  for (const sale of [...sales].sort((a, b) => a.soldOn.localeCompare(b.soldOn))) {
    const book = remaining.get(sale.grantId) ?? []
    const proceedsCents = sale.units * sale.pricePerShareCents - sale.feeCents
    let left = sale.units
    let allocatedCents = 0
    while (left > 0 && book.length > 0) {
      const held = book[0]!
      const take = Math.min(left, held.units)
      left -= take
      const pieceProceedsCents =
        left === 0
          ? proceedsCents - allocatedCents
          : scaleRoundHalfUp(proceedsCents, take, sale.units)
      allocatedCents += pieceProceedsCents
      const costBaseCents = take * held.lot.costPerUnitCents
      gains.push({
        memberId: sale.memberId,
        ticker: held.lot.label,
        acquiredOn: held.lot.grantDate,
        soldOn: sale.soldOn,
        units: take,
        costBaseCents,
        proceedsCents: pieceProceedsCents,
        gainCents: pieceProceedsCents - costBaseCents,
        discountEligible: heldOverTwelveMonths(held.lot.grantDate, sale.soldOn),
        financialYear: financialYearOfIso(sale.soldOn),
      })
      held.units -= take
      if (held.units === 0) {
        book.shift()
      }
    }
    if (left > 0) {
      unmatchedSales.push({
        memberId: sale.memberId,
        ticker: sale.label,
        soldOn: sale.soldOn,
        units: left,
      })
    }
  }
  return { gains, unmatchedSales }
}

/**
 * Matches every sale to purchase parcels first-in first-out, per member and
 * ticker, returning the unsold holdings, each matched piece's realised gain, and
 * any sold units the recorded buys do not cover. A parcel part-sold carries its
 * remaining cost base forward; rounding remainders land on the last piece so a
 * sale's proceeds and a parcel's cost are each allocated exactly.
 */
export function matchTrades(trades: readonly TradeInput[]): TradeMatching {
  const parcelsByKey = new Map<string, { memberId: string; ticker: string; parcels: Parcel[] }>()
  const gains: RealisedGain[] = []
  const unmatchedSales: UnmatchedSale[] = []

  for (const trade of inMatchingOrder(trades)) {
    const key = `${trade.memberId}\u0000${trade.ticker}`
    let book = parcelsByKey.get(key)
    if (!book) {
      book = { memberId: trade.memberId, ticker: trade.ticker, parcels: [] }
      parcelsByKey.set(key, book)
    }
    const unitsMicro = toMicro(trade.units)
    const grossCents = unitsValueCents(unitsMicro, trade.pricePerUnitMicrodollars)

    if (trade.side === 'buy') {
      book.parcels.push({
        acquiredOn: trade.tradedOn,
        unitsMicro,
        costCents: grossCents + trade.feeCents,
      })
      continue
    }

    const proceedsCents = grossCents - trade.feeCents
    let remainingMicro = unitsMicro
    let allocatedProceedsCents = 0
    while (remainingMicro > 0 && book.parcels.length > 0) {
      const parcel = book.parcels[0]!
      const takeMicro = Math.min(remainingMicro, parcel.unitsMicro)
      const parcelExhausted = takeMicro === parcel.unitsMicro
      const costCents = parcelExhausted
        ? parcel.costCents
        : scaleRoundHalfUp(parcel.costCents, takeMicro, parcel.unitsMicro)
      remainingMicro -= takeMicro
      const piecesDone = remainingMicro === 0
      const pieceProceedsCents = piecesDone
        ? proceedsCents - allocatedProceedsCents
        : scaleRoundHalfUp(proceedsCents, takeMicro, unitsMicro)
      allocatedProceedsCents += pieceProceedsCents
      gains.push({
        memberId: trade.memberId,
        ticker: trade.ticker,
        acquiredOn: parcel.acquiredOn,
        soldOn: trade.tradedOn,
        units: takeMicro / MICRO,
        costBaseCents: costCents,
        proceedsCents: pieceProceedsCents,
        gainCents: pieceProceedsCents - costCents,
        discountEligible: heldOverTwelveMonths(parcel.acquiredOn, trade.tradedOn),
        financialYear: financialYearOfIso(trade.tradedOn),
      })
      if (parcelExhausted) {
        book.parcels.shift()
      } else {
        parcel.unitsMicro -= takeMicro
        parcel.costCents -= costCents
      }
    }
    if (remainingMicro > 0) {
      unmatchedSales.push({
        memberId: trade.memberId,
        ticker: trade.ticker,
        soldOn: trade.tradedOn,
        units: remainingMicro / MICRO,
      })
    }
  }

  const holdings: Holding[] = []
  for (const { memberId, ticker, parcels } of parcelsByKey.values()) {
    const unitsMicro = parcels.reduce((total, parcel) => total + parcel.unitsMicro, 0)
    if (unitsMicro === 0) {
      continue
    }
    const costBaseCents = parcels.reduce((total, parcel) => total + parcel.costCents, 0)
    holdings.push({
      memberId,
      ticker,
      units: unitsMicro / MICRO,
      costBaseCents,
      averageCostMicrodollars: scaleRoundHalfUp(
        centsToMicrodollars(costBaseCents),
        MICRO,
        unitsMicro,
      ),
    })
  }
  return { holdings, gains, unmatchedSales }
}

/** The market value of `holding` at `pricePerUnitMicrodollars`, to the nearest cent. */
export function holdingValueCents(holding: Holding, pricePerUnitMicrodollars: Microdollars): Money {
  return unitsValueCents(toMicro(holding.units), pricePerUnitMicrodollars)
}

/**
 * The latest traded price per ticker across every trade supplied — the most
 * recent `tradedOn`, the later-supplied trade winning a tie. Values holdings at
 * the last price paid or received.
 */
export function lastPriceByTicker(trades: readonly TradeInput[]): Map<string, Microdollars> {
  const latest = new Map<string, { tradedOn: string; price: Microdollars }>()
  for (const trade of trades) {
    const seen = latest.get(trade.ticker)
    if (!seen || trade.tradedOn >= seen.tradedOn) {
      latest.set(trade.ticker, { tradedOn: trade.tradedOn, price: trade.pricePerUnitMicrodollars })
    }
  }
  return new Map([...latest].map(([ticker, { price }]) => [ticker, price]))
}

/**
 * One member's capital gains position for `financialYear`, from their realised
 * gains. Losses (the year's, plus any net capital loss carried forward from
 * earlier years) are set against gains not eligible for the discount first, then
 * against discount-eligible gains; the 50% discount applies to what remains of the
 * latter. A year whose losses outrun its gains has a nil net capital gain and
 * carries the excess forward. Years are walked in order from the member's first
 * realised gain, so the carry-forward is exact.
 */
export function capitalGainsSummary(
  gains: readonly RealisedGain[],
  financialYear: FinancialYear,
): CapitalGainsSummary {
  const years = [...new Set(gains.map((gain) => gain.financialYear))]
    .filter((year) => year < financialYear)
    .sort((a, b) => a - b)
  let carriedCents = 0
  const walk = (year: FinancialYear): CapitalGainsSummary => {
    let plainCents = 0
    let discountableCents = 0
    let lossesCents = 0
    for (const gain of gains) {
      if (gain.financialYear !== year) {
        continue
      }
      if (gain.gainCents < 0) {
        lossesCents -= gain.gainCents
      } else if (gain.discountEligible) {
        discountableCents += gain.gainCents
      } else {
        plainCents += gain.gainCents
      }
    }
    const carriedInCents = carriedCents
    let poolCents = lossesCents + carriedInCents
    const plainLeftCents = plainCents - Math.min(poolCents, plainCents)
    poolCents -= plainCents - plainLeftCents
    const discountableLeftCents = discountableCents - Math.min(poolCents, discountableCents)
    poolCents -= discountableCents - discountableLeftCents
    const retainedCents = Math.round(discountableLeftCents * CGT_DISCOUNT_RETAINED)
    carriedCents = poolCents
    return {
      financialYear: year,
      gainsCents: plainCents,
      discountableGainsCents: discountableCents,
      lossesCents,
      carriedInLossesCents: carriedInCents,
      discountCents: discountableLeftCents - retainedCents,
      netCapitalGainCents: plainLeftCents + retainedCents,
      carriedForwardLossesCents: poolCents,
    }
  }
  for (const year of years) {
    walk(year)
  }
  return walk(financialYear)
}

/**
 * Each member's net capital gain for `financialYear`, keyed by member id, for
 * members with a positive figure — the map `estimateHouseholdTax` takes as its
 * capital-gains input. `equityGains` (from `matchEquitySales`) are pooled with
 * the trades' gains, so losses net across both.
 */
export function netCapitalGainByMember(
  trades: readonly TradeInput[],
  financialYear: FinancialYear,
  equityGains: readonly RealisedGain[] = [],
): Map<string, Money> {
  const { gains } = matchTrades(trades)
  const byMember = new Map<string, RealisedGain[]>()
  for (const gain of [...gains, ...equityGains]) {
    byMember.set(gain.memberId, [...(byMember.get(gain.memberId) ?? []), gain])
  }
  const result = new Map<string, Money>()
  for (const [memberId, memberGains] of byMember) {
    const { netCapitalGainCents } = capitalGainsSummary(memberGains, financialYear)
    if (netCapitalGainCents > 0) {
      result.set(memberId, netCapitalGainCents)
    }
  }
  return result
}
