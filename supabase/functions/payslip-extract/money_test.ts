import { assertEquals } from '@std/assert'
import { isPlaceholder, parseCents, parseIsoDate } from './money.ts'

/**
 * The converter is where a bug would silently corrupt a tax figure, so it is
 * tested harder than anything else here: every accepted shape, every rejected
 * shape, and the floating-point trap the integer arithmetic exists to avoid.
 */

Deno.test('parseCents reads plain amounts', () => {
  assertEquals(parseCents('0.00'), 0)
  assertEquals(parseCents('0'), 0)
  assertEquals(parseCents('1.23'), 123)
  assertEquals(parseCents('45.00'), 4500)
  assertEquals(parseCents('4120.50'), 412050)
})

Deno.test('parseCents reads thousands separators', () => {
  assertEquals(parseCents('4,120.50'), 412050)
  assertEquals(parseCents('1,234'), 123400)
  assertEquals(parseCents('12,345.67'), 1234567)
  assertEquals(parseCents('1,234,567.89'), 123456789)
})

Deno.test('parseCents reads a leading currency mark', () => {
  assertEquals(parseCents('$1,234'), 123400)
  assertEquals(parseCents('$4,120.50'), 412050)
  assertEquals(parseCents('A$99.95'), 9995)
  assertEquals(parseCents('AUD 1,000.00'), 100000)
  assertEquals(parseCents('aud1,000.00'), 100000)
})

Deno.test('parseCents reads amounts with absent or short cents', () => {
  assertEquals(parseCents('4120'), 412000)
  assertEquals(parseCents('4120.5'), 412050)
  assertEquals(parseCents('$1,234'), 123400)
  assertEquals(parseCents('.5'), 50)
  assertEquals(parseCents('.05'), 5)
})

Deno.test('parseCents ignores whitespace, including non-breaking spaces', () => {
  assertEquals(parseCents('  4,120.50  '), 412050)
  assertEquals(parseCents('$ 4,120.50'), 412050)
  assertEquals(parseCents('4 120.50'), 412050)
  assertEquals(parseCents('$ 4 120.50'), 412050)
  assertEquals(parseCents('1,234.\n56'), 123456)
})

Deno.test('parseCents reads parenthesised negatives', () => {
  assertEquals(parseCents('(1,234.56)'), -123456)
  assertEquals(parseCents('($1,234.56)'), -123456)
  assertEquals(parseCents('( 45.00 )'), -4500)
  // A negative zero is still zero.
  assertEquals(parseCents('(0.00)'), 0)
})

Deno.test('parseCents reads signed negatives in either order', () => {
  assertEquals(parseCents('-45.00'), -4500)
  assertEquals(parseCents('-$45.00'), -4500)
  assertEquals(parseCents('$-45.00'), -4500)
  assertEquals(parseCents('45.00-'), -4500)
  assertEquals(parseCents('+45.00'), 4500)
})

Deno.test('parseCents rejects doubled or stray signs', () => {
  assertEquals(parseCents('--45.00'), null)
  assertEquals(parseCents('(-45.00)'), null)
  assertEquals(parseCents('(45.00-)'), null)
  assertEquals(parseCents('45.00+-'), null)
})

Deno.test('parseCents treats an absent field as null, never as zero', () => {
  assertEquals(parseCents(null), null)
  assertEquals(parseCents(undefined), null)
  assertEquals(parseCents(''), null)
  assertEquals(parseCents('   '), null)
  assertEquals(parseCents('-'), null)
  assertEquals(parseCents('—'), null)
  assertEquals(parseCents('N/A'), null)
  assertEquals(parseCents('not shown'), null)
  assertEquals(parseCents('null'), null)
})

Deno.test('parseCents rejects non-strings rather than coercing them', () => {
  assertEquals(parseCents(4120.5), null)
  assertEquals(parseCents(412050), null)
  assertEquals(parseCents(true), null)
  assertEquals(parseCents({ amount: '10.00' }), null)
  assertEquals(parseCents(['10.00']), null)
})

Deno.test('parseCents rejects genuinely unparseable text', () => {
  assertEquals(parseCents('one thousand'), null)
  assertEquals(parseCents('1.2O5'), null) // A letter O misread for a zero.
  assertEquals(parseCents('12.34.56'), null)
  assertEquals(parseCents('1,234.5,6'), null)
  assertEquals(parseCents('$'), null)
  assertEquals(parseCents('4120.50 CR'), null)
  assertEquals(parseCents('gross: 4120.50'), null)
  assertEquals(parseCents('1e5'), null)
  assertEquals(parseCents('0x10'), null)
})

Deno.test('parseCents rejects more than two decimal places rather than rounding', () => {
  assertEquals(parseCents('1.005'), null)
  assertEquals(parseCents('4120.500'), null)
  assertEquals(parseCents('1,234.5678'), null)
})

Deno.test('parseCents rejects a comma used as a decimal mark', () => {
  // Ambiguous with thousands ("1,234" is one thousand two hundred), so it is
  // never guessed at.
  assertEquals(parseCents('1234,56'), null)
  assertEquals(parseCents('12,34'), null)
  assertEquals(parseCents('1.234,56'), null)
  assertEquals(parseCents('1,2345'), null)
})

Deno.test('parseCents converts by integer arithmetic, with no floating-point drift', () => {
  // parseFloat('8.29') * 100 is 828.9999999999999 — truncating that yields 828,
  // one cent short. The digit-string arithmetic cannot drift.
  assertEquals(Math.trunc(parseFloat('8.29') * 100), 828)
  assertEquals(parseCents('8.29'), 829)

  // The same trap at payslip scale: a gross of $4,120.15 comes out a cent short.
  assertEquals(Math.trunc(parseFloat('4120.15') * 100), 412014)
  assertEquals(parseCents('4,120.15'), 412015)

  // Two more the naive multiply loses a cent on.
  assertEquals(Math.trunc(parseFloat('1.13') * 100), 112)
  assertEquals(parseCents('1.13'), 113)
  assertEquals(Math.trunc(parseFloat('4.35') * 100), 434)
  assertEquals(parseCents('4.35'), 435)
})

Deno.test('parseCents rejects amounts too large to hold exactly in cents', () => {
  assertEquals(parseCents('99,999,999,999.99'), 9999999999999)
  assertEquals(parseCents('0000099.99'), 9999) // Leading zeros do not count.
  assertEquals(parseCents('99999999999999.99'), null)
  assertEquals(parseCents('9'.repeat(20)), null)
})

Deno.test('isPlaceholder recognises the model saying "not on the slip"', () => {
  assertEquals(isPlaceholder('N/A'), true)
  assertEquals(isPlaceholder('n/a'), true)
  assertEquals(isPlaceholder('Not stated'), true)
  assertEquals(isPlaceholder('nil'), true)
  assertEquals(isPlaceholder('0.00'), false)
  assertEquals(isPlaceholder('4,120.50'), false)
})

Deno.test('parseIsoDate accepts real ISO dates', () => {
  assertEquals(parseIsoDate('2026-07-06'), '2026-07-06')
  assertEquals(parseIsoDate('  2026-07-06  '), '2026-07-06')
  assertEquals(parseIsoDate('2024-02-29'), '2024-02-29')
})

Deno.test('parseIsoDate rejects anything that is not a real ISO date', () => {
  assertEquals(parseIsoDate('2026-02-31'), null)
  assertEquals(parseIsoDate('2026-13-01'), null)
  assertEquals(parseIsoDate('06/07/2026'), null)
  assertEquals(parseIsoDate('2026-7-6'), null)
  assertEquals(parseIsoDate('2026-07-06T00:00:00Z'), null)
  assertEquals(parseIsoDate('yesterday'), null)
  assertEquals(parseIsoDate(null), null)
  assertEquals(parseIsoDate(20260706), null)
})
