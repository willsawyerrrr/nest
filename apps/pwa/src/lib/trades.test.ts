import { describe, expect, it } from 'vitest'
import type { TradeRow } from '../hooks/useTrades'
import { makeMember } from '../test/fixtures'
import { findDuplicateTrade, heldEquityHoldings, memberPortfolio } from './trades'

function trade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 't',
    household_id: 'h1',
    member_id: 'm1',
    ticker: 'VAS',
    side: 'buy',
    traded_on: '2024-01-10',
    units: 100,
    price_per_unit_microdollars: 90_000_000,
    fee_cents: 0,
    source: 'manual',
    document_id: null,
    external_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('memberPortfolio', () => {
  it('values a holding at the ticker’s last traded price, even one another member traded', () => {
    const portfolio = memberPortfolio(
      [
        trade(),
        trade({
          member_id: 'm2',
          traded_on: '2025-01-01',
          price_per_unit_microdollars: 120_000_000,
        }),
      ],
      'm1',
    )
    expect(portfolio.holdings).toEqual([
      expect.objectContaining({
        ticker: 'VAS',
        units: 100,
        lastPriceMicrodollars: 120_000_000,
        valueCents: 12_000_00,
      }),
    ])
  })

  it('lists gains by financial year, newest first, and reads units serialised as strings', () => {
    const portfolio = memberPortfolio(
      [
        trade({ units: '10' as unknown as number }),
        trade({
          side: 'sell',
          traded_on: '2025-08-01',
          units: 4,
          price_per_unit_microdollars: 100_000_000,
        }),
        trade({
          side: 'sell',
          traded_on: '2026-08-01',
          units: 4,
          price_per_unit_microdollars: 100_000_000,
        }),
      ],
      'm1',
    )
    expect(portfolio.gainsByYear.map((summary) => summary.financialYear)).toEqual([2027, 2026])
    expect(portfolio.holdings[0]!.units).toBe(2)
  })
})

describe('heldEquityHoldings', () => {
  it('names each holding by member and ticker and drops a fully sold one', () => {
    const holdings = heldEquityHoldings(
      [
        trade({ units: 10 }),
        trade({ ticker: 'NDQ', units: 5 }),
        trade({ ticker: 'NDQ', side: 'sell', traded_on: '2024-02-01', units: 5 }),
      ],
      [makeMember({ id: 'm1', name: 'Will' })],
    )
    expect(holdings).toEqual([{ label: 'Will — VAS', valueCents: 900_00 }])
  })
})

describe('findDuplicateTrade', () => {
  const candidate = {
    member_id: 'm1',
    ticker: 'VAS',
    side: 'buy' as const,
    traded_on: '2024-01-10',
    units: 100,
    price_per_unit_microdollars: 90_000_000,
    fee_cents: 0,
  }

  it('finds a trade with the same member, ticker, date, units, and price', () => {
    const existing = trade({ id: 'a', units: '100' as unknown as number })
    expect(findDuplicateTrade([trade({ id: 'b', ticker: 'VGS' }), existing], candidate)).toBe(
      existing,
    )
  })

  it.each([
    { member_id: 'm2' },
    { ticker: 'VGS' },
    { traded_on: '2024-01-11' },
    { units: 101 },
    { price_per_unit_microdollars: 91_000_000 },
  ])('does not match when %j differs', (difference) => {
    expect(findDuplicateTrade([trade(difference)], candidate)).toBeUndefined()
  })

  it('ignores the trade being edited', () => {
    expect(findDuplicateTrade([trade({ id: 'a' })], candidate, 'a')).toBeUndefined()
  })
})
