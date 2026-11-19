import { describe, expect, it } from 'vitest'
import type { TradeInput, TradeRow } from '../hooks/useTrades'
import {
  centsToDollars,
  dollarsToCents,
  dollarsToMicrodollars,
  microdollarsToDollars,
} from './money'
import { readExtraction, readExtractionFailure, type ExtractedTrade } from './tradeExtraction'
import { findDuplicateTrade } from './trades'

/**
 * What the native contract-note flow is held to. `replies` are `trade-extract`
 * bodies and the drafts the PWA reads from them; each draft carries the input
 * `TradeForm` submits when saved untouched (its integer-microdollar price round-
 * tripped through the dollars field) and whether the repeat-trade warning shows
 * against `trades`. `failures` are non-2xx bodies and the outcome they read as.
 * The fixture is committed beside the iOS tests (`vitest -u` rewrites it);
 * `TradeDocumentsParityTests` must read and convert identically.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/trade-documents-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const MEMBER = 'm1'

const row = (
  id: string,
  member_id: string,
  ticker: string,
  traded_on: string,
  units: number,
  price_per_unit_microdollars: number,
): TradeRow => ({
  household_id: 'h1',
  created_at: STAMP,
  updated_at: STAMP,
  id,
  member_id,
  ticker,
  side: 'buy',
  traded_on,
  units,
  price_per_unit_microdollars,
  fee_cents: 0,
  document_id: null,
  source: 'manual',
  external_id: null,
})

const trades = [
  row('t1', MEMBER, 'VAS', '2024-02-15', 2, 33_083_072),
  row('t2', 'm2', 'NDQ', '2025-01-20', 1300, 44_000_000),
]

/** The input `TradeForm` submits for a draft left as read, or null when it cannot be saved. */
function submitted(trade: ExtractedTrade): TradeInput | null {
  const { values } = trade
  const units = values.units === undefined ? Number.NaN : Number(values.units)
  const price = dollarsToMicrodollars(microdollarsToDollars(values.price_per_unit_microdollars))
  const ticker = (values.ticker ?? '').trim()
  if (ticker === '' || !values.traded_on || !(units > 0) || price === null) {
    return null
  }
  return {
    member_id: MEMBER,
    ticker: ticker.toUpperCase(),
    side: values.side ?? 'buy',
    traded_on: values.traded_on,
    units,
    price_per_unit_microdollars: price,
    fee_cents: dollarsToCents(centsToDollars(values.fee_cents)) ?? 0,
  }
}

const field = (
  fields: Record<string, unknown>,
  missing: string[] = [],
  unreadable: string[] = [],
) => ({ fields, missing, unreadable })

const replies = [
  {
    name: 'a repeat of a saved trade, exact to the microdollar',
    body: {
      model: 'claude-haiku-4-5',
      trades: [
        field({
          ticker: 'vas',
          side: 'buy',
          traded_on: '2024-02-15',
          units: 2,
          price_per_unit_microdollars: 33_083_072,
          fee_cents: 1000,
        }),
      ],
    },
  },
  {
    name: 'several trades: fractional units, a tiny and a large price, no fee shown',
    body: {
      model: 'claude-haiku-4-5',
      trades: [
        field(
          {
            ticker: 'NDQ',
            side: 'sell',
            traded_on: '2025-01-20',
            units: 1234.567891,
            price_per_unit_microdollars: 45_123_456,
            fee_cents: null,
          },
          ['fee_cents'],
        ),
        field({
          ticker: 'XYZ',
          side: 'buy',
          traded_on: '2025-03-01',
          units: 1_000_000,
          price_per_unit_microdollars: 1,
          fee_cents: 0,
        }),
        field({
          ticker: 'BRK',
          side: 'buy',
          traded_on: '2025-03-02',
          units: 0.5,
          price_per_unit_microdollars: 123_456_789_012,
          fee_cents: 1995,
        }),
        field({
          ticker: 'NDQ',
          side: 'buy',
          traded_on: '2025-01-20',
          units: 1300,
          price_per_unit_microdollars: 44_000_000,
          fee_cents: 1100,
        }),
      ],
    },
  },
  {
    name: 'fields left to check',
    body: {
      model: 'claude-haiku-4-5',
      trades: [
        field(
          {
            ticker: null,
            side: 'hold',
            traded_on: '2025-05-05',
            units: -3,
            price_per_unit_microdollars: 1_500_000,
            fee_cents: -1,
          },
          ['ticker', 'side'],
          ['units', 'not_a_field'],
        ),
      ],
    },
  },
  { name: 'a body that is not a reply', body: { trades: [] } },
  { name: 'a trade that is not one', body: { model: 'm', trades: [{ fields: 'x' }] } },
].map(({ name, body }) => {
  const read = readExtraction(body)
  return {
    name,
    body,
    expected:
      read === null
        ? null
        : read.map((trade) => {
            const input = submitted(trade)
            return {
              ...trade,
              input,
              repeat: input !== null && findDuplicateTrade(trades, input) !== undefined,
            }
          }),
  }
})

const failures = [
  { code: 'unsupported_type', error: 'Ignored.' },
  { code: 'out_of_credit', error: 'Reading is paused: the account is out of credit.' },
  { code: 'not_configured', error: 'Reading is not set up.' },
  { code: 'model_failed', error: 'The model could not read this document.' },
  { error: 'An upstream message with no code.' },
  null,
].map((body) => ({ body, expected: readExtractionFailure(body) }))

describe('the native contract-note parity fixture', () => {
  const text = `${JSON.stringify({ memberId: MEMBER, trades, replies, failures }, null, 2)}\n`

  it('matches how the PWA reads, converts, and warns on contract-note trades', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('covers a repeat, an unsavable draft, and an unreadable reply', () => {
    const drafts = replies.flatMap((reply) => reply.expected ?? [])
    expect(drafts.some((draft) => draft.repeat)).toBe(true)
    expect(drafts.some((draft) => draft.input === null)).toBe(true)
    expect(replies.some((reply) => reply.expected === null)).toBe(true)
  })
})
