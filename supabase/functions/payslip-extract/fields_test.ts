import { assertEquals } from '@std/assert'
import { type RawPayslipFields, readRawFields, toExtraction } from './fields.ts'

/** A full set of reported fields, overridable per test. */
function raw(overrides: Partial<RawPayslipFields> = {}): RawPayslipFields {
  return {
    is_payslip: true,
    not_payslip_reason: null,
    period_start: '2026-07-06',
    period_end: '2026-07-19',
    paid_on: '2026-07-22',
    gross: '4,120.50',
    tax_withheld: '1,048.00',
    super: '473.86',
    net: '3,072.50',
    salary_sacrifice: null,
    ytd_gross: '12,361.50',
    ytd_tax_withheld: '3,144.00',
    ytd_super: '1,421.58',
    ...overrides,
  }
}

Deno.test('readRawFields reads a well-formed tool input', () => {
  const fields = readRawFields({
    is_payslip: true,
    not_payslip_reason: null,
    period_start: '2026-07-06',
    gross: '  4,120.50  ',
  })

  assertEquals(fields?.is_payslip, true)
  assertEquals(fields?.period_start, '2026-07-06')
  assertEquals(fields?.gross, '4,120.50')
  // Fields the model omitted entirely read as absent, not as an error.
  assertEquals(fields?.net, null)
  assertEquals(fields?.ytd_super, null)
})

Deno.test('readRawFields nulls placeholders and non-strings rather than guessing', () => {
  const fields = readRawFields({
    is_payslip: true,
    gross: 'N/A',
    net: '   ',
    super: '-',
    // A number is exactly what the model must not compute, so it reads as absent.
    tax_withheld: 4120.5,
    ytd_gross: { amount: '1.00' },
  })

  assertEquals(fields?.gross, null)
  assertEquals(fields?.net, null)
  assertEquals(fields?.super, null)
  assertEquals(fields?.tax_withheld, null)
  assertEquals(fields?.ytd_gross, null)
})

Deno.test('readRawFields rejects an input that is not a usable extraction', () => {
  assertEquals(readRawFields(null), null)
  assertEquals(readRawFields('gross: 4120.50'), null)
  assertEquals(readRawFields([{ is_payslip: true }]), null)
  assertEquals(readRawFields({}), null)
  assertEquals(readRawFields({ is_payslip: 'yes' }), null)
})

Deno.test('toExtraction converts amounts to cents and dates to ISO', () => {
  const { fields, text } = toExtraction(raw())

  assertEquals(fields.period_start, '2026-07-06')
  assertEquals(fields.period_end, '2026-07-19')
  assertEquals(fields.paid_on, '2026-07-22')
  assertEquals(fields.gross_cents, 412050)
  assertEquals(fields.tax_withheld_cents, 104800)
  assertEquals(fields.super_cents, 47386)
  assertEquals(fields.net_cents, 307250)
  assertEquals(fields.ytd_gross_cents, 1236150)
  assertEquals(fields.ytd_tax_withheld_cents, 314400)
  assertEquals(fields.ytd_super_cents, 142158)
  // The text is kept so the form can show what was read.
  assertEquals(text.gross, '4,120.50')
  assertEquals(text.salary_sacrifice, null)
})

Deno.test('toExtraction reports a field the slip does not show as missing', () => {
  const { fields, missing, unreadable } = toExtraction(raw({ super: null, paid_on: null }))

  assertEquals(fields.super_cents, null)
  assertEquals(fields.paid_on, null)
  assertEquals(missing.sort(), ['paid_on', 'salary_sacrifice_cents', 'super_cents'])
  assertEquals(unreadable, [])
})

Deno.test('toExtraction reports text it could not convert as unreadable, never as a number', () => {
  const { fields, missing, unreadable } = toExtraction(
    raw({ gross: '4,12O.50', period_end: '19/07/2026', ytd_super: '1.4215' }),
  )

  assertEquals(fields.gross_cents, null)
  assertEquals(fields.period_end, null)
  assertEquals(fields.ytd_super_cents, null)
  assertEquals(unreadable.sort(), ['gross_cents', 'period_end', 'ytd_super_cents'])
  assertEquals(missing, ['salary_sacrifice_cents'])
})

Deno.test('toExtraction handles a slip it could read nothing from', () => {
  const nothing = raw({
    period_start: null,
    period_end: null,
    paid_on: null,
    gross: null,
    tax_withheld: null,
    super: null,
    net: null,
    salary_sacrifice: null,
    ytd_gross: null,
    ytd_tax_withheld: null,
    ytd_super: null,
  })
  const { fields, missing, unreadable } = toExtraction(nothing)

  assertEquals(Object.values(fields).every((value) => value === null), true)
  assertEquals(missing.length, 11)
  assertEquals(unreadable, [])
})
