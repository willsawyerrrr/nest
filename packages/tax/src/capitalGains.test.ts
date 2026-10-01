import { describe, expect, it } from 'vitest'
import {
  capitalGainsSummary,
  holdingValueCents,
  lastPriceByTicker,
  matchTrades,
  netCapitalGainByMember,
  type TradeInput,
} from './capitalGains.ts'

function trade(
  side: 'buy' | 'sell',
  tradedOn: string,
  units: number,
  priceDollars: number,
  feeDollars = 0,
  overrides: Partial<TradeInput> = {},
): TradeInput {
  return {
    memberId: 'm1',
    ticker: 'VAS',
    side,
    tradedOn,
    units,
    pricePerUnitMicrodollars: Math.round(priceDollars * 1_000_000),
    feeCents: Math.round(feeDollars * 100),
    ...overrides,
  }
}

describe('matchTrades holdings', () => {
  it('sums units and cost base, brokerage included, with an average cost', () => {
    const { holdings } = matchTrades([
      trade('buy', '2025-08-01', 100, 90, 10),
      trade('buy', '2025-09-01', 50, 96, 10),
    ])
    expect(holdings).toEqual([
      {
        memberId: 'm1',
        ticker: 'VAS',
        units: 150,
        costBaseCents: 100 * 9000 + 1000 + 50 * 9600 + 1000,
        averageCostMicrodollars: 92_133_333,
      },
    ])
  })

  it('keeps each member and ticker separate and drops a fully sold holding', () => {
    const { holdings } = matchTrades([
      trade('buy', '2025-08-01', 10, 10),
      trade('buy', '2025-08-01', 10, 10, 0, { memberId: 'm2' }),
      trade('buy', '2025-08-01', 5, 20, 0, { ticker: 'NDQ' }),
      trade('sell', '2025-09-01', 10, 12),
    ])
    expect(holdings.map((holding) => [holding.memberId, holding.ticker])).toEqual([
      ['m2', 'VAS'],
      ['m1', 'NDQ'],
    ])
  })

  it('supports fractional units', () => {
    const { holdings } = matchTrades([trade('buy', '2025-08-01', 0.5, 100)])
    expect(holdings[0]).toMatchObject({
      units: 0.5,
      costBaseCents: 50_00,
      averageCostMicrodollars: 100_000_000,
    })
  })
})

describe('matchTrades gains', () => {
  it('matches a sale to the oldest parcel first', () => {
    const { gains, holdings } = matchTrades([
      trade('buy', '2025-08-01', 10, 10),
      trade('buy', '2025-09-01', 10, 20),
      trade('sell', '2025-10-01', 15, 30),
    ])
    expect(gains).toHaveLength(2)
    expect(gains[0]).toMatchObject({
      acquiredOn: '2025-08-01',
      units: 10,
      costBaseCents: 100_00,
      proceedsCents: 300_00,
      gainCents: 200_00,
    })
    expect(gains[1]).toMatchObject({
      acquiredOn: '2025-09-01',
      units: 5,
      costBaseCents: 100_00,
      proceedsCents: 150_00,
      gainCents: 50_00,
    })
    expect(holdings[0]).toMatchObject({ units: 5, costBaseCents: 100_00 })
  })

  it('adds brokerage to cost and takes it off proceeds, allocating exactly across parcels', () => {
    const { gains } = matchTrades([
      trade('buy', '2025-08-01', 3, 10, 9.99),
      trade('buy', '2025-09-01', 4, 10, 0),
      trade('sell', '2025-10-01', 5, 12, 19.99),
    ])
    const proceeds = gains.reduce((total, gain) => total + gain.proceedsCents, 0)
    expect(proceeds).toBe(5 * 1200 - 1999)
    expect(gains[0]!.costBaseCents).toBe(3000 + 999)
    expect(gains[1]!.costBaseCents).toBe(Math.round(4000 * (2 / 4)))
  })

  it('records a loss as a negative gain', () => {
    const { gains } = matchTrades([
      trade('buy', '2025-08-01', 10, 10),
      trade('sell', '2025-10-01', 10, 8),
    ])
    expect(gains[0]!.gainCents).toBe(-20_00)
  })

  it('processes a same-day buy before a sell', () => {
    const { gains, unmatchedSales } = matchTrades([
      trade('sell', '2025-08-01', 5, 11),
      trade('buy', '2025-08-01', 5, 10),
    ])
    expect(gains).toHaveLength(1)
    expect(unmatchedSales).toEqual([])
  })

  it('reports units sold beyond the recorded buys and leaves them out of gains', () => {
    const { gains, unmatchedSales } = matchTrades([
      trade('buy', '2025-08-01', 5, 10),
      trade('sell', '2025-10-01', 8, 12),
    ])
    expect(gains.reduce((total, gain) => total + gain.units, 0)).toBe(5)
    expect(unmatchedSales).toEqual([
      { memberId: 'm1', ticker: 'VAS', soldOn: '2025-10-01', units: 3 },
    ])
  })

  it('files a sale under the financial year it falls in', () => {
    const { gains } = matchTrades([
      trade('buy', '2025-01-01', 2, 10),
      trade('sell', '2026-06-30', 1, 10),
      trade('sell', '2026-07-01', 1, 10),
    ])
    expect(gains.map((gain) => gain.financialYear)).toEqual([2026, 2027])
  })

  it('earns the discount only when held more than 12 months', () => {
    const { gains } = matchTrades([
      trade('buy', '2024-03-10', 4, 10),
      trade('sell', '2025-03-10', 1, 12),
      trade('sell', '2025-03-11', 1, 12),
      trade('sell', '2025-06-01', 1, 12),
    ])
    expect(gains.map((gain) => gain.discountEligible)).toEqual([false, true, true])
  })
})

describe('capitalGainsSummary', () => {
  const gain = (gainCents: number, discountEligible: boolean, financialYear = 2027) => ({
    memberId: 'm1',
    ticker: 'VAS',
    acquiredOn: '2020-01-01',
    soldOn: '2026-08-01',
    units: 1,
    costBaseCents: 0,
    proceedsCents: gainCents,
    gainCents,
    discountEligible,
    financialYear,
  })

  it('halves a discount-eligible gain and leaves another in full', () => {
    const summary = capitalGainsSummary([gain(1_000_00, true), gain(400_00, false)], 2027)
    expect(summary).toMatchObject({
      gainsCents: 400_00,
      discountableGainsCents: 1_000_00,
      discountCents: 500_00,
      netCapitalGainCents: 900_00,
      carriedForwardLossesCents: 0,
    })
  })

  it('sets losses against undiscounted gains before discounted ones', () => {
    const summary = capitalGainsSummary(
      [gain(1_000_00, true), gain(400_00, false), gain(-600_00, false)],
      2027,
    )
    // 400 of loss clears the plain gain; 200 reduces the discountable gain to 800 → 400.
    expect(summary.netCapitalGainCents).toBe(400_00)
    expect(summary.lossesCents).toBe(600_00)
  })

  it('floors the net gain at zero and carries the excess loss forward', () => {
    const summary = capitalGainsSummary([gain(100_00, false), gain(-350_00, false)], 2027)
    expect(summary.netCapitalGainCents).toBe(0)
    expect(summary.carriedForwardLossesCents).toBe(250_00)
  })

  it('applies a loss carried from an earlier year', () => {
    const summary = capitalGainsSummary([gain(-300_00, false, 2026), gain(1_000_00, false)], 2027)
    expect(summary.carriedInLossesCents).toBe(300_00)
    expect(summary.netCapitalGainCents).toBe(700_00)
  })

  it('walks several earlier years in order, carrying a loss across them', () => {
    const summary = capitalGainsSummary(
      [gain(500_00, false, 2026), gain(-900_00, false, 2025), gain(1_000_00, false)],
      2027,
    )
    // 2025's $900 loss is absorbed by 2026's $500 gain, leaving $400 for 2027.
    expect(summary.carriedInLossesCents).toBe(400_00)
    expect(summary.netCapitalGainCents).toBe(600_00)
  })

  it('ignores gains from later years', () => {
    const summary = capitalGainsSummary([gain(500_00, false, 2028)], 2027)
    expect(summary.netCapitalGainCents).toBe(0)
  })
})

describe('netCapitalGainByMember', () => {
  it('returns each member with a positive net gain for the year', () => {
    const result = netCapitalGainByMember(
      [
        trade('buy', '2024-01-01', 10, 10),
        trade('sell', '2026-09-01', 10, 20),
        trade('buy', '2026-01-01', 10, 10, 0, { memberId: 'm2' }),
        trade('sell', '2026-09-01', 10, 5, 0, { memberId: 'm2' }),
      ],
      2027,
    )
    // m1: $100 gain held > 12 months → $50 after the discount; m2: a loss, absent.
    expect([...result]).toEqual([['m1', 50_00]])
  })
})

describe('valuation', () => {
  it('values a holding at a price per unit', () => {
    const { holdings } = matchTrades([trade('buy', '2025-08-01', 12.5, 10)])
    expect(holdingValueCents(holdings[0]!, 12_340_000)).toBe(Math.round(12.5 * 1234))
  })

  it('takes the latest trade price per ticker, later-supplied winning a tie', () => {
    const prices = lastPriceByTicker([
      trade('buy', '2025-08-01', 1, 10),
      trade('sell', '2025-09-01', 1, 12),
      trade('buy', '2025-09-01', 1, 13),
      trade('buy', '2025-07-01', 1, 9, 0, { ticker: 'NDQ' }),
    ])
    expect(prices.get('VAS')).toBe(13_000_000)
    expect(prices.get('NDQ')).toBe(9_000_000)
  })

  it('keeps the newer price when an older trade is supplied after it', () => {
    const prices = lastPriceByTicker([
      trade('buy', '2025-09-01', 1, 13),
      trade('buy', '2025-01-01', 1, 9),
    ])
    expect(prices.get('VAS')).toBe(13_000_000)
  })
})

describe('exact unit prices', () => {
  it("rounds a purchase's consideration to the cent once, as the contract note prints it", () => {
    // 2 units at $33.083072 = $66.166144, printed as $66.17; plus $2.00 brokerage = $68.17.
    const { holdings } = matchTrades([trade('buy', '2024-10-25', 2, 33.083072, 2)])
    expect(holdings[0]).toMatchObject({
      units: 2,
      costBaseCents: 68_17,
      averageCostMicrodollars: 34_085_000,
    })
  })

  it("rounds a sale's proceeds from the exact price, net of brokerage", () => {
    // 28 units at $35.79 = $1,002.12; less $2.00 brokerage = $1,000.12.
    const { gains } = matchTrades([
      trade('buy', '2024-10-25', 28, 30),
      trade('sell', '2026-04-13', 28, 35.79, 2),
    ])
    expect(gains).toHaveLength(1)
    expect(gains[0]).toMatchObject({
      costBaseCents: 840_00,
      proceedsCents: 1_000_12,
      gainCents: 160_12,
      discountEligible: true,
    })
  })

  it('does not lose a sub-cent price that rounding it to cents would change', () => {
    // At $0.004 a cent-rounded price is $0.00 and the 1,000-unit parcel would be free.
    const { holdings } = matchTrades([trade('buy', '2025-08-01', 1_000, 0.004)])
    expect(holdings[0]!.costBaseCents).toBe(4_00)
  })

  it('rounds a half cent up', () => {
    const { holdings } = matchTrades([trade('buy', '2025-08-01', 3, 0.835)])
    expect(holdings[0]!.costBaseCents).toBe(2_51)
    expect(holdingValueCents(holdings[0]!, 835_000)).toBe(2_51)
  })

  it('values a holding at the exact last price', () => {
    const { holdings } = matchTrades([trade('buy', '2025-08-01', 7, 12.345678)])
    // 7 × 12.345678 = 86.419746
    expect(holdingValueCents(holdings[0]!, 12_345_678)).toBe(86_42)
    expect(lastPriceByTicker([trade('buy', '2025-08-01', 7, 12.345678)]).get('VAS')).toBe(
      12_345_678,
    )
  })

  it("splits a part-sold parcel's cost exactly with partial-cent prices", () => {
    const { gains, holdings } = matchTrades([
      trade('buy', '2025-08-01', 3, 32.418156, 2),
      trade('sell', '2025-09-01', 1, 40.5, 2),
      trade('sell', '2025-10-01', 1, 41.123456, 2),
    ])
    // Parcel cost: 3 × 32.418156 = 97.254468 → 97.25, plus 2.00 = 99.25.
    const costs = gains.map((gain) => gain.costBaseCents)
    expect(costs).toEqual([33_08, 33_09])
    expect(costs[0]! + costs[1]! + holdings[0]!.costBaseCents).toBe(99_25)
  })
})

/** A deterministic generator, so the property checks are repeatable. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return state / 4_294_967_296
  }
}

/** `units` micro-units at `price` microdollars, in cents rounded half-up, by independent BigInt. */
function exactCents(units: number, priceMicrodollars: number): number {
  const numerator = BigInt(Math.round(units * 1e6)) * BigInt(priceMicrodollars)
  const scale = 10n ** 10n
  return Number((numerator * 2n + scale) / (2n * scale))
}

describe('exactness properties', () => {
  /** Forty trades on distinct, increasing dates, selling only what is held. */
  function randomTrades(seed: number): TradeInput[] {
    const next = lcg(seed)
    const trades: TradeInput[] = []
    let held = 0
    for (let i = 0; i < 40; i++) {
      const date = new Date(Date.UTC(2023, 0, 1 + i * 17)).toISOString().slice(0, 10)
      const price = Math.round((0.01 + next() * 120) * 1_000_000) / 1_000_000
      const fee = Math.round(next() * 1500) / 100
      const sell = held > 0 && next() < 0.4
      const units = sell ? Math.max(1, Math.floor(next() * held)) : 1 + Math.floor(next() * 400)
      held += sell ? -units : units
      trades.push(trade(sell ? 'sell' : 'buy', date, units, price, fee))
    }
    return trades
  }

  const seeds = [1, 2, 3, 7, 11, 42, 99, 2024]

  it.each(seeds)('conserves cost base, proceeds, and units across matching (seed %i)', (seed) => {
    const trades = randomTrades(seed)
    const { holdings, gains, unmatchedSales } = matchTrades(trades)
    expect(unmatchedSales).toEqual([])

    // A buy's cost is its exact consideration plus fee; every cent ends in a gain or a holding.
    const bought = trades
      .filter((t) => t.side === 'buy')
      .reduce((total, t) => total + exactCents(t.units, t.pricePerUnitMicrodollars) + t.feeCents, 0)
    const soldCost = gains.reduce((total, gain) => total + gain.costBaseCents, 0)
    const heldCost = holdings.reduce((total, holding) => total + holding.costBaseCents, 0)
    expect(soldCost + heldCost).toBe(bought)

    // A sale's proceeds are fully allocated across its pieces.
    const proceeds = trades
      .filter((t) => t.side === 'sell')
      .reduce((total, t) => total + exactCents(t.units, t.pricePerUnitMicrodollars) - t.feeCents, 0)
    expect(gains.reduce((total, gain) => total + gain.proceedsCents, 0)).toBe(proceeds)

    // Units are conserved to the micro-unit.
    const micro = (units: number) => Math.round(units * 1e6)
    const net = trades.reduce((total, t) => total + (t.side === 'buy' ? 1 : -1) * micro(t.units), 0)
    expect(holdings.reduce((total, h) => total + micro(h.units), 0)).toBe(net)
  })

  it.each(seeds)('does not depend on the order trades are supplied in (seed %i)', (seed) => {
    const trades = randomTrades(seed)
    const next = lcg(seed + 1)
    const shuffled = [...trades].sort(() => next() - 0.5)
    expect(matchTrades(shuffled)).toEqual(matchTrades(trades))
  })

  it.each(seeds)('values every holding as the exact rounded product (seed %i)', (seed) => {
    const next = lcg(seed)
    for (let i = 0; i < 50; i++) {
      const units = 1 + Math.floor(next() * 1_000_000) / 1000
      const price = Math.round(next() * 500 * 1_000_000)
      const { holdings } = matchTrades([trade('buy', '2025-01-01', units, 1)])
      expect(holdingValueCents(holdings[0]!, price)).toBe(exactCents(units, price))
    }
  })
})
