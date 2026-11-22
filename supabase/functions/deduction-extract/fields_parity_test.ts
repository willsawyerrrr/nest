/**
 * Runs the fixture the native apps' on-device receipt reading is held to through the
 * server's `fields.ts` and `money.ts`, asserting each frozen `expected`. The Swift
 * `ReceiptFieldsParityTests` runs the same cases through its port, so a change to either
 * implementation fails one of the two suites.
 */

import { assertEquals } from '@std/assert'
import { parseCents, parseIsoDate } from '../_shared/money.ts'
import { readRawFields, toExtraction } from './fields.ts'
import data from '../../../apps/ios/NestTests/Fixtures/deduction-receipt-parity.json' with {
  type: 'json',
}

const fixture = data as unknown as {
  amounts: { input: string; expected: number | null }[]
  dates: { input: string; expected: string | null }[]
  receipts: { input: Record<string, unknown>; expected: Record<string, unknown> }[]
}

for (const { input, expected } of fixture.amounts) {
  Deno.test(`receipt parity — amount ${JSON.stringify(input)}`, () => {
    assertEquals(parseCents(input), expected)
  })
}

for (const { input, expected } of fixture.dates) {
  Deno.test(`receipt parity — date ${JSON.stringify(input)}`, () => {
    assertEquals(parseIsoDate(input), expected)
  })
}

for (const { input, expected } of fixture.receipts) {
  Deno.test(`receipt parity — receipt ${JSON.stringify(input.description)}`, () => {
    const raw = readRawFields(input)!
    const { fields, missing, unreadable } = toExtraction(raw)
    assertEquals({
      isReceipt: raw.is_receipt,
      notReceiptReason: raw.not_receipt_reason,
      description: fields.description,
      deductionDate: fields.deduction_date,
      amountCents: fields.amount_cents,
      missing,
      unreadable,
    }, expected)
  })
}

Deno.test('receipt parity — the corpus fixture matches the eval corpus', async () => {
  const { corpusFixture } = await import('./corpusFixture.ts')
  const { default: frozen } = await import(
    '../../../apps/ios/NestTests/Fixtures/deduction-corpus-parity.json',
    { with: { type: 'json' } }
  )
  assertEquals(frozen, JSON.parse(JSON.stringify(corpusFixture())))
})
