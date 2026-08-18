import { assertEquals } from '@std/assert'
import { type RawDeductionFields, readRawFields, toExtraction } from './fields.ts'

/** A full set of reported fields, overridable per test. */
function raw(overrides: Partial<RawDeductionFields> = {}): RawDeductionFields {
  return {
    is_receipt: true,
    not_receipt_reason: null,
    description: 'Officeworks',
    deduction_date: '2026-07-06',
    amount: '124.50',
    ...overrides,
  }
}

Deno.test('readRawFields reads a well-formed tool input', () => {
  const fields = readRawFields({
    is_receipt: true,
    not_receipt_reason: null,
    description: '  Officeworks  ',
    amount: '124.50',
  })

  assertEquals(fields?.is_receipt, true)
  assertEquals(fields?.description, 'Officeworks')
  assertEquals(fields?.amount, '124.50')
  // Fields the model omitted entirely read as absent, not as an error.
  assertEquals(fields?.deduction_date, null)
})

Deno.test('readRawFields nulls placeholders and non-strings rather than guessing', () => {
  const fields = readRawFields({
    is_receipt: true,
    description: 'N/A',
    amount: '-',
    // A number is exactly what the model must not compute, so it reads as absent.
    deduction_date: 20260706,
  })

  assertEquals(fields?.description, null)
  assertEquals(fields?.amount, null)
  assertEquals(fields?.deduction_date, null)
})

Deno.test('readRawFields rejects an input that is not a usable extraction', () => {
  assertEquals(readRawFields(null), null)
  assertEquals(readRawFields('amount: 124.50'), null)
  assertEquals(readRawFields([{ is_receipt: true }]), null)
  assertEquals(readRawFields({}), null)
  assertEquals(readRawFields({ is_receipt: 'yes' }), null)
})

Deno.test('toExtraction converts the amount to cents and the date to ISO', () => {
  const { fields, text } = toExtraction(raw())

  assertEquals(fields.description, 'Officeworks')
  assertEquals(fields.deduction_date, '2026-07-06')
  assertEquals(fields.amount_cents, 12450)
  // The text is kept so the form can show what was read.
  assertEquals(text.amount, '124.50')
  assertEquals(text.deduction_date, '2026-07-06')
})

Deno.test('toExtraction reports a field the receipt does not show as missing', () => {
  const { fields, missing, unreadable } = toExtraction(
    raw({ description: null, deduction_date: null }),
  )

  assertEquals(fields.description, null)
  assertEquals(fields.deduction_date, null)
  assertEquals(missing.sort(), ['deduction_date', 'description'])
  assertEquals(unreadable, [])
})

Deno.test('toExtraction reports text it could not convert as unreadable, never as a number', () => {
  const { fields, missing, unreadable } = toExtraction(
    raw({ amount: '12O.50', deduction_date: '06/07/2026' }),
  )

  assertEquals(fields.amount_cents, null)
  assertEquals(fields.deduction_date, null)
  assertEquals(unreadable.sort(), ['amount_cents', 'deduction_date'])
  assertEquals(missing, [])
})

Deno.test('toExtraction handles a receipt it could read nothing from', () => {
  const nothing = raw({ description: null, deduction_date: null, amount: null })
  const { fields, missing, unreadable } = toExtraction(nothing)

  assertEquals(Object.values(fields).every((value) => value === null), true)
  assertEquals(missing.sort(), ['amount_cents', 'deduction_date', 'description'])
  assertEquals(unreadable, [])
})

Deno.test('toExtraction reads a receipt with no printed business name as its item description', () => {
  const { fields } = toExtraction(raw({ description: 'Replacement laptop charger' }))

  assertEquals(fields.description, 'Replacement laptop charger')
})
