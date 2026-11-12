import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import { formatIsoDate } from './dates'
import { formatCents, formatUnitPrice } from './money'
import {
  brokerageLabel,
  formatUnits,
  gainsLine,
  holdingLine,
  memberPortfolio,
  tradeValueCents,
  unitsText,
} from './trades'

/**
 * The household the native Investments screen is held to. The rows are written in
 * full, as PostgREST returns them; the figures are what `TradesScreen` shows for
 * each member: holdings, realised gains per financial year, oversold units and the
 * trade list, from `memberPortfolio` and the shared label helpers. The fixture is
 * committed beside the iOS tests (`vitest -u` rewrites it); `TradesParityTests`
 * runs the same rows through the bundled engine and `TradesPresentation` and must
 * produce identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/trades-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string): Tables<'members'> => ({
  ...base,
  id,
  name,
  user_id: `u-${id}`,
  email: null,
  date_of_birth: null,
  up_connected_at: null,
  up_sync_failed_at: null,
})

const trade = (
  id: string,
  member_id: string,
  ticker: string,
  side: Tables<'trade'>['side'],
  traded_on: string,
  units: number,
  price_per_unit_microdollars: number,
  fee_cents: number,
  document_id: string | null = null,
): Tables<'trade'> => ({
  ...base,
  id,
  member_id,
  ticker,
  side,
  traded_on,
  units,
  price_per_unit_microdollars,
  fee_cents,
  document_id,
  source: 'manual',
  external_id: null,
})

const members = [member('m1', 'Alex'), member('m2', 'Sam')]
const trades = [
  trade('t1', 'm1', 'VAS', 'buy', '2023-08-01', 100, 90_500_000, 950, 'd1'),
  trade('t2', 'm1', 'VAS', 'buy', '2024-02-15', 2, 33_083_072, 0),
  trade('t3', 'm1', 'VAS', 'sell', '2025-03-10', 60.5, 130_000_000, 950),
  trade('t4', 'm1', 'NDQ', 'buy', '2024-09-01', 1234.567891, 45_123_456, 1100),
  trade('t5', 'm1', 'NDQ', 'sell', '2025-01-20', 1300, 44_000_000, 1100),
  trade('t6', 'm2', 'VAS', 'buy', '2024-02-15', 1, 1_000_000, 0),
  trade('t7', 'm2', 'VAS', 'buy', '2024-02-15', 1, 1_000_000, 0),
  trade('t8', 'm1', 'VGS', 'buy', '2024-09-30', 10, 120_000_000, 0),
  trade('t9', 'm1', 'VGS', 'sell', '2025-09-01', 4, 80_000_000, 500),
]
const documents: Tables<'trade_document'>[] = [
  { household_id: 'h1', created_at: STAMP, id: 'd1', storage_path: 'h1/d1/note.pdf' },
]

const expected = {
  portfolio: JSON.parse(
    JSON.stringify({
      members: members.map((row) => ({ memberId: row.id, ...memberPortfolio(trades, row.id) })),
      tradeValues: trades.map((item) => ({ tradeId: item.id, valueCents: tradeValueCents(item) })),
    }),
  ),
  members: members.map((row) => {
    const portfolio = memberPortfolio(trades, row.id)
    return {
      memberId: row.id,
      holdings: portfolio.holdings.map(holdingLine),
      gains: portfolio.gainsByYear.map(gainsLine),
      unmatched: portfolio.unmatchedSales.map(
        (sale) =>
          `${formatUnits(sale.units)} ${sale.ticker} sold on ${formatIsoDate(sale.soldOn)} exceed the units bought, so they are left out of the gains. Check the trades below.`,
      ),
      trades: trades
        .filter((item) => item.member_id === row.id)
        .toSorted((a, b) => b.traded_on.localeCompare(a.traded_on))
        .map((item) => ({
          id: item.id,
          date: formatIsoDate(item.traded_on),
          units: unitsText(Number(item.units)),
          price: `at ${formatUnitPrice(item.price_per_unit_microdollars)}`,
          brokerage: brokerageLabel(item),
          fee: item.fee_cents > 0 ? formatCents(item.fee_cents) : null,
          valueCents: tradeValueCents(item),
          hasDocument: item.document_id !== null,
        })),
    }
  }),
}

describe('the native Investments parity fixture', () => {
  const text = `${JSON.stringify([{ name: 'two members', rows: { trades, members, documents }, expected }], null, 2)}\n`

  it('matches what the PWA Investments tab computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises gains, a discount, a loss, an oversold sale and fractional units', () => {
    const [alex] = expected.members
    expect(alex?.gains.length).toBeGreaterThan(1)
    expect(alex?.unmatched).toHaveLength(1)
    expect(alex?.gains.some((line) => line.cells[2] !== '')).toBe(true)
  })
})
