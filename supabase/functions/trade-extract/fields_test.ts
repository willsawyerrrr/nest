import { assertEquals } from '@std/assert'
import {
  MAX_TRADES,
  parseNonNegativeCents,
  parseSide,
  parseTicker,
  parseUnits,
  type RawTrade,
  readRawFields,
  toExtractions,
} from './fields.ts'

/** A full set of reported fields for one trade, overridable per test. */
function raw(overrides: Partial<RawTrade> = {}): RawTrade {
  return {
    ticker: 'VAS',
    side: 'buy',
    trade_date: '2026-07-06',
    units: '10.5',
    price_per_unit: '98.50',
    brokerage_fee: '9.50',
    ...overrides,
  }
}

Deno.test('readRawFields reads a well-formed tool input with several trades', () => {
  const document = readRawFields({
    is_trade_document: true,
    trades: [{ ...raw(), ticker: '  VAS  ' }, raw({ ticker: 'VGS' })],
  })

  assertEquals(document?.is_trade_document, true)
  assertEquals(document?.trades.map((trade) => trade.ticker), ['VAS', 'VGS'])
})

Deno.test('readRawFields reads omitted, placeholder, and ill-typed fields as absent', () => {
  const document = readRawFields({
    is_trade_document: true,
    trades: [{ ticker: 'VAS', side: 'N/A', units: 10, price_per_unit: '' }],
  })

  const [trade] = document!.trades
  assertEquals(trade.ticker, 'VAS')
  assertEquals(trade.side, null)
  assertEquals(trade.units, null)
  assertEquals(trade.price_per_unit, null)
  assertEquals(trade.brokerage_fee, null)
})

Deno.test('readRawFields rejects a response without a boolean verdict', () => {
  assertEquals(readRawFields({ trades: [] }), null)
  assertEquals(readRawFields({ is_trade_document: 'yes', trades: [] }), null)
  assertEquals(readRawFields(null), null)
  assertEquals(readRawFields([]), null)
  assertEquals(readRawFields('trades'), null)
})

Deno.test('readRawFields reads a missing or non-array trades list as no trades', () => {
  assertEquals(readRawFields({ is_trade_document: false })?.trades, [])
  assertEquals(readRawFields({ is_trade_document: true, trades: 'VAS' })?.trades, [])
})

Deno.test('readRawFields skips entries that are not objects', () => {
  const document = readRawFields({ is_trade_document: true, trades: [null, 'VAS', [], raw()] })

  assertEquals(document?.trades.length, 1)
})

Deno.test('readRawFields caps the trades it reads', () => {
  const trades = Array.from({ length: MAX_TRADES + 5 }, () => raw())

  assertEquals(readRawFields({ is_trade_document: true, trades })?.trades.length, MAX_TRADES)
})

Deno.test('toExtractions converts a trade to column-shaped values', () => {
  const [extraction] = toExtractions({ is_trade_document: true, trades: [raw()] })

  assertEquals(extraction.fields, {
    ticker: 'VAS',
    side: 'buy',
    traded_on: '2026-07-06',
    units: 10.5,
    price_per_unit_microdollars: 98_500_000,
    fee_cents: 950,
  })
  assertEquals(extraction.text.price_per_unit, '98.50')
  assertEquals(extraction.missing, [])
  assertEquals(extraction.unreadable, [])
})

Deno.test('toExtractions separates absent fields from unreadable ones', () => {
  const [extraction] = toExtractions({
    is_trade_document: true,
    trades: [raw({ brokerage_fee: null, units: '1/2', trade_date: '06/07/2026', side: 'swap' })],
  })

  assertEquals(extraction.fields.fee_cents, null)
  assertEquals(extraction.missing, ['fee_cents'])
  assertEquals(extraction.unreadable, ['side', 'traded_on', 'units'])
})

Deno.test('parseTicker upper-cases and rejects what is not a code', () => {
  assertEquals(parseTicker('vas'), 'VAS')
  assertEquals(parseTicker(' V A S '), 'VAS')
  assertEquals(parseTicker('BRK.B'), 'BRK.B')
  assertEquals(parseTicker('Vanguard Australian Shares'), null)
  assertEquals(parseTicker('$VAS'), null)
  assertEquals(parseTicker(null), null)
})

Deno.test('parseSide reads the words a contract note uses', () => {
  assertEquals(parseSide('Buy'), 'buy')
  assertEquals(parseSide('BOUGHT'), 'buy')
  assertEquals(parseSide('sold'), 'sell')
  assertEquals(parseSide(' Sale '), 'sell')
  assertEquals(parseSide('transfer'), null)
  assertEquals(parseSide(null), null)
})

Deno.test('parseUnits reads positive units to six decimal places', () => {
  assertEquals(parseUnits('10'), 10)
  assertEquals(parseUnits('1,250.5'), 1250.5)
  assertEquals(parseUnits('0.123456'), 0.123456)
  assertEquals(parseUnits(' 10 000 '), 10000)
})

Deno.test('parseUnits rejects zero, excess precision, and ambiguous text', () => {
  assertEquals(parseUnits('0'), null)
  assertEquals(parseUnits('0.0000001'), null)
  assertEquals(parseUnits('1.2345678'), null)
  assertEquals(parseUnits('-5'), null)
  assertEquals(parseUnits('12,34'), null)
  assertEquals(parseUnits('ten'), null)
  assertEquals(parseUnits(null), null)
})

Deno.test('parseNonNegativeCents converts printed amounts to integer cents', () => {
  assertEquals(parseNonNegativeCents('$98.50'), 9850)
  assertEquals(parseNonNegativeCents('1,234.5'), 123450)
  assertEquals(parseNonNegativeCents('0.00'), 0)
  assertEquals(parseNonNegativeCents(null), null)
})

Deno.test('parseNonNegativeCents drops trailing zeros but never rounds sub-cent digits', () => {
  assertEquals(parseNonNegativeCents('98.5000'), 9850)
  assertEquals(parseNonNegativeCents('98.4567'), null)
})

Deno.test('toExtractions holds a partial-cent price exactly', () => {
  const [extraction] = toExtractions({
    is_trade_document: true,
    trades: [raw({ price_per_unit: '$33.083072' })],
  })

  assertEquals(extraction.fields.price_per_unit_microdollars, 33_083_072)
  assertEquals(extraction.unreadable, [])
})

Deno.test('toExtractions flags a price finer than six decimal places', () => {
  const [extraction] = toExtractions({
    is_trade_document: true,
    trades: [raw({ price_per_unit: '33.0830721' })],
  })

  assertEquals(extraction.fields.price_per_unit_microdollars, null)
  assertEquals(extraction.unreadable, ['price_per_unit_microdollars'])
})

Deno.test('parseNonNegativeCents rejects a negative amount', () => {
  assertEquals(parseNonNegativeCents('-9.50'), null)
  assertEquals(parseNonNegativeCents('(9.50)'), null)
})
