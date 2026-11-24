import { assertEquals, assertThrows } from '@std/assert'
import { type Layout, reskin, reskinAll } from './reskin.ts'

const layout: Layout = {
  id: 'receipt-thermal-a',
  kind: 'deduction',
  stratum: 'receipt/thermal',
  financialYear: 2026,
  slots: {
    shop: { type: 'text', pool: ['Corner Stationers', 'Metro Tech Repairs'] },
    total: { type: 'money', min: 500, max: 50_000 },
    day: { type: 'date', from: '2025-07-14', to: '2026-06-28', format: 'au' },
  },
  rows: [['{shop}'], ['Tax invoice'], ['Total', '{total}'], ['Date', '{day}']],
  label: {
    is_receipt: true,
    not_receipt_reason: null,
    description: '{shop}',
    deduction_date: '{day}',
    amount: '{total}',
  },
}

Deno.test('values are seeded and the label is re-derived from what was printed', () => {
  const a = reskin(layout, 1)
  assertEquals(a, reskin(layout, 1))
  assertEquals(a.rows[2][1] === reskin(layout, 2).rows[2][1], false)
  if (a.kind !== 'deduction') throw new Error('kind')
  assertEquals(a.label.amount, a.rows[2][1])
  assertEquals(a.label.deduction_date, a.rows[3][1])
  assertEquals(a.label.description, a.rows[0][0])
  assertEquals([a.id, a.source, a.stratum], [
    'receipt-thermal-a.s1',
    'receipt-thermal-a',
    'receipt/thermal',
  ])
})

Deno.test('a sum is derived from its operands', () => {
  const payslip: Layout = {
    id: 'payslip-a',
    kind: 'payslip',
    stratum: 'payslip/tabular',
    financialYear: 2026,
    slots: {
      gross: { type: 'money', min: 300_000, max: 600_000 },
      tax: { type: 'money', min: 50_000, max: 100_000 },
      net: { type: 'sum', add: ['gross'], subtract: ['tax'] },
    },
    rows: [['Gross', '{gross}'], ['Tax', '{tax}'], ['Net', '{net}']],
    label: { net: '{net}' },
  }
  const doc = reskin(payslip, 0)
  const cents = (text: string) => Math.round(Number(text.replace(/[$,]/g, '')) * 100)
  assertEquals(cents(doc.rows[2][1]), cents(doc.rows[0][1]) - cents(doc.rows[1][1]))
})

Deno.test('a value, an unknown slot or an unprinted label is refused', () => {
  assertThrows(
    () => reskin({ ...layout, rows: [['Total', '$12.50']] }, 0),
    Error,
    'a value outside a slot',
  )
  assertThrows(() => reskin({ ...layout, rows: [['{nope}']] }, 0), Error, 'unknown slot')
  assertThrows(
    () => reskin({ ...layout, label: { description: 'Not on the page' } }, 0),
    Error,
    'is not printed',
  )
  assertThrows(
    () =>
      reskin({ ...layout, rows: [['Account number 12345678']] }, 0, { names: [], addresses: [] }),
    Error,
  )
})

Deno.test('an identifier outside a slot is refused when the household is known', () => {
  const known = { names: ['Jordan Example'], addresses: [] }
  assertThrows(
    () => reskin({ ...layout, rows: [['Prepared for Jordan Example']] }, 0, known),
    Error,
    'an identifier outside a slot',
  )
})

Deno.test('every layout gets the requested copies', () => {
  assertEquals(reskinAll([layout], 3).map((doc) => doc.id), [
    'receipt-thermal-a.s0',
    'receipt-thermal-a.s1',
    'receipt-thermal-a.s2',
  ])
})
