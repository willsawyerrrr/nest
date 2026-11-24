import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  findIdentifiers,
  type Identifiers,
  leaks,
  PLACEHOLDER,
  redactText,
  termsFor,
} from './redact.ts'

const known: Identifiers = {
  names: ['Jordan Example', 'Harbour Logistics Pty Ltd'],
  addresses: ['12 Sample Street, Exampleton NSW 2000'],
}

const PAYSLIP = [
  'Harbour Logistics Pty Ltd',
  'ABN 12 345 678 901',
  'Employee: Jordan Example',
  'TFN 123 456 782',
  '7/45 Fictional Road, Placeholder VIC 3000',
  'Employee number 004821',
  'Pay period 01/07/2026 to 14/07/2026',
  'Gross pay $5,000.00',
  'Tax withheld $1,234.50',
  'BSB 062-000',
  'Account number',
  '12345678',
].join('\n')

Deno.test('identifiers are redacted and figures and dates stay', () => {
  const out = redactText(PAYSLIP, known)
  for (
    const gone of [
      'Harbour',
      'Jordan',
      '12 345 678 901',
      '123 456 782',
      'Fictional Road',
      '004821',
      '062-000',
      '12345678',
    ]
  ) assertEquals(out.includes(gone), false, gone)
  for (
    const kept of [
      '01/07/2026',
      '14/07/2026',
      '$5,000.00',
      '$1,234.50',
      'Gross pay',
      'Tax withheld',
    ]
  ) assertStringIncludes(out, kept)
  assertEquals(leaks(out, known), 0)
})

Deno.test('known names match by word, case-insensitively, and not inside other words', () => {
  const out = redactText('jordan paid. Jordanian rice $4.00', known)
  assertEquals(out, `${PLACEHOLDER} paid. Jordanian rice $4.00`)
})

Deno.test('a number with no identifying keyword is a figure', () => {
  assertEquals(
    findIdentifiers('Units 123456 at $10.00 on 30 06 2026', { names: [], addresses: [] }),
    [],
  )
  assertEquals(findIdentifiers('Member since 12 03 2019', { names: [], addresses: [] }), [])
})

Deno.test('bare labelled TFN and ABN are found', () => {
  const none = { names: [], addresses: [] }
  assertEquals(redactText('TFN: 123456782', none), `TFN: ${PLACEHOLDER}`)
  assertEquals(redactText('ABN 12345678901', none), `ABN ${PLACEHOLDER}`)
})

Deno.test('terms cover found identifiers and every known string', () => {
  const terms = termsFor('Account no 99887766', known)
  assertEquals(terms.includes('99887766'), true)
  assertEquals(terms.includes('Jordan'), true)
  assertEquals(terms.includes('12 Sample Street, Exampleton NSW 2000'), true)
})

Deno.test('leaks counts an identifier that survives', () => {
  assertEquals(leaks('Account no 99887766', known), 1)
})
