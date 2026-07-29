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
    earnings_lines: [],
    tax_lines: [],
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

Deno.test('readRawFields reads the lines a slip itemises, in the order reported', () => {
  const fields = readRawFields({
    is_payslip: true,
    earnings_lines: [
      { label: 'Ordinary Hours', amount: '$4,000.00' },
      { label: '  Annual Leave  ', amount: '$1,000.00' },
      { label: 'On-call (T1)', amount: '$495.50' },
    ],
    tax_lines: [
      { label: 'PAYG', amount: '$1,416.00', component: 'payg' },
      { label: 'STSL Component', amount: '$434.00', component: 'STSL' },
    ],
  })

  assertEquals(fields?.earnings_lines, [
    { label: 'Ordinary Hours', amount: '$4,000.00' },
    { label: 'Annual Leave', amount: '$1,000.00' },
    { label: 'On-call (T1)', amount: '$495.50' },
  ])
  assertEquals(fields?.tax_lines, [
    { label: 'PAYG', amount: '$1,416.00', component: 'payg' },
    // Reported in the slip's own capitalisation, read as the component it names.
    { label: 'STSL Component', amount: '$434.00', component: 'stsl' },
  ])
})

Deno.test('readRawFields leaves a tax component it cannot place unnamed, never PAYG', () => {
  const fields = readRawFields({
    is_payslip: true,
    tax_lines: [
      { label: 'Withholding', amount: '$1,850.00', component: null },
      { label: 'Tax adjustment', amount: '$12.00', component: 'other' },
      { label: 'Extra tax', amount: '$50.00' },
    ],
  })

  // Each pays a different part of the liability, so an unnamed one is the
  // member's to pick: defaulting to the commoner of the two would net the
  // withholding against the wrong half.
  assertEquals(fields?.tax_lines.map((line) => line.component), [null, null, null])
})

Deno.test('readRawFields drops anything reported as a line that is not one', () => {
  const fields = readRawFields({
    is_payslip: true,
    earnings_lines: [
      { label: 'Ordinary Hours', amount: '$4,000.00' },
      // No label: nothing the form could show as a row.
      { amount: '$1,000.00' },
      { label: '   ', amount: '$1.00' },
      { label: 'N/A', amount: '$1.00' },
      // A number is exactly what the model must not compute, so it reads as absent.
      { label: 'Bonus', amount: 500 },
      'Ordinary Hours $4,000.00',
      ['Ordinary Hours'],
      null,
    ],
    // Not an array at all: the section reads as unitemised, not as an error.
    tax_lines: { label: 'PAYG', amount: '$1,850.00' },
  })

  assertEquals(fields?.earnings_lines, [
    { label: 'Ordinary Hours', amount: '$4,000.00' },
    { label: 'Bonus', amount: null },
  ])
  assertEquals(fields?.tax_lines, [])
})

Deno.test('readRawFields reads a slip that itemises nothing as carrying no lines', () => {
  const fields = readRawFields({ is_payslip: true, earnings_lines: null, tax_lines: null })

  assertEquals(fields?.earnings_lines, [])
  assertEquals(fields?.tax_lines, [])
})

Deno.test('toExtraction converts each line’s printed amount to cents', () => {
  const { fields, lines } = toExtraction(
    raw({
      gross: '5,495.50',
      earnings_lines: [
        { label: 'Ordinary Hours', amount: '$4,000.00' },
        { label: 'Annual Leave', amount: '$1,000.00' },
        { label: 'On-call (T1)', amount: '$495.50' },
      ],
      tax_lines: [
        { label: 'PAYG', amount: '$1,416.00', component: 'payg' },
        { label: 'STSL Component', amount: '$434.00', component: 'stsl' },
      ],
    }),
  )

  assertEquals(lines.earnings, [
    { label: 'Ordinary Hours', amount: '$4,000.00', amount_cents: 4_000_00 },
    { label: 'Annual Leave', amount: '$1,000.00', amount_cents: 1_000_00 },
    { label: 'On-call (T1)', amount: '$495.50', amount_cents: 495_50 },
  ])
  assertEquals(lines.tax, [
    { label: 'PAYG', amount: '$1,416.00', amount_cents: 1_416_00, component: 'payg' },
    { label: 'STSL Component', amount: '$434.00', amount_cents: 434_00, component: 'stsl' },
  ])
  // The TOTAL row is the scalar field, never a line, so the lines sum to the gross
  // exactly once rather than twice.
  assertEquals(lines.earnings.reduce((sum, line) => sum + line.amount_cents!, 0), 549_550)
  assertEquals(fields.gross_cents, 549_550)
})

Deno.test('toExtraction keeps a negative line amount, unlike a negative total', () => {
  const { lines } = toExtraction(
    raw({
      earnings_lines: [
        { label: 'Ordinary Hours', amount: '$4,000.00' },
        { label: 'Overpayment recovery', amount: '($120.00)' },
        { label: 'Adjustment', amount: '45.00-' },
      ],
    }),
  )

  // `payslip_line.amount_cents` carries no `>= 0` check, deliberately: a line
  // reversing an overpayment is a figure to fill in, not one to drop.
  assertEquals(lines.earnings.map((line) => line.amount_cents), [4_000_00, -120_00, -45_00])
})

Deno.test('toExtraction reports a line amount it could not convert as null', () => {
  const { lines } = toExtraction(
    raw({
      earnings_lines: [
        { label: 'Ordinary Hours', amount: '4,00O.00' },
        { label: 'Annual Leave', amount: null },
      ],
    }),
  )

  // The label and the printed text survive either way, so the member can read the
  // figure back off the slip themselves.
  assertEquals(lines.earnings, [
    { label: 'Ordinary Hours', amount: '4,00O.00', amount_cents: null },
    { label: 'Annual Leave', amount: null, amount_cents: null },
  ])
})

Deno.test('toExtraction reports no lines for a slip that itemises nothing', () => {
  const { fields, lines } = toExtraction(raw())

  assertEquals(lines, { earnings: [], tax: [] })
  // A slip printing only its totals is a complete extraction, not a failure.
  assertEquals(fields.gross_cents, 412050)
})
