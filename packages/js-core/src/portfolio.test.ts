import { describe, expect, it } from 'vitest'
import { portfolioOf, tradeFigures, type PortfolioTrade } from './portfolio.ts'

const trade = (overrides: Partial<PortfolioTrade>): PortfolioTrade => ({
  id: 't',
  member_id: 'm1',
  ticker: 'VAS',
  side: 'buy',
  traded_on: '2024-01-10',
  units: 10,
  price_per_unit_microdollars: 90_000_000,
  fee_cents: 950,
  ...overrides,
})

describe('portfolioOf', () => {
  const result = portfolioOf({
    memberIds: ['m1', 'm2'],
    trades: [
      trade({ id: 'a' }),
      trade({
        id: 'b',
        side: 'sell',
        traded_on: '2025-03-01',
        units: 4,
        price_per_unit_microdollars: 100_000_000,
      }),
    ],
  })

  it('matches sales first-in first-out into holdings and gains', () => {
    const [m1, m2] = result.members
    expect(m1?.holdings).toMatchObject([
      { ticker: 'VAS', units: 6, lastPriceMicrodollars: 100_000_000, valueCents: 600_00 },
    ])
    expect(m1?.gainsByYear).toHaveLength(1)
    expect(m2).toMatchObject({ holdings: [], gainsByYear: [], unmatchedSales: [] })
  })

  it('values each trade before brokerage', () => {
    expect(result.tradeValues).toEqual([
      { tradeId: 'a', valueCents: 900_00 },
      { tradeId: 'b', valueCents: 400_00 },
    ])
  })
})

describe('tradeFigures', () => {
  it('reads exact microdollars, cents and units', () => {
    expect(tradeFigures({ units: '1.5', price: '33.083072', fee: '9.50' })).toEqual({
      units: 1.5,
      priceMicrodollars: 33_083_072,
      feeCents: 950,
    })
  })

  it('leaves blank amounts null and a blank fee zero', () => {
    expect(tradeFigures({ units: '', price: ' ', fee: '' })).toEqual({
      units: null,
      priceMicrodollars: null,
      feeCents: 0,
    })
  })
})
