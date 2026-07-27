import { assertEquals } from '@std/assert'
import { normaliseVapidKeys } from './vapid.ts'

const row = {
  public_key: 'BJxV-public',
  private_key: 'private-scalar',
  subject: 'mailto:ops@example.com',
}

Deno.test('normaliseVapidKeys shapes a complete row', () => {
  assertEquals(normaliseVapidKeys(row), {
    publicKey: 'BJxV-public',
    privateKey: 'private-scalar',
    subject: 'mailto:ops@example.com',
  })
})

Deno.test('normaliseVapidKeys trims surrounding whitespace', () => {
  assertEquals(
    normaliseVapidKeys({ ...row, public_key: '  BJxV-public\n' })?.publicKey,
    'BJxV-public',
  )
})

Deno.test('normaliseVapidKeys accepts an https subject', () => {
  assertEquals(
    normaliseVapidKeys({ ...row, subject: 'https://example.com/contact' })?.subject,
    'https://example.com/contact',
  )
})

Deno.test('normaliseVapidKeys rejects a subject that is not a mailto or https URI', () => {
  assertEquals(normaliseVapidKeys({ ...row, subject: 'ops@example.com' }), null)
})

Deno.test('normaliseVapidKeys rejects an incomplete credential set', () => {
  assertEquals(normaliseVapidKeys({ ...row, private_key: '' }), null)
  assertEquals(normaliseVapidKeys({ ...row, public_key: '   ' }), null)
  assertEquals(normaliseVapidKeys({ ...row, subject: undefined }), null)
})

Deno.test('normaliseVapidKeys rejects a missing or ill-typed row', () => {
  assertEquals(normaliseVapidKeys(null), null)
  assertEquals(normaliseVapidKeys(undefined), null)
  assertEquals(normaliseVapidKeys({ public_key: 1, private_key: 2, subject: 3 }), null)
})
