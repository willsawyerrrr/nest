import { assertEquals } from '@std/assert'
import { type RawTrade, toExtractions } from './fields.ts'
import { buildSystemPrompt, TRADES_TOOL } from './model.ts'

/**
 * Synthetic CommSec trade confirmations: the layout and numeric patterns of the
 * real notes (a six-decimal average price, a rounded consideration, brokerage
 * and costs including GST, a separate total-GST line, a settlement date beside
 * the trade date) with invented values.
 */
const PURCHASE = `
 TAX INVOICE                                                                BUY
 TRADE CONFIRMATION
 WE HAVE BOUGHT THE FOLLOWING SECURITIES FOR YOU

 COMPANY: EXAMPLE CORE ETF
 SECURITY: EXAMPLE CORE ETF
                                                                            ABC

 DATE:                              25/10/2024                       UNITS AT PRICE
 AS AT DATE:                        25/10/2024
                                                                     3     12.345678
 TOTAL UNITS:                       7
                                                                     4     12.345679
                                                                     AVERAGE PRICE:   12.345678
 CONSIDERATION (AUD):               $86.42
 BROKERAGE & COSTS INCL GST:        $2.00
 TOTAL COST:                        $88.42
 TOTAL GST:                         $0.18
 SETTLEMENT DATE:                   29/10/2024
`

const SALE = `
 TAX INVOICE                                                                SELL
 WE HAVE SOLD THE FOLLOWING SECURITIES FOR YOU

 SECURITY                           EXAMPLE CORE ETF
                                                                            ABC

 DATE:                              13/04/2026                       UNITS AT PRICE
 AS AT DATE:                        13/04/2026
 TOTAL UNITS:                       1,200                            AVERAGE PRICE:   15.250000
 CONSIDERATION (AUD):               $18,300.00
 BROKERAGE & COSTS INCL GST:        $9.50
 NET PROCEEDS:                      $18,290.50
 TOTAL GST:                         $0.86
 SETTLEMENT DATE:                   15/04/2026
`

/** Reads the printed text a faithful model reports for a note, as the prompt asks. */
function read(note: string): RawTrade {
  const field = (pattern: RegExp) => pattern.exec(note)?.[1] ?? null
  const date = /^\s*DATE:\s+(\d\d)\/(\d\d)\/(\d{4})/m.exec(note)
  return {
    ticker: field(/^\s+([A-Z]{2,5})\s*$/m),
    side: /WE HAVE (BOUGHT|SOLD)/.exec(note)?.[1] ?? null,
    trade_date: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
    units: field(/TOTAL UNITS:\s+(\S+)/),
    price_per_unit: field(/AVERAGE PRICE:\s+(\S+)/),
    brokerage_fee: field(/BROKERAGE & COSTS INCL GST:\s+\$?(\S+)/),
  }
}

Deno.test('a CommSec purchase keeps its exact unit price and brokerage including GST', () => {
  const [extraction] = toExtractions({ is_trade_document: true, trades: [read(PURCHASE)] })

  assertEquals(extraction.fields, {
    ticker: 'ABC',
    side: 'buy',
    traded_on: '2024-10-25',
    units: 7,
    price_per_unit_microdollars: 12_345_678,
    fee_cents: 200,
  })
  assertEquals(extraction.missing, [])
  assertEquals(extraction.unreadable, [])
})

Deno.test('a CommSec sale keeps its grouped units, trailing-zero price, and fee', () => {
  const [extraction] = toExtractions({ is_trade_document: true, trades: [read(SALE)] })

  assertEquals(extraction.fields, {
    ticker: 'ABC',
    side: 'sell',
    traded_on: '2026-04-13',
    units: 1200,
    price_per_unit_microdollars: 15_250_000,
    fee_cents: 950,
  })
  assertEquals(extraction.unreadable, [])
})

Deno.test("the extracted price reproduces the note's printed consideration", () => {
  for (const [note, consideration] of [[PURCHASE, 8642], [SALE, 1_830_000]]) {
    const [{ fields }] = toExtractions({
      is_trade_document: true,
      trades: [read(note as string)],
    })
    const units = BigInt(Math.round((fields.units as number) * 1e6))
    const micro = BigInt(fields.price_per_unit_microdollars as number)
    const cents = (units * micro * 2n + 10n ** 10n * 1n) / (2n * 10n ** 10n)
    assertEquals(Number(cents), consideration)
  }
})

Deno.test('the prompt and tool steer the model to the average price and fee including GST', () => {
  const prompt = buildSystemPrompt(2026)
  assertEquals(prompt.includes('average price'), true)
  assertEquals(prompt.includes('including any GST'), true)
  assertEquals(prompt.includes('33.083072'), true)
  const trade =
    (TRADES_TOOL.input_schema.properties as Record<string, { items: { properties: object } }>)
      .trades.items.properties as Record<string, { description: string }>
  assertEquals(trade.brokerage_fee.description.includes('including GST'), true)
})
