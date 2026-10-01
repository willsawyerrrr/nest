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
    pricePerUnitCents: Math.round(priceDollars * 100),
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
        averageCostCents: Math.round((9_000_00 + 10_00 + 4_800_00 + 10_00) / 150),
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
      averageCostCents: 100_00,
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
    expect(holdingValueCents(holdings[0]!, 1_234)).toBe(Math.round(12.5 * 1234))
  })

  it('takes the latest trade price per ticker, later-supplied winning a tie', () => {
    const prices = lastPriceByTicker([
      trade('buy', '2025-08-01', 1, 10),
      trade('sell', '2025-09-01', 1, 12),
      trade('buy', '2025-09-01', 1, 13),
      trade('buy', '2025-07-01', 1, 9, 0, { ticker: 'NDQ' }),
    ])
    expect(prices.get('VAS')).toBe(13_00)
    expect(prices.get('NDQ')).toBe(9_00)
  })
})
